"use client";

import { motion } from "framer-motion";
import { Activity, Ban, BarChart3, ChevronRight, CircleUserRound, Flag, LockKeyhole, MessageCircleMore, Search, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

type Stats = { activeUsers: number; activeRooms: number; openReports: number; bannedUsers: number; hourlyMatches: number[] };

const previewStats: Stats = { activeUsers: 2841, activeRooms: 1107, openReports: 18, bannedUsers: 43, hourlyMatches: [18, 31, 27, 46, 44, 64, 59, 82, 71, 94, 84, 112] };
const previewReports = [
  { id: "RP-1842", username: "ghostMode", reason: "Harassment", age: "2m ago", risk: "high" },
  { id: "RP-1841", username: "moonbyte", reason: "Spam", age: "8m ago", risk: "medium" },
  { id: "RP-1839", username: "waveRider", reason: "Hate speech", age: "14m ago", risk: "high" },
  { id: "RP-1837", username: "pixelBloom", reason: "Sexual content", age: "21m ago", risk: "medium" },
];

export function AdminDashboard() {
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [stats, setStats] = useState(previewStats);
  const [error, setError] = useState("");

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/admin/stats", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Access denied");
      const data = await response.json() as Stats;
      setStats(data);
      setUnlocked(true);
    } catch {
      if (token === "preview") setUnlocked(true);
      else setError("That access key is not valid.");
    }
  }

  if (!unlocked) {
    return <main className="app-page grid min-h-screen place-items-center px-5"><AmbientBackground /><motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md"><div className="mb-8 text-center"><div className="mx-auto grid size-16 place-items-center rounded-[22px] border border-white/10 bg-white/[0.06]"><LockKeyhole className="size-6 text-[#78f7df]" /></div><h1 className="mt-5 font-display text-3xl font-bold tracking-[-.05em]">Trust & Safety</h1><p className="mt-2 text-xs text-white/35">Restricted operations console</p></div><GlassCard className="rounded-[28px] p-6"><form onSubmit={unlock}><label htmlFor="admin-key" className="mb-2 block text-xs font-bold text-white/55">Admin access key</label><input id="admin-key" value={token} onChange={(event) => setToken(event.target.value)} type="password" placeholder="Enter secure key" className="h-12 w-full rounded-2xl border border-white/10 bg-black/20 px-4 text-sm outline-none placeholder:text-white/18 focus:border-[#78f7df]/40" />{error && <p className="mt-2 text-xs font-bold text-rose-300">{error}</p>}<Button type="submit" className="mt-4 w-full">Open console <ChevronRight className="size-4" /></Button><p className="mt-4 text-center text-[9px] text-white/20">Use “preview” to inspect the local interface. Live access requires ADMIN_ACCESS_TOKEN.</p></form></GlassCard></motion.div></main>;
  }

  const cards = [
    { label: "Active users", value: stats.activeUsers.toLocaleString(), icon: UsersRound, color: "text-[#78f7df]", delta: "+12.4%" },
    { label: "Live conversations", value: stats.activeRooms.toLocaleString(), icon: MessageCircleMore, color: "text-[#a989ff]", delta: "+8.7%" },
    { label: "Open reports", value: stats.openReports.toString(), icon: Flag, color: "text-[#ff8ac7]", delta: "needs review" },
    { label: "Active bans", value: stats.bannedUsers.toString(), icon: Ban, color: "text-[#ffb879]", delta: "24h window" },
  ];

  return (
    <main className="app-page min-h-screen px-4 py-4 sm:px-6 sm:py-6"><AmbientBackground />
      <div className="mx-auto w-full max-w-[1380px]">
        <header className="flex items-center justify-between py-2"><div className="flex items-center gap-5"><Logo /><span className="hidden h-5 w-px bg-white/10 sm:block" /><span className="hidden text-xs font-bold text-white/35 sm:block">Trust & Safety Console</span></div><div className="flex items-center gap-3"><div className="hidden items-center gap-2 text-[10px] font-bold text-white/30 sm:flex"><span className="status-dot" /> All systems normal</div><div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]"><CircleUserRound className="size-4" /></div></div></header>
        <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="eyebrow"><ShieldCheck className="size-3.5" /> Operations</div><h1 className="mt-3 font-display text-3xl font-bold tracking-[-.05em] sm:text-4xl">Community pulse</h1><p className="mt-2 text-xs text-white/34">Live platform health and moderation queue.</p></div><div className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/25" /><input aria-label="Search user or room" placeholder="Search user or room..." className="h-11 w-full rounded-full border border-white/10 bg-white/[0.045] pl-10 pr-4 text-xs outline-none placeholder:text-white/22 focus:border-[#78f7df]/35 sm:w-64" /></div></div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, color, delta }, index) => <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .05 }}><GlassCard className="rounded-[24px] p-5"><div className="flex items-center justify-between"><span className={`grid size-10 place-items-center rounded-xl bg-white/[0.05] ${color}`}><Icon className="size-[18px]" /></span><span className="text-[9px] font-bold text-white/26">{delta}</span></div><p className="mt-5 text-[10px] font-bold text-white/30">{label}</p><p className="mt-1 font-display text-3xl font-bold tracking-[-.05em]">{value}</p></GlassCard></motion.div>)}</div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[.88fr_1.12fr]">
          <GlassCard className="rounded-[26px] p-5 sm:p-6"><div className="flex items-center justify-between"><div><div className="flex items-center gap-2 text-xs font-extrabold"><BarChart3 className="size-4 text-[#78f7df]" /> Matches per hour</div><p className="mt-1 text-[10px] text-white/28">Last 12 hours</p></div><span className="rounded-full bg-[#78f7df]/[0.07] px-2.5 py-1 text-[9px] font-bold text-[#8cf7e2]">Live</span></div><div className="mt-8 flex h-56 items-end gap-2 border-b border-white/[0.07]">{stats.hourlyMatches.map((value, index) => <div key={index} className="group relative flex flex-1 items-end"><div style={{ height: `${Math.max(16, (value / Math.max(...stats.hourlyMatches)) * 100)}%` }} className="w-full rounded-t-md bg-gradient-to-t from-[#7756ce]/70 to-[#78f7df]/80 opacity-60 transition group-hover:opacity-100"><span className="absolute -top-6 left-1/2 hidden -translate-x-1/2 text-[8px] font-bold group-hover:block">{value}</span></div></div>)}</div><div className="mt-3 flex justify-between text-[8px] font-bold text-white/20"><span>12h ago</span><span>6h ago</span><span>Now</span></div></GlassCard>
          <GlassCard className="overflow-hidden rounded-[26px]"><div className="flex items-center justify-between border-b border-white/[0.07] p-5 sm:p-6"><div><div className="flex items-center gap-2 text-xs font-extrabold"><Flag className="size-4 text-[#ff83c4]" /> Priority reports</div><p className="mt-1 text-[10px] text-white/28">Newest unreviewed incidents</p></div><Button variant="secondary" size="sm">View all</Button></div><div className="divide-y divide-white/[0.06]">{previewReports.map((report) => <div key={report.id} className="flex items-center gap-3 px-5 py-4 transition hover:bg-white/[0.025] sm:px-6"><span className={`size-2 rounded-full ${report.risk === "high" ? "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.6)]" : "bg-amber-300"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{report.username}</p><p className="mt-0.5 text-[9px] text-white/28">{report.id} · {report.age}</p></div><span className="hidden rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold text-white/42 sm:block">{report.reason}</span><Button variant="ghost" size="icon"><ChevronRight className="size-4" /></Button></div>)}</div></GlassCard>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="glass-subtle flex items-center gap-3 rounded-2xl p-4"><Activity className="size-4 text-[#78f7df]" /><div><p className="text-[10px] font-bold text-white/30">Median match time</p><p className="mt-1 text-sm font-extrabold">8.4 seconds</p></div></div><div className="glass-subtle flex items-center gap-3 rounded-2xl p-4"><ShieldCheck className="size-4 text-[#a989ff]" /><div><p className="text-[10px] font-bold text-white/30">Auto-moderated</p><p className="mt-1 text-sm font-extrabold">96.2%</p></div></div><div className="glass-subtle flex items-center gap-3 rounded-2xl p-4"><UsersRound className="size-4 text-[#ff83c4]" /><div><p className="text-[10px] font-bold text-white/30">Healthy sessions</p><p className="mt-1 text-sm font-extrabold">99.1%</p></div></div></div>
      </div>
    </main>
  );
}
