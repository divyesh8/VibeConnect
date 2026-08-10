import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { endRoomSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const parsed = endRoomSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid room." }, { status: 400 });
  const supabase = createServerSupabase();
  if (supabase) {
    const { data: membership } = await supabase.from("room_members").select("room_id").eq("room_id", parsed.data.roomId).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    await supabase.from("chat_rooms").update({ ended_at: new Date().toISOString(), status: "ended" }).eq("id", parsed.data.roomId);
    await supabase.from("users_online").update({ status: "searching" }).eq("id", user.id);
  }
  return NextResponse.json({ ended: true });
}
