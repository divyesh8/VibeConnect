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
  assert.match(candidateQuery, /then 0\s+else 1\s+end/);
  assert.ok(candidateQuery.indexOf("requester.gender = 'male'") < candidateQuery.indexOf("jsonb_array_elements_text(requester.interests)"));
  assert.doesNotMatch(candidateQuery.slice(0, candidateQuery.indexOf("order by")), /requester\.gender\s*=/);
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
  assert.match(hook, /audio: true/);
  assert.match(hook, /track\.enabled = enabledNext/);
  assert.match(hook, /toggleMicrophone\(enabledNext\)/);
  assert.match(peer, /event\.streams\[0\]/);
  assert.match(peer, /getSenders\(\).*includes\("audio"\)/s);
});

test("Next tears down the current room before returning to matching", async () => {
  const room = await readFile(new URL("components/chat-room.tsx", root), "utf8");
  const next = room.slice(room.indexOf("async function nextConversation"), room.indexOf("async function submitReport"));
  assert.match(next, /media\.endConnection\("skip"\)/);
  assert.match(next, /api\/rooms\/end/);
  assert.match(next, /router\.replace\("\/matching"\)/);
  assert.ok(next.indexOf("media.endConnection") < next.indexOf("router.replace"));
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
  assert.match(hook, /audio: true,\s+video: mode === "video"/);
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
  assert.match(room, /Change mode/);
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

test("mode changes update preferences without changing guest identity", async () => {
  const route = await readFile(new URL("app/api/session/route.ts", root), "utf8");
  const patchHandler = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patchHandler, /communication_mode: parsed\.data\.mode/);
  assert.match(patchHandler, /interests: parsed\.data\.interests/);
  assert.doesNotMatch(patchHandler, /username:/);
  assert.doesNotMatch(patchHandler, /gender:/);
});
