"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Headphones, MessageCircleMore, Sparkles, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { getLocalProfile } from "@/lib/session";
import { formatDuration } from "@/lib/utils";
import type { AnonymousProfile, MatchResult } from "@/types";

const modeIcon = {
  text: MessageCircleMore,
  voice: Headphones,
  video: Video,
};

const searchNotes = [
  "Scanning for shared interests",
  "Looking for someone on your wavelength",
  "Checking the friendly queue",
  "Almost there — good vibes take a second",
];

export function MatchingExperience() {
  const router = useRouter();
  const [profile, setProfile] = useState<AnonymousProfile | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [matched, setMatched] = useState(false);
  const [partner, setPartner] = useState({ username: "Nova", interests: ["Music", "Travel"] });
  const note = searchNotes[Math.min(Math.floor(seconds / 4), searchNotes.length - 1)];

  useEffect(() => {
    const stored = getLocalProfile();
    if (!stored) {
      router.replace("/start");
      return;
    }
    setProfile(stored);

    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    let active = true;

    async function findMatch() {
      try {
        const response = await fetch("/api/match", { method: "POST" });
        const result = (response.ok ? await response.json() : null) as MatchResult | null;
        if (active && result?.matched && result.partner) {
          setPartner({ username: result.partner.username, interests: result.partner.interests });
          setMatched(true);
          window.clearInterval(timer);
          window.setTimeout(() => router.push(`/chat/${result.roomId ?? crypto.randomUUID()}`), 1700);
          return;
        }
      } catch {
        // Local preview falls through to a realistic simulated match.
      }
      if (!active) return;
      window.setTimeout(() => {
        if (!active) return;
        setMatched(true);
        window.clearInterval(timer);
        window.setTimeout(() => router.push(`/chat/${crypto.randomUUID()}`), 1700);
      }, 4300);
    }

    findMatch();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [router]);

  const ModeIcon = useMemo(() => modeIcon[profile?.mode ?? "text"], [profile?.mode]);

  return (
    <main className="app-page flex min-h-screen flex-col px-5 py-6 sm:px-8">
      <AmbientBackground />
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] font-bold text-white/38">
          <ModeIcon className="size-3.5 text-[#78f7df]" />
          {profile?.mode ?? "text"} mode
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 items-center justify-center py-12">
        <AnimatePresence mode="wait">
          {!matched ? (
            <motion.div key="searching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.94 }} className="w-full text-center">
              <div className="relative mx-auto grid size-[260px] place-items-center sm:size-[300px]">
                <div className="search-ring" />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="grid size-36 place-items-center rounded-full border border-white/[0.09] bg-[#0c0a12]/95 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_20px_60px_rgba(0,0,0,.4)]">
                    <div>
                      <div className="mx-auto flex h-8 items-end justify-center gap-1">
                        {[1, 2, 3, 4, 5].map((bar) => <span key={bar} className="signal-bar" />)}
                      </div>
                      <p className="mt-3 font-display text-sm font-bold tracking-tight">tuning in</p>
                    </div>
                  </div>
                </div>
                <motion.div animate={{ rotate: -360 }} transition={{ duration: 13, ease: "linear", repeat: Infinity }} className="absolute inset-0">
                  <div className="profile-gradient-1 absolute left-[9%] top-[50%] grid size-11 -translate-y-1/2 place-items-center rounded-2xl border-2 border-[#0a0910] text-xs font-black shadow-xl">M</div>
                  <div className="profile-gradient-2 absolute right-[12%] top-[18%] grid size-9 place-items-center rounded-xl border-2 border-[#0a0910] text-[10px] font-black text-[#102320] shadow-xl">K</div>
                  <div className="profile-gradient-3 absolute bottom-[11%] right-[22%] grid size-8 place-items-center rounded-xl border-2 border-[#0a0910] text-[9px] font-black text-[#2c1708] shadow-xl">J</div>
                </motion.div>
              </div>

              <h1 className="mt-8 font-display text-4xl font-semibold tracking-[-.055em] sm:text-5xl">Finding your vibe<span className="text-[#78f7df]">...</span></h1>
              <motion.p key={note} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-4 h-6 max-w-md text-sm text-white/40">{note}</motion.p>

              <GlassCard className="mx-auto mt-8 flex max-w-sm items-center justify-between rounded-2xl px-4 py-3 text-left">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-xl bg-white/[0.06] text-white/55"><Sparkles className="size-4" /></div>
                  <div><p className="text-[10px] font-bold text-white/30">Matching as</p><p className="text-xs font-extrabold">{profile?.username ?? "Anonymous"}</p></div>
                </div>
                <div className="text-right"><p className="text-[10px] font-bold text-white/30">Wait time</p><p className="font-display text-sm font-bold tabular-nums">{formatDuration(seconds)}</p></div>
              </GlassCard>
              <Button variant="ghost" className="mt-6 text-white/38 hover:text-rose-200" onClick={() => router.push("/start")}>
                <X className="size-4" /> Cancel search
              </Button>
            </motion.div>
          ) : (
            <motion.div key="matched" initial={{ opacity: 0, scale: 0.78 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 180, damping: 17 }} className="w-full text-center">
              <div className="relative mx-auto grid size-44 place-items-center">
                <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 1.4, repeat: Infinity }} className="absolute inset-0 rounded-full border border-[#78f7df]/30" />
                <div className="absolute inset-2 rounded-full bg-[#78f7df]/10 blur-2xl" />
                <div className="profile-gradient-2 relative grid size-28 place-items-center rounded-[38px] border-4 border-[#0b0911] font-display text-3xl font-bold text-[#0b2823] shadow-[0_0_70px_rgba(120,247,223,.2)]">
                  {partner.username.slice(0, 1).toUpperCase()}
                  <span className="absolute -bottom-2 -right-2 grid size-9 place-items-center rounded-full border-4 border-[#0b0911] bg-[#78f7df] text-black"><Check className="size-4" strokeWidth={3} /></span>
                </div>
              </div>
              <div className="eyebrow mt-6"><span className="status-dot" /> Match found</div>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.055em] sm:text-5xl">You matched with {partner.username}</h1>
              <p className="mt-4 text-sm text-white/40">Shared vibe: {partner.interests.join(" + ")}</p>
              <p className="mt-8 text-xs font-bold text-white/25">Opening your conversation...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
