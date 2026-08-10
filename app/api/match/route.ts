import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { allowDistributedRequest } from "@/lib/server/security";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const supabase = createServerSupabase();
  if (!await allowDistributedRequest(supabase, `match:${user.id}`, 12, 60)) return NextResponse.json({ error: "Please wait before matching again." }, { status: 429 });
  if (!supabase) return NextResponse.json({ matched: false });

  const { data, error } = await supabase.rpc("match_anonymous_user", { p_user_id: user.id });
  if (error) return NextResponse.json({ error: "Matching is temporarily unavailable." }, { status: 503 });
  const match = Array.isArray(data) ? data[0] : data;
  if (!match?.room_id) return NextResponse.json({ matched: false });

  return NextResponse.json({
    matched: true,
    roomId: match.room_id,
    partner: { id: match.partner_id, username: match.partner_username, interests: match.partner_interests ?? [] },
  });
}
