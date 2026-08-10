"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Clock3, Fingerprint, LogOut, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { clearLocalProfile, getLocalProfile } from "@/lib/session";
import { initials } from "@/lib/utils";
import type { AnonymousProfile } from "@/types";

export function TemporaryProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState<AnonymousProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setProfile(getLocalProfile());
      setLoaded(true);
    });
  }, []);

  function reset() {
    clearLocalProfile();
    router.push("/start");
  }

  return (
    <main className="app-page min-h-screen px-5 py-6 sm:px-8">
      <AmbientBackground />
      <header className="mx-auto flex w-full max-w-[980px] items-center justify-between"><Logo /><Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft className="size-4" /> Home</Link></Button></header>
      <div className="mx-auto flex min-h-[calc(100vh-100px)] w-full max-w-[760px] items-center justify-center py-12">
        {loaded && !profile ? (
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <div className="mx-auto grid size-20 place-items-center rounded-[26px] border border-white/10 bg-white/[0.05]"><UserRound className="size-7 text-white/45" /></div>
            <h1 className="mt-7 font-display text-4xl font-semibold tracking-[-.055em]">No active vibe yet.</h1>
            <p className="mt-3 text-sm text-white/38">Create a temporary profile to start meeting people.</p>
            <Button asChild className="mt-7"><Link href="/start">Set your vibe <ArrowRight className="size-4" /></Link></Button>
          </motion.div>
        ) : profile ? (
          <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full">
            <div className="mb-8 text-center">
              <div className="eyebrow"><Sparkles className="size-3.5" /> Your temporary profile</div>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.055em] sm:text-5xl">This vibe is just for now.</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/38">It lives in this browser session and helps us match you. Reset it whenever you want.</p>
            </div>
            <GlassCard className="overflow-hidden rounded-[32px] p-5 sm:p-7">
              <div className="relative overflow-hidden rounded-[25px] border border-white/[0.08] bg-black/20 p-6 sm:p-8">
                <div className="absolute -right-20 -top-20 size-64 rounded-full bg-[#9d78ff]/15 blur-[75px]" />
                <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
                  <div className="profile-gradient-1 grid size-24 shrink-0 place-items-center rounded-[32px] font-display text-2xl font-black shadow-2xl">{initials(profile.username)}</div>
                  <div className="flex-1"><div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start"><h2 className="font-display text-2xl font-bold tracking-[-.04em]">{profile.username}</h2><span className="rounded-full border border-[#78f7df]/15 bg-[#78f7df]/[0.07] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[#8cf7e2]">active</span></div><p className="mt-2 text-xs capitalize text-white/35">{profile.gender.replaceAll("_", " ")} · {profile.mode} mode</p><div className="mt-4 flex flex-wrap justify-center gap-1.5 sm:justify-start">{(profile.interests.length ? profile.interests : ["Open to anything"]).map((interest) => <span key={interest} className="rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[10px] font-bold text-white/45">{interest}</span>)}</div></div>
                </div>
              </div>
              <div className="grid gap-3 py-5 sm:grid-cols-3">
                <div className="glass-subtle rounded-2xl p-4"><Fingerprint className="size-4 text-[#78f7df]" /><p className="mt-3 text-[10px] font-bold text-white/28">Session ID</p><p className="mt-1 truncate font-mono text-[10px] text-white/55">{profile.sessionId}</p></div>
                <div className="glass-subtle rounded-2xl p-4"><Clock3 className="size-4 text-[#b294ff]" /><p className="mt-3 text-[10px] font-bold text-white/28">Created</p><p className="mt-1 text-xs font-bold text-white/55">{new Date(profile.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
                <div className="glass-subtle rounded-2xl p-4"><ShieldCheck className="size-4 text-[#ff83c4]" /><p className="mt-3 text-[10px] font-bold text-white/28">Media storage</p><p className="mt-1 text-xs font-bold text-white/55">Always off</p></div>
              </div>
              <div className="flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:justify-between"><Button variant="danger" onClick={reset}><LogOut className="size-4" /> Reset profile</Button><Button asChild><Link href="/matching">Start matching <ArrowRight className="size-4" /></Link></Button></div>
            </GlassCard>
          </motion.div>
        ) : null}
      </div>
    </main>
  );
}
