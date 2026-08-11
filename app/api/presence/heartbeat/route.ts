import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { heartbeatSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Presence is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid presence state." }, { status: 400 });

  const now = new Date().toISOString();
  const update: { last_seen: string; status?: string } = { last_seen: now };
  if (parsed.data.state === "searching" && user.status === "offline") update.status = "searching";
  const { error: updateError } = await supabase.from("online_users").update(update).eq("id", user.id);
  if (updateError) return NextResponse.json({ error: "Presence heartbeat failed." }, { status: 503 });
  const { error: cleanupError } = await supabase.rpc("release_expired_match_proposals");
  if (cleanupError) return NextResponse.json({ error: "Presence cleanup failed." }, { status: 503 });
  if (parsed.data.state === "connected") {
    const { data: activeRoom, error: roomError } = await supabase
      .from("chat_rooms")
      .select("id")
      .in("status", ["connecting", "active"])
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
      .limit(1)
      .maybeSingle();
    if (roomError) return NextResponse.json({ error: "Room presence could not be checked." }, { status: 503 });
    if (!activeRoom) {
      await supabase.from("online_users").update({ last_seen: now, status: "offline" }).eq("id", user.id);
      return NextResponse.json({ online: true, roomActive: false });
    }
  }
  return NextResponse.json({ online: true, roomActive: parsed.data.state === "connected" ? true : undefined });
}
