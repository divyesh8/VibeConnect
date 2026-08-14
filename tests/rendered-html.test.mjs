import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("native Next.js build contains the public App Router routes", async () => {
  await access(new URL(".next/BUILD_ID", root));
  const manifest = JSON.parse(
    await readFile(new URL(".next/server/app-paths-manifest.json", root), "utf8"),
  );
  const routes = Object.keys(manifest);
  assert.ok(routes.some((route) => route === "/page" || route === "/"));
  assert.ok(routes.some((route) => route.includes("/start/page")));
  assert.ok(routes.some((route) => route.includes("/chat/[room]/page")));
  assert.ok(routes.some((route) => route.includes("/api/session/route")));
  assert.ok(routes.some((route) => route.includes("/api/match/accept/route")));
  assert.ok(routes.some((route) => route.includes("/api/match/status/route")));
  assert.ok(routes.some((route) => route.includes("/api/presence/heartbeat/route")));
  assert.ok(routes.some((route) => route.includes("/api/webrtc/ice-servers/route")));
  assert.ok(routes.some((route) => route.includes("/api/rooms/connected/route")));
  assert.ok(routes.some((route) => route.includes("/api/rooms/another-vibe/route")));
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? sourceFiles(url) : [url];
  }));
  return nested.flat();
}

test("production source contains no seeded people or conversation shortcuts", async () => {
  const directories = ["app/", "components/", "hooks/", "lib/", "services/", "webrtc/"];
  const files = (await Promise.all(directories.map((directory) => sourceFiles(new URL(directory, root))))).flat();
  const source = (await Promise.all(files.filter((file) => /\.(?:ts|tsx)$/.test(file.pathname)).map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bNova\b|\bLuna\b|welcome-\d|previewStats|previewReports|PREVIEW_USER_COOKIE/);
  assert.doesNotMatch(source, /(?:senderId|reportedUserId|blockedUserId):\s*["']partner["']/);
  assert.doesNotMatch(source, /setTimeout\([^)]*(?:match|message|reply)/i);
  assert.doesNotMatch(source, /MediaRecorder|getDisplayMedia|supabase\.storage|captureStream/i);
});

test("database schema requires live two-person acceptance", async () => {
  const schema = await readFile(new URL("supabase/schema.sql", root), "utf8");
  const candidateQuery = schema.slice(schema.indexOf("select candidate_row.* into candidate"), schema.indexOf("if candidate.id is null"));
  assert.match(schema, /propose_real_match/);
  assert.match(schema, /accept_real_match/);
  assert.match(schema, /last_seen > now\(\) - interval '25 seconds'/);
  assert.match(schema, /proposal\.user1_accepted and proposal\.user2_accepted/);
  assert.match(schema, /for update of candidate_row skip locked/);
  assert.match(schema, /requester\.gender = 'male' and candidate_row\.gender = 'female'/);
  assert.match(candidateQuery, /then 0\s+when requester\.gender = candidate_row\.gender then 1\s+else 2\s+end/);
  assert.doesNotMatch(candidateQuery, /jsonb_array_elements_text|age_group/);
  assert.doesNotMatch(candidateQuery.slice(0, candidateQuery.indexOf("order by")), /requester\.gender\s*=/);
  assert.match(schema, /communication_mode = 'video'/);
  assert.match(schema, /room_members_one_active_room_per_user_idx/);
  assert.match(schema, /is_active_room_member/);
  assert.match(schema, /status = 'active', connected_at = coalesce/);
  assert.doesNotMatch(schema, /create or replace function public\.match_anonymous_user/);
});

test("media rooms keep room-scoped text chat alongside the call", async () => {
  const [room, chat, realtime] = await Promise.all([
    readFile(new URL("components/chat-room.tsx", root), "utf8"),
    readFile(new URL("hooks/use-room-chat.ts", root), "utf8"),
    readFile(new URL("services/realtime.ts", root), "utf8"),
  ]);
  assert.match(room, /useRoomChat\(roomId, !ended && liveRoom \? profile : null\)/);
  assert.match(room, /<RoomChatPanel compact/);
  assert.match(room, /mediaChatOpen \? "flex" : "hidden"/);
  assert.match(chat, /subscribeToRoom\(roomId,[\s\S]*?, "chat"\)/);
  assert.match(realtime, /`room:\$\{roomId\}:chat`/);
  assert.match(realtime, /filter: `room_id=eq\.\$\{roomId\}`/);
});

test("voice and video calls render audible remote media without replaying on chat input", async () => {
  const [room, hook, peer] = await Promise.all([
    readFile(new URL("components/chat-room.tsx", root), "utf8"),
    readFile(new URL("hooks/use-webrtc.ts", root), "utf8"),
    readFile(new URL("webrtc/peer-manager.ts", root), "utf8"),
  ]);
  assert.match(room, /element\.muted = muted/);
  assert.match(room, /element\.volume = muted \? 0 : 1/);
  assert.match(room, /media\.remoteStream && <StreamVideo stream=\{media\.remoteStream\} muted=\{false\}/);
  assert.match(room, /className="sr-only"/);
  const streamVideo = room.slice(room.indexOf("function StreamVideo"), room.indexOf("type MediaController"));
  assert.match(streamVideo, /}, \[muted, ref, stream\]\);/);
  assert.doesNotMatch(streamVideo, /\[muted, onPlaybackBlocked/);
  assert.match(hook, /echoCancellation: true/);
  assert.match(hook, /track\.enabled = enabledNext/);
  assert.match(hook, /toggleMicrophone\(enabledNext\)/);
  assert.match(peer, /event\.streams\[0\]/);
  assert.match(peer, /getSenders\(\).*includes\("audio"\)/s);
});

test("Another Vibe keeps the current call until a replacement has accepted", async () => {
  const room = await readFile(new URL("components/chat-room.tsx", root), "utf8");
  const finder = room.slice(room.indexOf("async function findAnotherVibe"), room.indexOf("async function exitGuestSession"));
  assert.match(finder, /current call will stay connected/);
  assert.doesNotMatch(finder, /media\.endConnection|api\/rooms\/end/);
  const replacement = room.slice(room.indexOf("const checkReplacement"), room.indexOf("async function sendDraft"));
  assert.match(replacement, /result\.status === "matched"/);
  assert.match(replacement, /(?:media\.endConnection|endMediaConnection)\("skip"\)/);
  assert.match(replacement, /router\.replace\(`\/chat\/\$\{result\.roomId\}`\)/);
  const matchedBranch = replacement.slice(replacement.indexOf('result.status === "matched"'), replacement.indexOf('if (["declined"'));
  const endIndex = Math.max(matchedBranch.indexOf("media.endConnection"), matchedBranch.indexOf("endMediaConnection"));
  assert.ok(endIndex >= 0 && endIndex < matchedBranch.indexOf("router.replace"));
});

test("database handoff ends the old room only after the new person accepts", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(new URL("supabase/migrations/008_another_vibe_safe_handoff.sql", root), "utf8"),
  ]);
  for (const sql of [schema, migration]) {
    const handoff = sql.slice(sql.lastIndexOf("create or replace function public.accept_real_match"), sql.lastIndexOf("create or replace function public.decline_real_match"));
    assert.match(sql, /request_another_vibe/);
    assert.match(sql, /source_room_id/);
    assert.match(sql, /user1_accepted[\s\S]*true/);
    assert.match(handoff, /proposal\.user1_accepted and proposal\.user2_accepted/);
    assert.ok(handoff.indexOf("proposal.user1_accepted and proposal.user2_accepted") < handoff.indexOf("end_reason = 'skipped'"));
  }
});

test("signaling is room-bound and waits for both media-ready peers", async () => {
  const [realtime, hook, peer, env] = await Promise.all([
    readFile(new URL("services/realtime.ts", root), "utf8"),
    readFile(new URL("hooks/use-webrtc.ts", root), "utf8"),
    readFile(new URL("webrtc/peer-manager.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);
  assert.match(realtime, /roomId: string; senderId: string; timestamp: number; nonce: string/);
  assert.match(hook, /!mediaReadyRef\.current \|\| !remoteReadyRef\.current/);
  assert.match(hook, /signal\.roomId !== roomId \|\| signal\.senderId === userId/);
  assert.match(peer, /pendingCandidates/);
  assert.match(peer, /iceTransportPolicy: options\.forceRelay \? "relay" : "all"/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_TURN_(?:URL|USERNAME|CREDENTIAL)=/);
});

test("local media preview is independent from Realtime subscription success", async () => {
  const [hook, realtime] = await Promise.all([
    readFile(new URL("hooks/use-webrtc.ts", root), "utf8"),
    readFile(new URL("services/realtime.ts", root), "utf8"),
  ]);
  const startMedia = hook.slice(hook.indexOf("const startMedia"), hook.indexOf("const toggleMic"));
  const requestIndex = startMedia.indexOf("stream = await requestLocalMedia(mode)");
  const previewIndex = startMedia.indexOf("setLocalStream(stream)");
  const subscriptionIndex = startMedia.indexOf("signalingPromiseRef.current");
  assert.ok(requestIndex >= 0 && previewIndex > requestIndex && subscriptionIndex > previewIndex);
  assert.match(startMedia, /if \(!window\.isSecureContext\)/);
  assert.match(startMedia, /OverconstrainedError|requestLocalMedia/);
  assert.match(hook, /echoCancellation: true/);
  assert.match(hook, /width: \{ ideal: 1280 \}/);
  assert.match(hook, /frameRate: \{ ideal: 24, max: 30 \}/);
  assert.match(realtime, /channel\.subscribe\(\(status, subscriptionError\)/);
  assert.match(realtime, /\[REALTIME\] FULL ERROR:/);
  assert.match(realtime, /ensureAnonymousAuth\(\)/);
  assert.match(realtime, /await supabase\.realtime\.setAuth\(session\.access_token\)/);
});

test("Supabase client accepts current Vercel Marketplace variable names", async () => {
  const source = await readFile(new URL("services/supabase.ts", root), "utf8");
  assert.match(source, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("landing and setup source retain the primary user journey", async () => {
  const [landing, setup] = await Promise.all([
    readFile(new URL("components/landing-page.tsx", root), "utf8"),
    readFile(new URL("components/setup-form.tsx", root), "utf8"),
  ]);
  assert.match(landing, /Talk to/);
  assert.match(landing, /Start connecting/);
  assert.match(setup, /Tell us the basics/);
  assert.match(setup, /Find someone/);
});

test("guest profile is centralized and persists for the browser-tab session", async () => {
  const [layout, provider, storage, setup, matching, room, profilePage] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("components/guest-profile-provider.tsx", root), "utf8"),
    readFile(new URL("lib/session.ts", root), "utf8"),
    readFile(new URL("components/setup-form.tsx", root), "utf8"),
    readFile(new URL("components/matching-experience.tsx", root), "utf8"),
    readFile(new URL("components/chat-room.tsx", root), "utf8"),
    readFile(new URL("components/temporary-profile.tsx", root), "utf8"),
  ]);
  assert.match(layout, /<GuestProfileProvider>\{children\}<\/GuestProfileProvider>/);
  assert.match(storage, /vibeconnect_guest_profile/);
  assert.match(storage, /window\.sessionStorage/);
  assert.doesNotMatch(storage, /localStorage/);
  assert.match(provider, /saveLocalProfile\(nextProfile\)/);
  assert.match(provider, /updateProfile/);
  assert.match(setup, /profile \? "Ready to meet someone new\?" : "Tell us the basics"/);
  assert.match(setup, /method: "PATCH"/);
  assert.match(matching, /useGuestProfile\(\)/);
  assert.doesNotMatch(matching, /getLocalProfile/);
  assert.match(room, /router\.replace\("\/matching"\)/);
  assert.match(room, /Find someone else/);
  assert.match(room, /Start again/);
  assert.match(profilePage, /Exit \/ reset profile/);
});

test("display names preserve case, spaces, symbols, and Unicode", async () => {
  const { displayNameValidationError, trimDisplayName } = await import(new URL("../lib/display-name.ts", import.meta.url));
  const validNames = [
    "Divyesh",
    "DIVYESH",
    "Divyesh Kolli",
    "Mr. Divyesh :)",
    "D@rk Knight",
    "₹Divyesh",
    "★ Divyesh ★",
    "X Æ A-12",
    "李 小龍",
  ];
  for (const name of validNames) {
    assert.equal(displayNameValidationError(name), null, name);
    assert.equal(trimDisplayName(name), name, name);
  }
  assert.equal(trimDisplayName("   Divyesh Kolli   "), "Divyesh Kolli");
  assert.notEqual(displayNameValidationError("     "), null);
  assert.notEqual(displayNameValidationError("Divyesh\u0000"), null);
  assert.notEqual(displayNameValidationError("x".repeat(31)), null);
});

test("client, API, and database share permissive display-name limits", async () => {
  const [setup, validation, schema, migration, sessionRoute, allComponents] = await Promise.all([
    readFile(new URL("components/setup-form.tsx", root), "utf8"),
    readFile(new URL("lib/validation.ts", root), "utf8"),
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(new URL("supabase/migrations/006_permissive_display_names.sql", root), "utf8"),
    readFile(new URL("app/api/session/route.ts", root), "utf8"),
    sourceFiles(new URL("components/", root)).then(async (files) => (await Promise.all(files.filter((file) => /\.tsx$/.test(file.pathname)).map((file) => readFile(file, "utf8")))).join("\n")),
  ]);
  assert.match(setup, /slice\(0, 30\)/);
  assert.doesNotMatch(setup, /toLowerCase\(|\^\[a-zA-Z0-9_/);
  assert.match(validation, /displayNameSchema/);
  assert.match(sessionRoute, /username: parsed\.data\.username/);
  assert.match(schema, /char_length\(username\) between 1 and 30/);
  assert.doesNotMatch(schema, /username ~ '\^\[A-Za-z0-9_/);
  assert.match(migration, /drop constraint if exists online_users_username_check/);
  assert.doesNotMatch(allComponents, /dangerouslySetInnerHTML/);
});

test("sessions are forced to video without interest preferences", async () => {
  const route = await readFile(new URL("app/api/session/route.ts", root), "utf8");
  const patchHandler = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patchHandler, /communication_mode: "video"/);
  assert.match(patchHandler, /interests: \[\]/);
  assert.doesNotMatch(patchHandler, /username:/);
  assert.doesNotMatch(patchHandler, /gender:/);
});

test("setup offers mandatory video and calls cannot disable the camera", async () => {
  const [setup, room, hook] = await Promise.all([
    readFile(new URL("components/setup-form.tsx", root), "utf8"),
    readFile(new URL("components/chat-room.tsx", root), "utf8"),
    readFile(new URL("hooks/use-webrtc.ts", root), "utf8"),
  ]);
  assert.match(setup, /Video connection/);
  assert.doesNotMatch(setup, /Text chat|Voice chat|What are you into\?|Pick up to 5|INTERESTS|MODES/);
  assert.match(room, /media\.toggleMic/);
  assert.doesNotMatch(room, /toggleCamera|Turn off camera|CameraOff/);
  assert.doesNotMatch(hook, /toggleCamera|setCameraEnabled/);
});

test("WebRTC media stays direct, trickles ICE, and exposes low-latency diagnostics", async () => {
  const [room, hook, peer, realtime] = await Promise.all([
    readFile(new URL("components/chat-room.tsx", root), "utf8"),
    readFile(new URL("hooks/use-webrtc.ts", root), "utf8"),
    readFile(new URL("webrtc/peer-manager.ts", root), "utf8"),
    readFile(new URL("services/realtime.ts", root), "utf8"),
  ]);
  assert.match(room, /element\.srcObject = stream/);
  assert.match(room, /requestVideoFrameCallback/);
  assert.match(room, /diagnosticsVisible = process\.env\.NODE_ENV === "development"/);
  assert.doesNotMatch(room, /NEXT_PUBLIC_WEBRTC_DIAGNOSTICS/);
  assert.doesNotMatch(`${room}\n${hook}\n${peer}`, /MediaRecorder|MediaSource|SourceBuffer|toDataURL|toBlob/);
  assert.match(peer, /this\.connection\.addTrack\(track, stream\)/);
  assert.match(peer, /emitSignal\(\{ kind: "ice-candidate"/);
  assert.doesNotMatch(peer, /waitForIceGatheringComplete|iceGatheringState !== "complete"/);
  assert.match(peer, /maxBitrate = 1_500_000/);
  assert.match(peer, /degradationPreference = "maintain-framerate"/);
  assert.match(peer, /jitterBufferDelay/);
  assert.match(peer, /currentRoundTripTime/);
  assert.match(realtime, /broadcast: \{ self: false, ack: true \}/);
  assert.match(realtime, /if \(status !== "ok"\)/);
});

test("video-call chat has bounded moderation and verified fast delivery", async () => {
  const [hook, route, realtime, moderation] = await Promise.all([
    readFile(new URL("hooks/use-room-chat.ts", root), "utf8"),
    readFile(new URL("app/api/messages/route.ts", root), "utf8"),
    readFile(new URL("services/realtime.ts", root), "utf8"),
    readFile(new URL("services/moderation.ts", root), "utf8"),
  ]);
  assert.match(moderation, /MODERATION_TIMEOUT_MS = 1_500/);
  assert.match(moderation, /signal: controller\.signal/);
  assert.match(moderation, /if \(localDecision\.flagged\) return localDecision/);
  assert.match(route, /messageId = request\.nextUrl\.searchParams\.get\("messageId"\)/);
  assert.match(route, /query = query\.eq\("id", messageId\)/);
  assert.match(realtime, /event: "message-available"/);
  const hintType = realtime.slice(realtime.indexOf("export type ChatMessageHint"), realtime.indexOf("export type SignalPayload"));
  assert.doesNotMatch(hintType, /content/);
  assert.match(hook, /announceMessageAvailable/);
  assert.match(hook, /messageId=\$\{encodeURIComponent\(hint\.messageId\)\}/);
  assert.match(hook, /verified\.senderId !== hint\.senderId/);
  assert.match(hook, /Postgres delivery remains active/);
});
