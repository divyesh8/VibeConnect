import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const proposalId = request.nextUrl.searchParams.get("proposalId");
  if (!proposalId || !/^[0-9a-f-]{36}$/i.test(proposalId)) return NextResponse.json({ error: "Invalid match proposal." }, { status: 400 });

  await supabase.rpc("release_expired_match_proposals");
  const { data: proposal } = await supabase
    .from("match_proposals")
    .select("user1_id, user2_id, user1_accepted, user2_accepted, status, room_id")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal || (proposal.user1_id !== user.id && proposal.user2_id !== user.id)) return NextResponse.json({ error: "Match proposal not found." }, { status: 404 });

  const partnerId = proposal.user1_id === user.id ? proposal.user2_id : proposal.user1_id;
  const partnerAccepted = proposal.user1_id === user.id ? proposal.user2_accepted : proposal.user1_accepted;
  const { data: partner } = await supabase.from("online_users").select("id, username, interests").eq("id", partnerId).maybeSingle();
  if (!partner) return NextResponse.json({ error: "The other user is no longer available." }, { status: 410 });

  return NextResponse.json({ status: proposal.status, roomId: proposal.room_id, partnerAccepted, partner });
}
