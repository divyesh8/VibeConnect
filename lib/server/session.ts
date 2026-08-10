import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/services/supabase";
import { sha256 } from "@/lib/server/security";

export const SESSION_COOKIE = "vc_session";

export async function getSessionUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const supabase = createServerSupabase();
  if (!supabase || !token) return null;
  const tokenHash = await sha256(token);
  const { data } = await supabase
    .from("online_users")
    .select("id, username, gender, communication_mode, interests, status, warning_count, last_seen")
    .eq("session_token_hash", tokenHash)
    .maybeSingle();
  return data;
}
