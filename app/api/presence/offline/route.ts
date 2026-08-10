import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { createServerSupabase } from "@/services/supabase";

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ offline: true });
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ offline: true });
  const { error } = await supabase.rpc("mark_user_offline", { p_user_id: user.id });
  if (error) return NextResponse.json({ error: "Presence could not be closed." }, { status: 503 });
  return NextResponse.json({ offline: true });
}
