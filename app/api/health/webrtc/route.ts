import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

function hasStunServers(): boolean {
  const urls = (process.env.STUN_URLS ?? "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return urls.length > 0;
}

function detectTurnProvider(): { configured: boolean; provider: string } {
  if (process.env.METERED_TURN_APP_NAME && process.env.METERED_TURN_API_KEY) {
    return { configured: true, provider: "metered" };
  }
  if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
    return { configured: true, provider: "cloudflare" };
  }
  if (process.env.TURN_CREDENTIALS_URL) {
    return { configured: true, provider: "managed" };
  }
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    return { configured: true, provider: "static" };
  }
  return { configured: false, provider: "none" };
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  const user = await getSessionUser(request);
  const stunConfigured = hasStunServers();
  const turnInfo = detectTurnProvider();
  const clientSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  );

  const ok = Boolean(supabase && stunConfigured && clientSupabaseConfigured);

  return NextResponse.json({
    ok,
    supabaseConfigured: Boolean(supabase),
    clientSupabaseConfigured,
    sessionAvailable: Boolean(user),
    stunConfigured,
    turnConfigured: turnInfo.configured,
    turnProvider: turnInfo.provider,
  }, {
    headers: { "cache-control": "no-store" },
  });
}

