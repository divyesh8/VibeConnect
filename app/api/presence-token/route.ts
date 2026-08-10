import { NextRequest, NextResponse } from "next/server";
import { signRealtimeToken } from "@/lib/server/realtime-token";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Presence is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode !== user.communication_mode) return NextResponse.json({ error: "Invalid queue." }, { status: 403 });
  const token = await signRealtimeToken(String(user.id));
  if (!token) return NextResponse.json({ error: "Realtime is not configured." }, { status: 503 });
  return NextResponse.json({ token });
}
