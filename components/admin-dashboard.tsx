"use client";

import { motion } from "framer-motion";
import { Ban, BarChart3, ChevronRight, Flag, LockKeyhole, MessageCircleMore, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

type ReportItem = { id: string; username: string; reason: string; createdAt: string };
type Stats = { activeUsers: number; activeRooms: number; openReports: number; bannedUsers: number; hourlyMatches: number[]; reports: ReportItem[] };

function formatAge(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function AdminDashboard() {
  const [token, setToken] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/admin/stats", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Access denied");
      setStats(await response.json() as Stats);
    } catch {
      setError("That access key is not valid, or live data is unavailable.");
    }
  }

  if (!stats) {
    return <main className="app-page grid min-h-screen place-items-center px-5"><AmbientBackground /><motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md"><div className="mb-8 text-center"><div className="mx-auto grid size-16 place-items-center rounded-[22px] border border-white/10 bg-white/[0.06]"><LockKeyhole className="size-6 text-[#78f7df]" /></div><h1 className="mt-5 font-display text-3xl font-bold tracking-[-.05em]">Trust & Safety</h1><p className="mt-2 text-xs text-white/35">Restricted live operations console</p></div><GlassCard className="rounded-[28px] p-6"><form onSubmit={unlock}><label htmlFor="admin-key" className="mb-2 block text-xs font-bold text-white/55">Admin access key</label><input id="admin-key" value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder="Enter secure key" className="h-12 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-white/18 focus:border-[#78f7df]/40" />{error && <p className="mt-2 text-xs font-bold text-rose-300">{error}</p>}<Button type="submit" className="mt-4 w-full">Open console <ChevronRight className="size-4" /></Button><p className="mt-4 text-center text-[9px] text-white/20">Access requires the configured ADMIN_ACCESS_TOKEN.</p></form></GlassCard></motion.div></main>;
  }

  const cards = [
    { label: "Active users", value: stats.activeUsers, icon: UsersRound, color: "text-[#78f7df]" },
    { label: "Live conversations", value: stats.activeRooms, icon: MessageCircleMore, color: "text-[#a989ff]" },
    { label: "Open reports", value: stats.openReports, icon: Flag, color: "text-[#ff8ac7]" },
    { label: "Active bans", value: stats.bannedUsers, icon: Ban, color: "text-[#ffb879]" },
  ];
  const chartMax = Math.max(1, ...stats.hourlyMatches);

  return <main className="app-page min-h-screen px-4 py-4 sm:px-6 sm:py-6"><AmbientBackground /><div className="mx-auto w-full max-w-[1380px]">
    <header className="flex items-center justify-between py-2"><Logo /><div className="flex items-center gap-2 text-[10px] font-bold text-white/30"><span className="status-dot" /> Live data only</div></header>
    <div className="mt-8"><div className="eyebrow"><ShieldCheck className="size-3.5" /> Operations</div><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.05em]">Community pulse</h1><p className="mt-2 text-xs text-white/34">Current platform health and moderation queue.</p></div>
    <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, color }, index) => <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05 }}><GlassCard className="rounded-[24px] p-5"><span className={`grid size-10 place-items-center rounded-xl bg-white/[0.05] ${color}`}><Icon className="size-[18px]" /></span><p className="mt-5 text-[10px] font-bold text-white/30">{label}</p><p className="mt-1 font-display text-3xl font-bold tracking-[-.05em]">{value.toLocaleString()}</p></GlassCard></motion.div>)}</div>
    <div className="mt-3 grid gap-3 xl:grid-cols-[.88fr_1.12fr]">
      <GlassCard className="rounded-[26px] p-5 sm:p-6"><div className="flex items-center justify-between"><div><div className="flex items-center gap-2 text-xs font-extrabold"><BarChart3 className="size-4 text-[#78f7df]" /> Matches per hour</div><p className="mt-1 text-[10px] text-white/28">Last 12 hours</p></div><span className="rounded-full bg-[#78f7df]/[0.07] px-2.5 py-1 text-[9px] font-bold text-[#8cf7e2]">Live</span></div><div className="mt-8 flex h-56 items-end gap-2 border-b border-white/[0.07]">{stats.hourlyMatches.map((value, index) => <div key={index} className="group relative flex flex-1 items-end"><div style={{ height: `${value === 0 ? 2 : Math.max(8, (value / chartMax) * 100)}%` }} className="w-full rounded-t-md bg-gradient-to-t from-[#7756ce]/70 to-[#78f7df]/80 opacity-70"><span className="absolute -top-6 left-1/2 hidden -translate-x-1/2 text-[8px] font-bold group-hover:block">{value}</span></div></div>)}</div><div className="mt-3 flex justify-between text-[8px] font-bold text-white/20"><span>12h ago</span><span>6h ago</span><span>Now</span></div></GlassCard>
      <GlassCard className="overflow-hidden rounded-[26px]"><div className="border-b border-white/[0.07] p-5 sm:p-6"><div className="flex items-center gap-2 text-xs font-extrabold"><Flag className="size-4 text-[#ff83c4]" /> Open reports</div><p className="mt-1 text-[10px] text-white/28">Newest unreviewed incidents</p></div>{stats.reports.length ? <div className="divide-y divide-white/[0.06]">{stats.reports.map((report) => <div key={report.id} className="flex items-center gap-3 px-5 py-4 sm:px-6"><span className="size-2 rounded-full bg-rose-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{report.username}</p><p className="mt-0.5 text-[9px] text-white/28">{report.id.slice(0, 8)} · {formatAge(report.createdAt)}</p></div><span className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold capitalize text-white/42">{report.reason.replaceAll("_", " ")}</span></div>)}</div> : <p className="p-8 text-center text-xs text-white/30">No open reports.</p>}</GlassCard>
    </div>
  </div></main>;
}
