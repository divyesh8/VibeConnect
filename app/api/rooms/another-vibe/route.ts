import { NextRequest, NextResponse } from "next/server";
import { allowDistributedRequest } from "@/lib/server/security";
import { getSessionUser } from "@/lib/server/session";
import { anotherVibeSchema } from "@/lib/validation";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Live matching is not configured." }, { status: 503 });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Session expired." }, { status: 401 });
  const parsed = anotherVibeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid room." }, { status: 400 });
  if (!await allowDistributedRequest(supabase, `another-vibe:${user.id}`, 10, 60)) {
    return NextResponse.json({ error: "Please wait before trying another vibe again." }, { status: 429 });
  }

  const { data, error } = await supabase.rpc("request_another_vibe", {
    p_user_id: user.id,
    p_room_id: parsed.data.roomId,
  });
  if (error) return NextResponse.json({ error: "Another vibe is temporarily unavailable." }, { status: 503 });

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.result_status === "invalid") {
    return NextResponse.json({ error: "This conversation is no longer active." }, { status: 409 });
  }
  if (result.result_status === "no_match" || !result.proposal_id) {
    return NextResponse.json({ status: "no_match", proposal: null });
  }

  return NextResponse.json({
    status: "pending",
    proposal: {
      id: result.proposal_id,
      expiresAt: result.expires_at,
      partner: {
        id: result.partner_id,
        username: result.partner_username,
        interests: result.partner_interests ?? [],
      },
    },
  });
}
