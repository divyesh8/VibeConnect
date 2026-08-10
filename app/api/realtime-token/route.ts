import { SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const roomId = request.nextUrl.searchParams.get("roomId");
  if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) return NextResponse.json({ error: "Invalid room." }, { status: 400 });
  const supabase = createServerSupabase();
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!supabase || !secret) return NextResponse.json({ error: "Realtime is not configured." }, { status: 503 });
  const { data: membership } = await supabase.from("room_members").select("room_id").eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
  if (!membership) return NextResponse.json({ error: "Not a room member." }, { status: 403 });

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user.id))
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .sign(new TextEncoder().encode(secret));
  return NextResponse.json({ token });
}
