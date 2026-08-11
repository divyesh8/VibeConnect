"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  MessageCircleMore,
  Mic2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { GENDERS, INTERESTS, MODES } from "@/lib/constants";
import { saveLocalProfile } from "@/lib/session";
import { ensureAnonymousAuth } from "@/services/supabase";
import { cn } from "@/lib/utils";
import type { AnonymousProfile, CommunicationMode, Gender } from "@/types";

const modeIcons = {
  text: MessageCircleMore,
  voice: Mic2,
  video: Camera,
};

export function SetupForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [mode, setMode] = useState<CommunicationMode>("text");
  const [interests, setInterests] = useState<string[]>([]);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    const browserWindow = window as typeof window & {
      onVibeConnectTurnstile?: (token: string) => void;
      onVibeConnectTurnstileExpired?: () => void;
    };
    browserWindow.onVibeConnectTurnstile = (token) => setBotToken(token);
    browserWindow.onVibeConnectTurnstileExpired = () => setBotToken("");
    return () => {
      delete browserWindow.onVibeConnectTurnstile;
      delete browserWindow.onVibeConnectTurnstileExpired;
    };
  }, []);

  const toggleInterest = (interest: string) => {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : current.length < 5
          ? [...current, interest]
          : current,
    );
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) {
      setError("Your nickname needs at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
      setError("Use letters, numbers, underscores, or dashes only.");
      return;
    }
    if (!gender) {
      setError("Choose the option that feels right for you.");
      return;
    }
    if (!ageConfirmed) {
      setError("You must confirm that you are 18 or older to continue.");
      return;
    }
    if (turnstileSiteKey && !botToken) {
      setError("Complete the anti-bot check before continuing.");
      return;
    }

    setSubmitting(true);
    try {
      const authSession = await ensureAnonymousAuth();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify({ username: cleanUsername, gender, mode, interests, botToken: botToken || undefined }),
      });
      const data = await response.json() as { profile?: AnonymousProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error ?? "Live matching is unavailable.");
      const profile = data.profile;
      saveLocalProfile(profile);
      router.push("/matching");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Live matching is unavailable. Please try again shortly.");
      setSubmitting(false);
    }
  }

  return (
    <main className="app-page min-h-screen overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6">
      <AmbientBackground />
      <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between py-2 sm:py-3">
        <Logo />
        <div className="hidden items-center gap-3 text-[10px] font-extrabold uppercase tracking-[.16em] text-white/30 sm:flex">
          <span className="text-white">Your vibe</span>
          <span className="h-px w-8 bg-white/15" />
          <span>Match</span>
          <span className="h-px w-8 bg-white/15" />
          <span>Connect</span>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1180px] gap-6 pb-10 pt-5 lg:grid-cols-[.72fr_1.28fr] lg:items-stretch lg:pt-8">
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="relative hidden min-h-[680px] overflow-hidden rounded-[32px] border border-white/[0.08] bg-[#0d0b14]/65 p-8 lg:flex lg:flex-col"
        >
          <div className="absolute -left-28 -top-28 size-80 rounded-full bg-[#9d78ff]/20 blur-[85px]" />
          <div className="absolute -bottom-28 -right-28 size-80 rounded-full bg-[#78f7df]/15 blur-[85px]" />
          <div className="relative">
            <div className="eyebrow"><Sparkles className="size-3.5" /> Make it yours</div>
            <h1 className="mt-6 text-balance font-display text-[3.3rem] font-semibold leading-[.95] tracking-[-.065em]">Set your vibe.<br /><span className="text-white/28">We&apos;ll find the rest.</span></h1>
            <p className="mt-6 max-w-sm text-sm leading-6 text-white/43">A nickname is all you need. Your session goes offline when you leave.</p>
          </div>

          <div className="relative mt-auto space-y-3">
            <div className="glass-subtle flex items-center gap-3 rounded-2xl p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-[#78f7df]/10 text-[#8cf7e3]"><ShieldCheck className="size-[18px]" /></span>
              <div><p className="text-xs font-extrabold">Private by default</p><p className="mt-1 text-[11px] leading-4 text-white/36">No account. No contacts. No stored media.</p></div>
            </div>
            <p className="px-2 text-[10px] leading-4 text-white/24">By continuing, you confirm you&apos;re 18+ and agree to keep conversations respectful.</p>
          </div>
        </motion.aside>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <GlassCard className="rounded-[32px] p-5 sm:p-8 lg:min-h-[680px] lg:p-10">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#8df6e1]">Step 01 of 03</p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-[-.045em] sm:text-3xl">Tell us the basics</h2>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label="Back home">
                <Link href="/"><ArrowLeft className="size-4" /></Link>
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-7">
              <div>
                <label htmlFor="username" className="mb-2.5 block text-xs font-extrabold text-white/70">Your nickname</label>
                <div className="relative">
                  <input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value.slice(0, 20))}
                    placeholder="3–20 characters"
                    autoComplete="off"
                    className="h-13 w-full rounded-2xl border border-white/10 bg-black/20 px-4 pr-16 text-sm font-semibold text-white outline-none transition placeholder:text-white/20 focus:border-[#78f7df]/45 focus:ring-4 focus:ring-[#78f7df]/[0.07]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/20">{username.length}/20</span>
                </div>
              </div>

              <fieldset>
                <legend className="mb-2.5 text-xs font-extrabold text-white/70">Gender</legend>
                <div className="grid grid-cols-3 gap-2">
                  {GENDERS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setGender(item.value)}
                      className={cn(
                        "relative min-h-12 rounded-2xl border px-3 py-2 text-xs font-bold transition",
                        gender === item.value
                          ? "border-[#78f7df]/45 bg-[#78f7df]/10 text-white"
                          : "border-white/[0.08] bg-white/[0.035] text-white/42 hover:border-white/15 hover:text-white/75",
                      )}
                    >
                      {gender === item.value && <Check className="absolute right-2 top-2 size-3 text-[#78f7df]" />}
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                <input id="age-confirmation" type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} className="mt-0.5 size-4 accent-[#78f7df]" />
                <div><label htmlFor="age-confirmation" className="cursor-pointer text-xs font-extrabold text-white/72">I am 18 or older</label><span className="mt-1 block text-[10px] leading-4 text-white/32">Stranger conversations can be unpredictable. Minors may not use this service.</span></div>
              </div>

              {turnstileSiteKey && (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                  <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
                  <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="dark" data-size="flexible" data-action="create-session" data-callback="onVibeConnectTurnstile" data-expired-callback="onVibeConnectTurnstileExpired" />
                </div>
              )}

              <fieldset>
                <legend className="mb-2.5 text-xs font-extrabold text-white/70">How do you want to connect?</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MODES.map((item) => {
                    const Icon = modeIcons[item.value];
                    const selected = mode === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setMode(item.value)}
                        className={cn(
                          "group flex items-center gap-3 rounded-2xl border p-3 text-left transition sm:block sm:p-4",
                          selected
                            ? "border-[#a988ff]/55 bg-[#9d78ff]/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,.07)]"
                            : "border-white/[0.08] bg-white/[0.035] hover:border-white/15",
                        )}
                      >
                        <span className={cn("grid size-10 place-items-center rounded-xl transition sm:mb-4", selected ? "bg-white text-black" : "bg-white/[0.06] text-white/45 group-hover:text-white")}><Icon className="size-[18px]" /></span>
                        <span><span className="block text-xs font-extrabold">{item.label}</span><span className="mt-1 block text-[10px] text-white/32">{item.description}</span></span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <div className="mb-2.5 flex items-center justify-between">
                  <legend className="text-xs font-extrabold text-white/70">What are you into? <span className="font-medium text-white/25">optional</span></legend>
                  <span className="text-[10px] font-bold text-white/25">Pick up to 5</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {INTERESTS.map((interest) => {
                    const selected = interests.includes(interest);
                    return (
                      <button
                        key={interest}
                        type="button"
                        onClick={() => toggleInterest(interest)}
                        className={cn(
                          "rounded-full border px-3.5 py-2 text-[11px] font-bold transition",
                          selected
                            ? "border-[#ff62b5]/45 bg-[#ff62b5]/10 text-[#ffb4db]"
                            : "border-white/[0.08] bg-white/[0.03] text-white/38 hover:text-white/70",
                        )}
                      >
                        {interest} {selected && <span className="ml-1">×</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <AnimatePresence mode="wait">
                {error && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs font-semibold text-rose-300" role="alert">
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="flex flex-col gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] leading-4 text-white/26"><ShieldCheck className="mr-1 inline size-3 text-[#78f7df]" /> Friendly conversations only</p>
                <Button type="submit" size="lg" disabled={submitting} className="group sm:min-w-48">
                  {submitting ? "Creating your vibe..." : "Find someone"}
                  {!submitting && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
                </Button>
              </div>
            </form>
          </GlassCard>
        </motion.div>
      </div>
    </main>
  );
}
