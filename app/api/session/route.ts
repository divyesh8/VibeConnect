import { NextRequest, NextResponse } from "next/server";
import { requestIp, allowDistributedRequest, sha256 } from "@/lib/server/security";
import { getSessionUser, SESSION_COOKIE } from "@/lib/server/session";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { profilePreferenceSchema, sessionSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });
  }
  if (!await allowDistributedRequest(supabase, `session:${ip}`, 8, 60)) {
    return NextResponse.json({ error: "Too many sessions created. Try again shortly." }, { status: 429 });
  }

  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile details." }, { status: 400 });
  if (!await verifyTurnstile(parsed.data.botToken, ip)) {
    return NextResponse.json({ error: "The anti-bot check expired or failed. Please try it again." }, { status: 403 });
  }

  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) return NextResponse.json({ error: "Anonymous identity is required." }, { status: 401 });
  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !authData.user?.is_anonymous) return NextResponse.json({ error: "Invalid anonymous identity." }, { status: 401 });
  const userId = authData.user.id;
  const sessionId = crypto.randomUUID();
  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await sha256(sessionToken);
  const createdAt = new Date().toISOString();
  const { error } = await supabase.from("online_users").upsert({
    id: userId,
    session_id: sessionId,
    session_token_hash: tokenHash,
    username: parsed.data.username,
    gender: parsed.data.gender,
    communication_mode: "video",
    interests: [],
    status: "searching",
    last_seen: createdAt,
    created_at: createdAt,
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: "Could not create an anonymous session." }, { status: 503 });

  const response = NextResponse.json({
    profile: {
      id: userId,
      sessionId,
      username: parsed.data.username,
      gender: parsed.data.gender,
      mode: "video",
      interests: [],
      createdAt,
    },
  }, { status: 201 });

  response.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 8 });
  return response;
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Your temporary session expired. Reset the profile to start a new one." }, { status: 401 });
  const parsed = profilePreferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid communication preferences." }, { status: 400 });
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });

  const { data, error } = await supabase
    .from("online_users")
    .update({
      communication_mode: "video",
      interests: [],
      status: "searching",
      last_seen: new Date().toISOString(),
    })
    .eq("id", user.id)
    .is("current_room_id", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Your communication preferences could not be updated." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "End the current conversation before starting another video call." }, { status: 409 });
  return NextResponse.json({ updated: true, mode: "video", interests: [] });
}
