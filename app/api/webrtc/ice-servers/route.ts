import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

type IceServerPayload = { iceServers: RTCIceServer[] };

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
    const urls = (server as Record<string, unknown>).urls;
    return typeof urls === "string" || (Array.isArray(urls) && urls.every((url) => typeof url === "string"));
  });
}

async function managedTurnServers(userId: string, roomId: string): Promise<RTCIceServer[] | null> {
  const endpoint = process.env.TURN_CREDENTIALS_URL;
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.TURN_CREDENTIALS_API_KEY ? { authorization: `Bearer ${process.env.TURN_CREDENTIALS_API_KEY}` } : {}),
    },
    body: JSON.stringify({ userId, roomId, ttl: 900 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`TURN credential service returned ${response.status}`);
  const payload = await response.json() as Partial<IceServerPayload>;
  if (!validIceServers(payload.iceServers)) throw new Error("TURN credential service returned invalid ICE servers");
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
    const managed = await managedTurnServers(String(user.id), roomId);
    const staticTurn = managed ? null : staticTurnServer();
    const iceServers = [...configuredStunServers(), ...(managed ?? (staticTurn ? [staticTurn] : []))];
    return NextResponse.json({
      iceServers,
      forceRelay: process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_WEBRTC_FORCE_RELAY === "true",
      turnConfigured: Boolean(managed?.length || staticTurn),
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("[WEBRTC] TURN credentials unavailable", error);
    return NextResponse.json({ error: "TURN credentials are temporarily unavailable." }, { status: 503 });
  }
}
