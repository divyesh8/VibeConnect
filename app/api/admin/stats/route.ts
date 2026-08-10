import { NextRequest, NextResponse } from "next/server";
import { secureEquals } from "@/lib/server/security";
import { createServerSupabase } from "@/services/supabase";

export async function GET(request: NextRequest) {
  const configured = process.env.ADMIN_ACCESS_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !secureEquals(configured, provided)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const supabase = createServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const now = new Date();
  const liveCutoff = new Date(now.getTime() - 25_000).toISOString();
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const [users, rooms, reports, bans, recentRooms, reportRows] = await Promise.all([
    supabase.from("online_users").select("id", { count: "exact", head: true }).neq("status", "offline").gte("last_seen", liveCutoff),
    supabase.from("chat_rooms").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("banned_users").select("id", { count: "exact", head: true }).gt("expires_at", now.toISOString()),
    supabase.from("chat_rooms").select("created_at").gte("created_at", twelveHoursAgo.toISOString()),
    supabase.from("reports").select("id, reported_id, reason, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(8),
  ]);

  const hourlyMatches = Array.from({ length: 12 }, () => 0);
  for (const room of recentRooms.data ?? []) {
    const slot = Math.floor((new Date(room.created_at).getTime() - twelveHoursAgo.getTime()) / 3_600_000);
    if (slot >= 0 && slot < 12) hourlyMatches[slot] += 1;
  }
  const reportData = reportRows.data ?? [];
  const reportedIds = [...new Set(reportData.map((report) => report.reported_id))];
  const reportedUserResult = reportedIds.length
    ? await supabase.from("online_users").select("id, username").in("id", reportedIds)
    : { data: [] as { id: string; username: string }[], error: null };
  if (reportedUserResult.error) return NextResponse.json({ error: "Report identities could not be loaded." }, { status: 503 });
  const reportedUsers = reportedUserResult.data;
  const usernames = new Map((reportedUsers ?? []).map((user) => [user.id, user.username]));
  if (reportData.some((report) => !usernames.has(report.reported_id))) return NextResponse.json({ error: "A report identity is unavailable." }, { status: 503 });

  return NextResponse.json({
    activeUsers: users.count ?? 0,
    activeRooms: rooms.count ?? 0,
    openReports: reports.count ?? 0,
    bannedUsers: bans.count ?? 0,
    hourlyMatches,
    reports: reportData.map((report) => ({ id: report.id, username: usernames.get(report.reported_id), reason: report.reason, createdAt: report.created_at })),
  });
}
