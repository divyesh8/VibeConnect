import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

type IceServerPayload = { iceServers: RTCIceServer[] };
type TurnProvider = "metered" | "cloudflare" | "managed" | "static" | "none";

const TURN_FETCH_TIMEOUT_MS = 6_000;

function turnCredentialTtlSeconds() {
  const configured = Number(process.env.TURN_TTL_SECONDS ?? 14_400);
  if (!Number.isFinite(configured)) return 14_400;
  return Math.min(172_800, Math.max(900, Math.round(configured)));
}

function configuredStunServers(): RTCIceServer[] {
  const urls = (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return urls.length ? [{ urls }] : [];
}

function staticTurnServer(): RTCIceServer | null {
  const urls = process.env.TURN_URL?.split(",").map((url) => url.trim()).filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (!urls?.length || !username || !credential) return null;
  return { urls, username, credential };
}

function validIceServers(value: unknown): value is RTCIceServer[] {
  return Array.isArray(value) && value.every((server) => {
    if (!server || typeof server !== "object") return false;
    const record = server as Record<string, unknown>;
    const urls = typeof record.urls === "string" ? [record.urls] : record.urls;
    if (!Array.isArray(urls) || !urls.length || !urls.every((url) => typeof url === "string" && /^(?:stun|stuns|turn|turns):/i.test(url))) return false;
    const usesTurn = urls.some((url) => /^turns?:/i.test(url));
    return !usesTurn || (typeof record.username === "string" && record.username.length > 0
      && typeof record.credential === "string" && record.credential.length > 0);
  });
}

function containsTurnServer(servers: RTCIceServer[]) {
  return servers.some((server) => {
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    return urls.some((url) => /^turns?:/i.test(url));
  });
}

function withoutBrowserBlockedPort53(servers: RTCIceServer[]) {
  return servers.flatMap((server) => {
    const urls = (typeof server.urls === "string" ? [server.urls] : server.urls)
      .filter((url) => !/:53(?:\?|$)/.test(url));
    return urls.length ? [{ ...server, urls }] : [];
  });
}

async function cloudflareTurnServers(): Promise<RTCIceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId && !apiToken) return null;
  if (!keyId || !apiToken) throw new Error("Cloudflare TURN requires both a key ID and API token");

  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    // Keep this request aligned with Cloudflare's documented
    // generate-ice-servers payload. The room is already authorization-scoped
    // by this endpoint, so it does not need to be sent to the TURN provider.
    body: JSON.stringify({ ttl: turnCredentialTtlSeconds() }),
    cache: "no-store",
    signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Cloudflare TURN returned ${response.status}`);
  const payload = await response.json() as Partial<IceServerPayload>;
  if (!validIceServers(payload.iceServers) || !containsTurnServer(payload.iceServers)) {
    throw new Error("Cloudflare TURN returned no authenticated relay server");
  }
  const servers = withoutBrowserBlockedPort53(payload.iceServers);
  if (!containsTurnServer(servers)) throw new Error("Cloudflare TURN returned no browser-usable relay server");
  return servers;
}

async function meteredTurnServers(): Promise<RTCIceServer[] | null> {
  const appName = process.env.METERED_TURN_APP_NAME?.trim();
  const apiKey = process.env.METERED_TURN_API_KEY?.trim();
  if (!appName && !apiKey) return null;
  if (!appName || !apiKey) throw new Error("Metered Open Relay requires both an app name and API key");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(appName)) {
    throw new Error("Metered Open Relay app name is invalid");
  }

  const endpoint = new URL(`https://${appName}.metered.live/api/v1/turn/credentials`);
  endpoint.searchParams.set("apiKey", apiKey);
  const response = await fetch(endpoint, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Metered Open Relay returned ${response.status}`);
  const payload = await response.json() as unknown;
  const iceServers = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === "object" ? (payload as Partial<IceServerPayload>).iceServers : undefined);
  if (!validIceServers(iceServers) || !containsTurnServer(iceServers)) {
    throw new Error("Metered Open Relay returned no authenticated relay server");
  }
  const servers = withoutBrowserBlockedPort53(iceServers);
  if (!containsTurnServer(servers)) throw new Error("Metered Open Relay returned no browser-usable relay server");
  return servers;
}

async function genericManagedTurnServers(userId: string, roomId: string): Promise<RTCIceServer[] | null> {
  const endpoint = process.env.TURN_CREDENTIALS_URL;
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.TURN_CREDENTIALS_API_KEY ? { authorization: `Bearer ${process.env.TURN_CREDENTIALS_API_KEY}` } : {}),
    },
    body: JSON.stringify({ userId, roomId, ttl: turnCredentialTtlSeconds() }),
    cache: "no-store",
    signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TURN credential service returned ${response.status}`);
  const payload = await response.json() as Partial<IceServerPayload>;
  if (!validIceServers(payload.iceServers) || !containsTurnServer(payload.iceServers)) {
    throw new Error("TURN credential service returned no authenticated relay server");
  }
  const servers = withoutBrowserBlockedPort53(payload.iceServers);
  if (!containsTurnServer(servers)) throw new Error("TURN credential service returned no browser-usable relay server");
  return servers;
}

async function configuredTurnServers(userId: string, roomId: string): Promise<{ servers: RTCIceServer[]; provider: TurnProvider }> {
  const failures: unknown[] = [];
  const providers: Array<{ name: Exclude<TurnProvider, "static" | "none">; load: () => Promise<RTCIceServer[] | null> }> = [
    { name: "metered", load: () => meteredTurnServers() },
    { name: "cloudflare", load: () => cloudflareTurnServers() },
    { name: "managed", load: () => genericManagedTurnServers(userId, roomId) },
  ];

  for (const provider of providers) {
    try {
      const servers = await provider.load();
      if (servers?.length) return { servers, provider: provider.name };
    } catch (error) {
      failures.push(error);
      console.warn(`[WEBRTC] ${provider.name} TURN provider unavailable; trying the next configured provider`, error);
    }
  }

  const staticTurn = staticTurnServer();
  if (staticTurn) {
    const servers = withoutBrowserBlockedPort53([staticTurn]);
    if (containsTurnServer(servers)) return { servers, provider: "static" };
  }
  if (failures.length) throw new AggregateError(failures, "Every configured TURN provider failed");
  return { servers: [], provider: "none" };
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const roomId = request.nextUrl.searchParams.get("roomId");
  if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) return NextResponse.json({ error: "Invalid room." }, { status: 400 });
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "WebRTC network configuration is unavailable." }, { status: 503 });
  if (!await allowDistributedRequest(supabase, `ice-config:${user.id}`, 12, 60)) {
    return NextResponse.json({ error: "Please wait before requesting call configuration again." }, { status: 429 });
  }
  const { data: membership } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not an active room member." }, { status: 403 });

  try {
    const turn = await configuredTurnServers(String(user.id), roomId);
    const turnConfigured = containsTurnServer(turn.servers);
    const iceServers = [...configuredStunServers(), ...turn.servers];
    return NextResponse.json({
      iceServers,
      forceRelay: process.env.NODE_ENV !== "production" && process.env.WEBRTC_FORCE_RELAY === "true",
      turnConfigured,
      turnProvider: turn.provider,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("[WEBRTC] TURN credentials unavailable", error);
    return NextResponse.json({ error: "TURN credentials are temporarily unavailable." }, { status: 503 });
  }
}
