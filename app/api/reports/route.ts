import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { reportSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const supabase = createServerSupabase();
  if (!await allowDistributedRequest(supabase, `report:${user.id}`, 5, 60 * 60)) return NextResponse.json({ error: "Report limit reached." }, { status: 429 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report." }, { status: 400 });
  if (supabase) {
    const { error } = await supabase.from("reports").insert({ reporter_id: user.id, reported_id: parsed.data.reportedUserId, room_id: parsed.data.roomId, reason: parsed.data.reason });
    if (error) return NextResponse.json({ error: "Report could not be saved." }, { status: 503 });
  }
  return NextResponse.json({ accepted: true }, { status: 201 });
}
