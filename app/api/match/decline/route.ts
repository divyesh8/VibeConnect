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
  const { data, error } = await supabase.rpc("decline_real_match", { p_user_id: user.id, p_proposal_id: parsed.data.proposalId });
  if (error || !data) return NextResponse.json({ error: "Could not decline this connection." }, { status: 503 });
  return NextResponse.json({ declined: true });
}
