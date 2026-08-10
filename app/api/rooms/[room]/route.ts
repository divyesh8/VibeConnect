import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest, { params }: { params: Promise<{ room: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const { room } = await params;
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live rooms are unavailable." }, { status: 503 });
  const { data } = await supabase.from("chat_rooms").select("user1_id, user2_id, mode, status").eq("id", room).maybeSingle();
  if (!data || (data.user1_id !== user.id && data.user2_id !== user.id)) return NextResponse.json({ error: "Not a room member." }, { status: 403 });
  const partnerId = data.user1_id === user.id ? data.user2_id : data.user1_id;
  const { data: partner } = await supabase.from("online_users").select("id, username, interests").eq("id", partnerId).maybeSingle();
  if (!partner) return NextResponse.json({ error: "The other user is no longer available." }, { status: 410 });
  return NextResponse.json({
    initiator: data.user1_id === user.id,
    mode: data.mode,
    status: data.status,
    partner: { id: partner.id, username: partner.username, interests: partner.interests ?? [] },
  });
}
