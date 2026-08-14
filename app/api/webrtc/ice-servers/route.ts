import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

type IceServerPayload = { iceServers: RTCIceServer[] };

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

async function cloudflareTurnServers(roomId: string): Promise<RTCIceServer[] | null> {
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
    body: JSON.stringify({ ttl: turnCredentialTtlSeconds(), customIdentifier: roomId }),
    cache: "no-store",
    signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Cloudflare TURN returned ${response.status}`);
  const payload = await response.json() as Partial<IceServerPayload>;
  if (!validIceServers(payload.iceServers) || !containsTurnServer(payload.iceServers)) {
    throw new Error("Cloudflare TURN returned no authenticated relay server");
  }
  return withoutBrowserBlockedPort53(payload.iceServers);
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
  return payload.iceServers;
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
    const cloudflare = await cloudflareTurnServers(roomId);
    const managed = cloudflare ?? await genericManagedTurnServers(String(user.id), roomId);
    const staticTurn = managed?.length ? null : staticTurnServer();
    const turnServers = managed ?? (staticTurn ? [staticTurn] : []);
    const turnConfigured = containsTurnServer(turnServers);
    const iceServers = [...configuredStunServers(), ...turnServers];
    return NextResponse.json({
      iceServers,
      forceRelay: process.env.NODE_ENV !== "production" && process.env.WEBRTC_FORCE_RELAY === "true",
      turnConfigured,
      turnProvider: cloudflare ? "cloudflare" : managed ? "managed" : staticTurn ? "static" : "none",
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("[WEBRTC] TURN credentials unavailable", error);
    return NextResponse.json({ error: "TURN credentials are temporarily unavailable." }, { status: 503 });
  }
}
