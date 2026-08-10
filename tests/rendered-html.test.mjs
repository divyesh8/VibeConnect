import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
