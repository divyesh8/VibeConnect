import { NextRequest, NextResponse } from "next/server";
import { requestIp, allowRequest, sha256 } from "@/lib/server/security";
import { PREVIEW_USER_COOKIE, SESSION_COOKIE } from "@/lib/server/session";
import { sessionSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const ip = requestIp(request);
  if (!allowRequest(`session:${ip}`, 8, 60_000).allowed) {
    return NextResponse.json({ error: "Too many sessions created. Try again shortly." }, { status: 429 });
  }

  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile details." }, { status: 400 });

  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  const tokenHash = await sha256(sessionToken);
  const createdAt = new Date().toISOString();
  const supabase = createServerSupabase();

  if (supabase) {
    const { error } = await supabase.from("users_online").insert({
      id: userId,
      session_id: sessionId,
      session_token_hash: tokenHash,
      username: parsed.data.username,
      gender: parsed.data.gender,
      communication_type: parsed.data.mode,
      interests: parsed.data.interests,
      status: "searching",
      last_seen_at: createdAt,
      created_at: createdAt,
    });
    if (error) return NextResponse.json({ error: "Could not create an anonymous session." }, { status: 503 });
  }

  const response = NextResponse.json({
    profile: {
      id: userId,
      sessionId,
      username: parsed.data.username,
      gender: parsed.data.gender,
      mode: parsed.data.mode,
      interests: parsed.data.interests,
      createdAt,
    },
  }, { status: 201 });

  response.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 8 });
  response.cookies.set(PREVIEW_USER_COOKIE, userId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 8 });
  return response;
}
