import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { proposalSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const parsed = proposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid match proposal." }, { status: 400 });

  await supabase.from("online_users").update({ last_seen: new Date().toISOString() }).eq("id", user.id);
  const { data, error } = await supabase.rpc("accept_real_match", { p_user_id: user.id, p_proposal_id: parsed.data.proposalId });
  if (error) return NextResponse.json({ error: "Could not accept this connection." }, { status: 503 });
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ status: result?.proposal_status ?? "invalid", roomId: result?.room_id ?? null });
}
