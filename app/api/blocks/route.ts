import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { blockSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const parsed = blockSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.blockedUserId === user.id) return NextResponse.json({ error: "Invalid block request." }, { status: 400 });
  const supabase = createServerSupabase();
  if (supabase) {
    const { error } = await supabase.from("blocks").upsert({ blocker_id: user.id, blocked_id: parsed.data.blockedUserId });
    if (error) return NextResponse.json({ error: "Block could not be saved." }, { status: 503 });
  }
  return NextResponse.json({ blocked: true }, { status: 201 });
}
