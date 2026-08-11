"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Headphones, MessageCircleMore, ShieldCheck, UserCheck, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { useGuestProfile } from "@/components/guest-profile-provider";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useQueuePresence } from "@/hooks/use-queue-presence";
import { formatDuration, initials } from "@/lib/utils";
import type { MatchProposalStatus, MatchResult } from "@/types";

const modeIcon = { text: MessageCircleMore, voice: Headphones, video: Video };
type MatchPhase = "searching" | "proposal" | "accepted" | "connecting" | "error";
type RealPartner = { id: string; username: string; interests: string[] };

export function MatchingExperience() {
  const router = useRouter();
  const { profile, isLoaded } = useGuestProfile();
  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<MatchPhase>("searching");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [partner, setPartner] = useState<RealPartner | null>(null);
  const [partnerAccepted, setPartnerAccepted] = useState(false);
  const [error, setError] = useState("");
  const presence = useQueuePresence(profile, phase === "searching" ? "searching" : "confirming", phase !== "error" && phase !== "connecting");

  useEffect(() => {
    if (isLoaded && !profile) router.replace("/start");
  }, [isLoaded, profile, router]);

  useEffect(() => {
    if (phase !== "searching") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!profile || phase !== "searching") return;
    let active = true;
    let pollTimer: number | null = null;

    const checkQueue = async () => {
      try {
        const response = await fetch("/api/match", { method: "POST" });
        const result = await response.json() as MatchResult & { error?: string };
        if (!active) return;
        if (response.status === 401) {
          router.replace("/start");
          return;
        }
        if (!response.ok) {
          setError(result.error ?? "The live queue is temporarily unavailable.");
          setPhase("error");
          return;
        }
        if (result.proposal) {
          setProposalId(result.proposal.id);
          setPartner(result.proposal.partner);
          setPartnerAccepted(false);
          setPhase("proposal");
          return;
        }
        pollTimer = window.setTimeout(checkQueue, 2500);
      } catch {
        if (!active) return;
        setError("We lost contact with the live matching server. No connection was created.");
        setPhase("error");
      }
    };

    void checkQueue();
    return () => {
      active = false;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [phase, profile, router]);

  useEffect(() => {
    if (!proposalId || (phase !== "proposal" && phase !== "accepted")) return;
    let active = true;

    const checkProposal = async () => {
      const response = await fetch(`/api/match/status?proposalId=${encodeURIComponent(proposalId)}`).catch(() => null);
      if (!active || !response) return;
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) resetToQueue();
        return;
      }
      const status = await response.json() as MatchProposalStatus;
      setPartnerAccepted(status.partnerAccepted);
      setPartner(status.partner);
      if (status.status === "matched" && status.roomId) {
        setPhase("connecting");
        presence.handoffToRoom();
        window.setTimeout(() => router.push(`/chat/${status.roomId}`), 650);
      } else if (["declined", "expired", "cancelled", "invalid"].includes(status.status)) {
        resetToQueue();
      }
    };

    void checkProposal();
    const timer = window.setInterval(() => void checkProposal(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  // resetToQueue only mutates local state and is intentionally scoped to this component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, proposalId, presence.handoffToRoom, router]);

  function resetToQueue() {
    setProposalId(null);
    setPartner(null);
    setPartnerAccepted(false);
    setPhase("searching");
  }

  async function acceptProposal() {
    if (!proposalId) return;
    const response = await fetch("/api/match/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId }),
    });
    const result = await response.json() as { status?: string; roomId?: string | null; error?: string };
    if (!response.ok) {
      setError(result.error ?? "This connection could not be confirmed.");
      setPhase("error");
      return;
    }
    if (result.status === "matched" && result.roomId) {
      setPhase("connecting");
      presence.handoffToRoom();
      router.push(`/chat/${result.roomId}`);
      return;
    }
    if (result.status === "pending") setPhase("accepted");
    else resetToQueue();
  }

  async function declineProposal() {
    if (proposalId) {
      await fetch("/api/match/decline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId }),
      }).catch(() => undefined);
    }
    resetToQueue();
  }

  async function cancelSearch() {
    await presence.markOffline();
    router.push("/start");
  }

  const ModeIcon = modeIcon[profile?.mode ?? "text"];
  const queueCopy = presence.presenceConnected
    ? presence.liveSearchingSessions <= 1
      ? "You’re the only live person in this mode right now."
      : `${presence.liveSearchingSessions} real people are live in this mode.`
    : "Waiting for another real person to join.";
  const sharedInterests = partner && profile ? partner.interests.filter((interest) => profile.interests.includes(interest)) : [];

  if (!isLoaded || !profile) {
    return <main className="app-page grid min-h-screen place-items-center"><AmbientBackground /><div className="flex items-center gap-3 text-sm font-bold text-white/45"><span className="status-dot" /> Restoring your temporary profile...</div></main>;
  }

  return (
    <main className="app-page flex min-h-screen flex-col px-5 py-6 sm:px-8">
      <AmbientBackground />
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] font-bold text-white/38">
          <ModeIcon className="size-3.5 text-[#78f7df]" /> {profile?.mode ?? "text"} mode
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 items-center justify-center py-12">
        <AnimatePresence mode="wait">
          {phase === "searching" && (
            <motion.div key="searching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full text-center">
              <div className="relative mx-auto grid size-[260px] place-items-center sm:size-[300px]">
                <div className="search-ring" />
                <div className="absolute inset-0 grid place-items-center">
                  <div className="grid size-36 place-items-center rounded-full border border-white/[0.09] bg-[#0c0a12]/95 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_20px_60px_rgba(0,0,0,.4)]">
                    <div><div className="mx-auto flex h-8 items-end justify-center gap-1">{[1, 2, 3, 4, 5].map((bar) => <span key={bar} className="signal-bar" />)}</div><p className="mt-3 font-display text-sm font-bold tracking-tight">live queue</p></div>
                  </div>
                </div>
              </div>
              <h1 className="mt-8 font-display text-4xl font-semibold tracking-[-.055em] sm:text-5xl">Waiting for someone to join<span className="text-[#78f7df]">...</span></h1>
              <p className="mx-auto mt-4 max-w-md text-sm text-white/40">Looking for someone online in {profile?.mode} mode. No bots, no simulated matches.</p>
              <GlassCard className="mx-auto mt-8 max-w-md rounded-2xl px-4 py-3 text-left">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-white/[0.06] text-[#78f7df]"><ShieldCheck className="size-4" /></div><div><p className="text-[10px] font-bold text-white/30">Real-time presence</p><p className="mt-0.5 text-xs font-extrabold">{queueCopy}</p></div></div>
                  <div className="shrink-0 text-right"><p className="text-[10px] font-bold text-white/30">Waiting</p><p className="font-display text-sm font-bold tabular-nums">{formatDuration(seconds)}</p></div>
                </div>
              </GlassCard>
              <p className="mt-4 text-[10px] font-semibold text-white/24">People can join at any moment. You’ll stay here until someone real is available.</p>
              <Button variant="ghost" className="mt-4 text-white/38 hover:text-rose-200" onClick={cancelSearch}><X className="size-4" /> Cancel search</Button>
            </motion.div>
          )}

          {(phase === "proposal" || phase === "accepted") && partner && (
            <motion.div key="proposal" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full text-center">
              <div className="profile-gradient-2 relative mx-auto grid size-28 place-items-center rounded-[38px] font-display text-2xl font-black text-[#0b2823] shadow-[0_0_70px_rgba(120,247,223,.18)]">{initials(partner.username)}<span className="absolute -bottom-2 -right-2 grid size-9 place-items-center rounded-full border-4 border-[#0b0911] bg-[#78f7df] text-black"><UserCheck className="size-4" /></span></div>
              <div className="eyebrow mt-7"><span className="status-dot" /> Real person found</div>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.055em] sm:text-5xl">Connect with {partner.username}?</h1>
              <p className="mt-4 text-sm text-white/40">{sharedInterests.length ? `Shared interests: ${sharedInterests.join(" + ")}` : `Both of you selected ${profile?.mode} mode.`}</p>
              {phase === "proposal" ? (
                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Button size="lg" onClick={acceptProposal}><Check className="size-4" /> Accept connection</Button><Button size="lg" variant="secondary" onClick={declineProposal}>Not this time</Button></div>
              ) : (
                <GlassCard className="mx-auto mt-8 max-w-sm rounded-2xl p-5"><div className="mx-auto flex h-8 items-end justify-center gap-1">{[1, 2, 3, 4, 5].map((bar) => <span key={bar} className="signal-bar" />)}</div><p className="mt-4 text-sm font-extrabold">{partnerAccepted ? "Both accepted — creating your room..." : `Waiting for ${partner.username} to accept...`}</p><p className="mt-2 text-[10px] text-white/30">No room is created until both of you confirm.</p></GlassCard>
              )}
            </motion.div>
          )}

          {phase === "connecting" && partner && (
            <motion.div key="connecting" initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} className="text-center"><div className="mx-auto grid size-24 place-items-center rounded-[32px] bg-[#78f7df] text-black"><Check className="size-9" strokeWidth={3} /></div><h1 className="mt-7 font-display text-4xl font-semibold tracking-[-.055em]">Both accepted.</h1><p className="mt-3 text-sm text-white/40">Opening your private room with {partner.username}...</p></motion.div>
          )}

          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-lg text-center"><div className="mx-auto grid size-20 place-items-center rounded-[26px] border border-rose-300/15 bg-rose-300/[0.07]"><X className="size-7 text-rose-300" /></div><h1 className="mt-7 font-display text-4xl font-semibold tracking-[-.055em]">Live matching is unavailable.</h1><p className="mt-4 text-sm leading-6 text-white/42">{error}</p><p className="mt-2 text-xs text-white/25">No fake user or fallback match was created.</p><Button className="mt-7" onClick={() => router.push("/start")}>Return to setup</Button></motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
