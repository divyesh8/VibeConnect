"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Camera,
  Check,
  Flag,
  HeartHandshake,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { AmbientBackground } from "@/components/ambient-background";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";

const steps = [
  {
    number: "01",
    icon: UserRoundPlus,
    title: "Pick your vibe",
    copy: "Choose a nickname and gender. Every connection is face-to-face video, with no account or profile trail.",
  },
  {
    number: "02",
    icon: Zap,
    title: "Match in moments",
    copy: "We look for an opposite-gender match first, then connect you with someone else when needed.",
  },
  {
    number: "03",
    icon: HeartHandshake,
    title: "Say hey",
    copy: "Keep your camera on, choose whether to use your microphone, and leave anytime.",
  },
];

export function LandingPage() {
  return (
    <main className="app-page overflow-hidden">
      <AmbientBackground />
      <SiteHeader />

      <section className="relative mx-auto grid min-h-[calc(100vh-92px)] w-full max-w-[1240px] items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.03fr_.97fr] lg:gap-8 lg:py-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative z-10 max-w-[680px]"
        >
          <div className="eyebrow mb-6">
            <span className="status-dot" />
            Real people. Live connections. No bots.
          </div>
          <h1 className="text-balance font-display text-[clamp(3.4rem,8vw,6.8rem)] font-semibold leading-[0.88] tracking-[-0.075em]">
            Talk to
            <br />
            <span className="gradient-text">someone new.</span>
          </h1>
          <p className="mt-7 max-w-xl text-balance text-base leading-7 text-white/52 sm:text-lg">
            Meet strangers. Share stories. Make connections. A friendlier corner of the internet, one conversation at a time.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="group sm:w-auto">
              <Link href="/start">
                Start connecting
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <div className="flex items-center gap-2 px-2 py-2 text-xs font-medium text-white/42">
              <ShieldCheck className="size-4 text-[#78f7df]" />
              No signup · free to start · 18+
            </div>
          </div>
          <div className="mt-9 flex flex-wrap gap-2">
            <div className="glass-subtle flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-white/64"><Camera className="size-3.5 text-[#ff89c6]" /> Video always on</div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.94, rotate: 1.5 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.8, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative mx-auto w-full max-w-[520px] lg:ml-auto"
        >
          <div className="hero-halo left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          <GlassCard className="relative overflow-hidden rounded-[34px] p-3 shadow-[0_40px_120px_rgba(0,0,0,.5)]">
            <div className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            <div className="relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0d0b13]/90 p-5 sm:p-7">
              <div className="absolute right-[-15%] top-[-10%] size-56 rounded-full bg-[#78f7df]/10 blur-[70px]" />
              <div className="relative flex items-center justify-between border-b border-white/[0.07] pb-5">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/30">Real-human matching</p><p className="mt-1.5 text-sm font-bold">How every room begins</p></div>
                <ShieldCheck className="size-6 text-[#78f7df]" />
              </div>
              <div className="relative mt-5 grid gap-3">
                {[
                  { icon: UserRoundPlus, title: "You join the live queue", copy: "Your active browser session sends a heartbeat every 10 seconds." },
                  { icon: HeartHandshake, title: "Another real person appears", copy: "Opposite-gender matches are preferred, with same-gender fallback when needed." },
                  { icon: Check, title: "Both people accept", copy: "Only then is a private video room created." },
                ].map(({ icon: Icon, title, copy }, index) => <div key={title} className="flex gap-4 rounded-[20px] border border-white/[0.07] bg-white/[0.035] p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-[#8df6e1]"><Icon className="size-[18px]" /></span><div><div className="flex items-center gap-2"><span className="text-[9px] font-black text-white/20">0{index + 1}</span><h3 className="text-xs font-extrabold">{title}</h3></div><p className="mt-1.5 text-[11px] leading-5 text-white/38">{copy}</p></div></div>)}
              </div>
            </div>
          </GlassCard>

          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="glass-card absolute -bottom-6 -left-3 hidden rounded-2xl px-4 py-3 sm:flex lg:-left-12"
          >
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-xl bg-[#ff62b5]/15 text-[#ff83c4]"><ShieldCheck className="size-4" /></div>
              <div><p className="text-[10px] font-bold text-white/38">No fallback system</p><p className="text-xs font-extrabold">Wait for a real person</p></div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      <section id="how-it-works" className="relative z-10 mx-auto w-full max-w-[1240px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="max-w-xl">
          <div className="eyebrow"><Sparkles className="size-3.5" /> Simple by design</div>
          <h2 className="mt-5 font-display text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">Less setup.<br /><span className="text-white/32">More connection.</span></h2>
        </div>
        <div className="mt-12 grid gap-3 lg:grid-cols-3">
          {steps.map(({ number, icon: Icon, title, copy }, index) => (
            <motion.div
              key={number}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.08 }}
            >
              <GlassCard className="group h-full rounded-[28px] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 sm:p-7">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xs font-bold tracking-[.15em] text-white/25">{number}</span>
                  <span className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/70 transition group-hover:bg-white group-hover:text-black"><Icon className="size-[19px]" /></span>
                </div>
                <h3 className="mt-16 font-display text-xl font-bold tracking-[-0.035em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/43">{copy}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="safety" className="relative z-10 mx-auto w-full max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28">
        <GlassCard className="relative overflow-hidden rounded-[34px] p-7 sm:p-12 lg:p-16">
          <div className="absolute right-[-8%] top-[-40%] size-[420px] rounded-full bg-[#78f7df]/[0.08] blur-[90px]" />
          <div className="relative grid items-center gap-12 lg:grid-cols-[1fr_.9fr]">
            <div>
              <div className="eyebrow"><ShieldCheck className="size-3.5 text-[#78f7df]" /> Built for better conversations</div>
              <h2 className="mt-5 max-w-xl text-balance font-display text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">Safe doesn&apos;t have to feel boring.</h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-white/47 sm:text-base">Fast controls, thoughtful moderation, and private peer-to-peer media help keep the focus where it belongs: on the conversation.</p>
              <Button asChild variant="secondary" className="mt-8">
                <Link href="/start">Find your vibe <ArrowRight className="size-4" /></Link>
              </Button>
            </div>
            <div className="grid gap-3">
              {[
                { icon: LockKeyhole, title: "Your media stays yours", copy: "Video and optional microphone audio travel peer-to-peer. We never record or store a frame." },
                { icon: Flag, title: "Report or block in one tap", copy: "Leave any conversation instantly and prevent future rematches." },
                { icon: ShieldCheck, title: "Active text moderation", copy: "Harmful messages trigger warnings and repeat abuse leads to a temporary ban." },
              ].map(({ icon: Icon, title, copy }) => (
                <div key={title} className="glass-subtle flex gap-4 rounded-[22px] p-4 sm:p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#78f7df]/10 text-[#8df6e1]"><Icon className="size-[18px]" /></span>
                  <div><h3 className="text-sm font-extrabold">{title}</h3><p className="mt-1 text-xs leading-5 text-white/40">{copy}</p></div>
                  <Check className="ml-auto mt-1 size-4 shrink-0 text-[#78f7df]" />
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </section>

      <SiteFooter />
    </main>
  );
}
