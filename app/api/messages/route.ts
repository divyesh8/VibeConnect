import { NextRequest, NextResponse } from "next/server";
import { allowRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { cleanText, messageSchema } from "@/lib/validation";
import { moderateText } from "@/services/moderation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  if (!allowRequest(`message:${user.id}`, 18, 10_000).allowed) return NextResponse.json({ error: "You are sending messages too quickly." }, { status: 429 });

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid message." }, { status: 400 });
  const content = cleanText(parsed.data.content);
  const moderation = await moderateText(content);
  const supabase = createServerSupabase();

  if (moderation.flagged) {
    if (supabase) {
      await supabase.from("moderation_events").insert({ user_id: user.id, room_id: parsed.data.roomId, source: moderation.source, categories: moderation.categories, scores: moderation.scores ?? {} });
      const nextWarningCount = Number(user.warning_count ?? 0) + 1;
      await supabase.from("users_online").update({ warning_count: nextWarningCount }).eq("id", user.id);
      if (nextWarningCount >= 3) {
        await supabase.from("banned_users").upsert({ user_id: user.id, reason: "Repeated moderated content", expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      }
    }
    return NextResponse.json({ error: "That message goes against our community rules.", warning: true }, { status: 422 });
  }

  const message = { id: parsed.data.clientId ?? crypto.randomUUID(), room_id: parsed.data.roomId, sender_id: user.id, content, created_at: new Date().toISOString() };
  if (supabase) {
    const { data: membership } = await supabase.from("room_members").select("room_id").eq("room_id", parsed.data.roomId).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "You are not a member of this room." }, { status: 403 });
    const { error } = await supabase.from("messages").insert(message);
    if (error) return NextResponse.json({ error: "Message could not be saved." }, { status: 503 });
  }
  return NextResponse.json({ message }, { status: 201 });
}
