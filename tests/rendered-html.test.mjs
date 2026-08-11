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
  assert.match(schema, /propose_real_match/);
  assert.match(schema, /accept_real_match/);
  assert.match(schema, /last_seen > now\(\) - interval '25 seconds'/);
  assert.match(schema, /proposal\.user1_accepted and proposal\.user2_accepted/);
  assert.match(schema, /for update of candidate_row skip locked/);
  assert.match(schema, /requester\.gender = 'male' and candidate_row\.gender = 'female'/);
  assert.match(schema, /requester\.gender = 'other' and candidate_row\.gender = 'other'/);
  assert.match(schema, /room_members_one_active_room_per_user_idx/);
  assert.match(schema, /is_active_room_member/);
  assert.match(schema, /status = 'active', connected_at = coalesce/);
  assert.doesNotMatch(schema, /create or replace function public\.match_anonymous_user/);
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
