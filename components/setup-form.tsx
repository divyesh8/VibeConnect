"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  LogOut,
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
import { useGuestProfile } from "@/components/guest-profile-provider";
import { GENDERS } from "@/lib/constants";
import { displayNameSchema } from "@/lib/validation";
import { ensureAnonymousAuth } from "@/services/supabase";
import { cn } from "@/lib/utils";
import type { AnonymousProfile, Gender } from "@/types";

export function SetupForm() {
  const router = useRouter();
  const { profile, isLoaded, setProfile, updateProfile, clearProfile } = useGuestProfile();
  const [username, setUsername] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    setSubmitting(true);
    try {
      if (profile) {
        const response = await fetch("/api/session", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Your session preferences could not be updated.");
        updateProfile({ mode: "video", interests: [] });
        router.push("/matching");
        return;
      }

      const parsedName = displayNameSchema.safeParse(username);
      if (!parsedName.success) {
        throw new Error(parsedName.error.issues[0]?.message ?? "Enter a valid display name.");
      }
      if (!gender) throw new Error("Choose the option that feels right for you.");
      if (!ageConfirmed) throw new Error("You must confirm that you are 18 or older to continue.");
      if (turnstileSiteKey && !botToken) throw new Error("Complete the anti-bot check before continuing.");

      const authSession = await ensureAnonymousAuth();
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify({ username: parsedName.data, gender, botToken: botToken || undefined }),
      });
      const data = await response.json() as { profile?: AnonymousProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error ?? "Live matching is unavailable.");
      setProfile(data.profile);
      router.push("/matching");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Live matching is unavailable. Please try again shortly.");
      setSubmitting(false);
    }
  }

  async function resetGuestProfile() {
    await fetch("/api/presence/offline", { method: "POST", keepalive: true }).catch(() => undefined);
    clearProfile();
    setUsername("");
    setGender(null);
    setAgeConfirmed(false);
    setError("");
  }

  if (!isLoaded) {
    return <main className="app-page grid min-h-screen place-items-center"><AmbientBackground /><div className="flex items-center gap-3 text-sm font-bold text-white/45"><span className="status-dot" /> Restoring your temporary profile...</div></main>;
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
                <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#8df6e1]">{profile ? "Your session is active" : "Step 01 of 03"}</p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-[-.045em] sm:text-3xl">{profile ? "Ready to meet someone new?" : "Tell us the basics"}</h2>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label="Back home">
                <Link href="/"><ArrowLeft className="size-4" /></Link>
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-7">
              {profile ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-[#78f7df]/15 bg-[#78f7df]/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-extrabold text-white">{profile.username}</p><p className="mt-1 text-[10px] capitalize text-white/35">{profile.gender} · temporary profile</p></div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void resetGuestProfile()} className="text-white/40 hover:text-rose-200"><LogOut className="size-3.5" /> Exit / reset profile</Button>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="username" className="mb-2.5 block text-xs font-extrabold text-white/70">Your display name</label>
                    <div className="relative">
                      <input
                        id="username"
                        value={username}
                        onChange={(event) => setUsername(Array.from(event.target.value).slice(0, 30).join(""))}
                        placeholder="1–30 characters"
                        autoComplete="nickname"
                        className="h-13 w-full rounded-2xl border border-white/10 bg-black/20 px-4 pr-16 text-sm font-semibold text-white outline-none transition placeholder:text-white/20 focus:border-[#78f7df]/45 focus:ring-4 focus:ring-[#78f7df]/[0.07]"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/20">{Array.from(username).length}/30</span>
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
                </>
              )}

              {!profile && turnstileSiteKey && (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                  <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
                  <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="dark" data-size="flexible" data-action="create-session" data-callback="onVibeConnectTurnstile" data-expired-callback="onVibeConnectTurnstileExpired" />
                </div>
              )}

              <div className="flex items-center gap-4 rounded-2xl border border-[#a988ff]/35 bg-[#9d78ff]/[0.1] p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-black"><Camera className="size-[19px]" /></span>
                <div>
                  <p className="text-xs font-extrabold text-white">Video connection</p>
                  <p className="mt-1 text-[10px] leading-4 text-white/38">Camera stays on during every call. You can mute or unmute your microphone at any time.</p>
                </div>
              </div>

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
                  {submitting ? (profile ? "Preparing video..." : "Creating your vibe...") : "Find someone"}
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
