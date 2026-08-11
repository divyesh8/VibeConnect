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
  if (!supabase) return NextResponse.json({ error: "Live rooms are unavailable." }, { status: 503 });
  const { data, error } = await supabase.rpc("mark_room_connected", {
    p_user_id: user.id,
    p_room_id: parsed.data.roomId,
  });
  if (error || !data) return NextResponse.json({ error: "The connected call could not be confirmed." }, { status: 503 });
  return NextResponse.json({ connected: true });
}
