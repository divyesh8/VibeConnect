import type { NextRequest } from "next/server";
import { createServerSupabase } from "@/services/supabase";
import { sha256 } from "@/lib/server/security";

export const SESSION_COOKIE = "vc_session";
export const PREVIEW_USER_COOKIE = "vc_preview_user";

export async function getSessionUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const supabase = createServerSupabase();
  if (supabase && token) {
    const tokenHash = await sha256(token);
    const { data } = await supabase
      .from("users_online")
      .select("id, username, gender, communication_type, interests, status, warning_count")
      .eq("session_token_hash", tokenHash)
      .maybeSingle();
    return data;
  }
  const previewUserId = request.cookies.get(PREVIEW_USER_COOKIE)?.value;
  return previewUserId ? { id: previewUserId, username: "PreviewUser", status: "connected", warning_count: 0 } : null;
}
