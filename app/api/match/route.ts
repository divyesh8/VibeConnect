import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  if (!await allowDistributedRequest(supabase, `match:${user.id}`, 40, 60)) {
    return NextResponse.json({ error: "Please wait before checking the queue again." }, { status: 429 });
  }

  const now = new Date().toISOString();
  const heartbeatUpdate: { last_seen: string; status?: string } = { last_seen: now };
  if (user.status === "offline") heartbeatUpdate.status = "searching";
  await supabase.from("online_users").update(heartbeatUpdate).eq("id", user.id);
  if (process.env.NODE_ENV === "development") console.info("[MATCH] User added to queue:", { mode: user.communication_mode, previousStatus: user.status });

  const { data, error } = await supabase.rpc("propose_real_match", { p_user_id: user.id });
  if (error) return NextResponse.json({ error: "Matching is temporarily unavailable." }, { status: 503 });
  const proposal = Array.isArray(data) ? data[0] : data;
  if (!proposal?.proposal_id) return NextResponse.json({ proposal: null });
  if (process.env.NODE_ENV === "development") {
    const { data: partner } = await supabase.from("online_users").select("gender").eq("id", proposal.partner_id).maybeSingle();
    const preferredOppositeGender = (user.gender === "male" && partner?.gender === "female") || (user.gender === "female" && partner?.gender === "male");
    console.info("[MATCH] Match found:", { mode: user.communication_mode, preferredOppositeGender });
    if (!preferredOppositeGender) console.info("[MATCH] Fallback same-gender/any-gender match:", { mode: user.communication_mode });
  }

  return NextResponse.json({
    proposal: {
      id: proposal.proposal_id,
      expiresAt: proposal.expires_at,
      partner: {
        id: proposal.partner_id,
        username: proposal.partner_username,
        interests: proposal.partner_interests ?? [],
      },
    },
  });
}
