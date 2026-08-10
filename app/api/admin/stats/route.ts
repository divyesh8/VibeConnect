import { NextRequest, NextResponse } from "next/server";
import { secureEquals } from "@/lib/server/security";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest) {
  const configured = process.env.ADMIN_ACCESS_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !secureEquals(configured, provided)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const [users, rooms, reports, bans] = await Promise.all([
    supabase.from("users_online").select("id", { count: "exact", head: true }).neq("status", "offline"),
    supabase.from("chat_rooms").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("banned_users").select("id", { count: "exact", head: true }).gt("expires_at", new Date().toISOString()),
  ]);
  return NextResponse.json({ activeUsers: users.count ?? 0, activeRooms: rooms.count ?? 0, openReports: reports.count ?? 0, bannedUsers: bans.count ?? 0, hourlyMatches: [] });
}
