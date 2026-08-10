"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Ban,
  Camera,
  CameraOff,
  CheckCheck,
  ChevronDown,
  Flag,
  FlipHorizontal2,
  Heart,
  MessageCircleMore,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  RotateCcw,
  Send,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AmbientBackground } from "@/components/ambient-background";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useRoomChat } from "@/hooks/use-room-chat";
import { useWebRTC } from "@/hooks/use-webrtc";
import { getLocalProfile } from "@/lib/session";
import { cn, initials } from "@/lib/utils";
import type { AnonymousProfile, CommunicationMode, ReportReason } from "@/types";

const reportReasons: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "spam", label: "Spam" },
  { value: "threats", label: "Threats" },
];

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

function MediaStage({ profile, mode }: { profile: AnonymousProfile; mode: CommunicationMode }) {
  const media = useWebRTC(mode);
  const connected = Boolean(media.localStream);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0a0910]">
      {mode === "video" ? (
        <div className="relative grid min-h-[430px] flex-1 gap-2 p-2 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-[19px] border border-white/[0.08] bg-gradient-to-br from-[#203d40] to-[#101416]">
            <div className="absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#78f7df]/10 blur-[80px]" />
            <div className="absolute left-1/2 top-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[38px] bg-gradient-to-br from-[#78f7df] to-[#587dff] font-display text-3xl font-black text-[#071313] shadow-2xl">N</div>
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold backdrop-blur-md"><span className="status-dot !size-1.5" /> Nova</div>
            <div className="absolute right-4 top-4 flex h-8 items-end gap-1 rounded-full bg-black/30 px-3 py-2 backdrop-blur-md">
              {[1, 2, 3, 4].map((bar) => <span key={bar} className="signal-bar !w-[3px]" />)}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[19px] border border-white/[0.08] bg-gradient-to-br from-[#2f1e4b] to-[#121019]">
            {media.localStream && media.cameraEnabled ? (
              <StreamVideo stream={media.localStream} muted className="absolute inset-0 size-full object-cover [transform:scaleX(-1)]" />
            ) : (
              <>
                <div className="absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9d78ff]/15 blur-[75px]" />
                <div className="profile-gradient-1 absolute left-1/2 top-1/2 grid size-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[38px] font-display text-3xl font-black shadow-2xl">{initials(profile.username)}</div>
              </>
            )}
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold backdrop-blur-md">You</div>
            {!media.cameraEnabled && <div className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-black/35 backdrop-blur-md"><CameraOff className="size-3.5" /></div>}
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-[430px] flex-1 flex-col items-center justify-center overflow-hidden p-8 text-center">
          <div className="absolute left-1/2 top-1/2 size-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9d78ff]/10 blur-[100px]" />
          <motion.div animate={{ scale: connected ? [1, 1.05, 1] : 1 }} transition={{ duration: 2, repeat: Infinity }} className="relative">
            <div className="absolute -inset-8 rounded-[58px] border border-[#78f7df]/10" />
            <div className="profile-gradient-2 grid size-32 place-items-center rounded-[44px] font-display text-4xl font-black text-[#0c2a26] shadow-[0_0_80px_rgba(120,247,223,.16)]">N</div>
            <span className="absolute -bottom-2 -right-2 grid size-10 place-items-center rounded-full border-4 border-[#0a0910] bg-[#78f7df] text-black"><Volume2 className="size-4" /></span>
          </motion.div>
          <h2 className="relative mt-10 font-display text-2xl font-bold tracking-[-.04em]">Talking with Nova</h2>
          <p className="relative mt-2 text-xs text-white/35">Your audio is peer-to-peer and is never recorded.</p>
          <div className="relative mt-7 flex h-9 items-end gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((bar) => <span key={bar} className="signal-bar" />)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/[0.08] bg-black/20 p-3 sm:p-4">
        {!connected ? (
          <Button onClick={media.startMedia} className="min-w-52">
            {mode === "video" ? <Camera className="size-4" /> : <Mic className="size-4" />}
            Enable {mode === "video" ? "camera & mic" : "microphone"}
          </Button>
        ) : (
          <>
            <Button variant={media.micEnabled ? "secondary" : "danger"} size="icon" onClick={media.toggleMic} aria-label={media.micEnabled ? "Mute microphone" : "Unmute microphone"}>
              {media.micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </Button>
            {mode === "video" && (
              <>
                <Button variant={media.cameraEnabled ? "secondary" : "danger"} size="icon" onClick={media.toggleCamera} aria-label={media.cameraEnabled ? "Turn off camera" : "Turn on camera"}>
                  {media.cameraEnabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
                </Button>
                <Button variant="secondary" size="icon" onClick={media.switchCamera} aria-label="Switch camera"><FlipHorizontal2 className="size-4" /></Button>
              </>
            )}
          </>
        )}
        {media.permissionError && <p className="w-full pt-1 text-center text-[10px] font-bold text-rose-300">{media.permissionError}</p>}
      </div>
    </div>
  );
}

export function ChatRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<AnonymousProfile | null>(null);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [ended, setEnded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, partnerTyping, sendMessage, announceTyping } = useRoomChat(roomId, profile);

  useEffect(() => {
    const stored = getLocalProfile();
    if (!stored) router.replace("/start");
    else setProfile(stored);
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partnerTyping]);

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const content = draft;
    setDraft("");
    await sendMessage(content);
  }

  async function endConversation() {
    setEnded(true);
    try { await fetch("/api/rooms/end", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId }) }); } catch { /* preview */ }
  }

  async function submitReport(reason: ReportReason) {
    try { await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ roomId, reportedUserId: "partner", reason }) }); } catch { /* preview */ }
    setReportOpen(false);
    setNotice("Report received. Thank you for helping keep VibeConnect kind.");
    window.setTimeout(() => setNotice(null), 4200);
  }

  async function blockPartner() {
    try { await fetch("/api/blocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockedUserId: "partner" }) }); } catch { /* preview */ }
    setMenuOpen(false);
    setNotice("Nova was blocked. You won’t be matched again.");
    endConversation();
  }

  if (!profile) {
    return <main className="app-page grid min-h-screen place-items-center"><AmbientBackground /><div className="flex items-center gap-3 text-sm font-bold text-white/45"><span className="status-dot" /> Loading your conversation...</div></main>;
  }

  const isText = profile.mode === "text";

  return (
    <main className="app-page flex h-[100dvh] flex-col overflow-hidden p-3 sm:p-4">
      <AmbientBackground />
      <header className="mx-auto flex w-full max-w-[1440px] shrink-0 items-center justify-between px-2 py-2 sm:px-3 sm:py-3">
        <Logo />
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] font-bold text-white/38 sm:flex">
            <ShieldCheck className="size-3.5 text-[#78f7df]" /> Encrypted live session
          </div>
          <div className="relative">
            <Button variant="secondary" size="icon" onClick={() => setMenuOpen((value) => !value)} aria-label="Conversation options"><MoreHorizontal className="size-4" /></Button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} className="glass-card absolute right-0 top-13 z-50 w-48 rounded-2xl p-1.5 shadow-2xl">
                  <button onClick={() => { setReportOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-white/65 hover:bg-white/[0.07]"><Flag className="size-4" /> Report</button>
                  <button onClick={blockPartner} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-bold text-rose-300 hover:bg-rose-400/10"><Ban className="size-4" /> Block</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Button variant="danger" onClick={endConversation} className="hidden sm:flex"><PhoneOff className="size-4" /> End</Button>
          <Button variant="danger" size="icon" onClick={endConversation} className="sm:hidden" aria-label="End conversation"><PhoneOff className="size-4" /></Button>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 gap-3">
        <GlassCard className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] p-2 sm:p-3">
          <div className="flex shrink-0 items-center justify-between px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex items-center gap-3">
              <div className="profile-gradient-2 relative grid size-10 place-items-center rounded-[14px] font-display text-sm font-black text-[#0b2823]">N<span className="absolute -bottom-1 -right-1 size-3 rounded-full border-2 border-[#15121d] bg-[#7dffb6]" /></div>
              <div><div className="flex items-center gap-2"><h1 className="text-sm font-extrabold">Nova</h1><span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-white/36">stranger</span></div><p className="mt-0.5 text-[10px] text-white/30">Matched on Music + Travel</p></div>
            </div>
            <div className="hidden items-center gap-2 text-[10px] font-bold text-white/25 sm:flex"><Sparkles className="size-3 text-[#ff86c5]" /> Keep it friendly</div>
          </div>

          {isText ? (
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[23px] border border-white/[0.07] bg-black/20">
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
                <div className="my-2 flex items-center gap-3 text-[9px] font-black uppercase tracking-[.16em] text-white/20"><span className="h-px flex-1 bg-white/[0.06]" />You matched just now<span className="h-px flex-1 bg-white/[0.06]" /></div>
                {messages.map((message) => {
                  const mine = message.senderId === profile.id;
                  return (
                    <motion.div key={message.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex max-w-[86%] gap-2.5 sm:max-w-[72%]", mine ? "ml-auto flex-row-reverse" : "")}>
                      {!mine && <div className="profile-gradient-2 mt-1 grid size-7 shrink-0 place-items-center rounded-[10px] text-[9px] font-black text-[#0b2823]">N</div>}
                      <div>
                        <div className={cn("rounded-[19px] px-4 py-3 text-[13px] leading-5", mine ? "rounded-tr-[6px] bg-white text-[#131018]" : "rounded-tl-[6px] border border-white/[0.08] bg-white/[0.065] text-white/72")}>
                          {message.content}
                        </div>
                        <div className={cn("mt-1.5 flex items-center gap-1.5 px-1 text-[9px] text-white/20", mine && "justify-end")}>
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {mine && <CheckCheck className={cn("size-3", message.status === "failed" ? "text-rose-300" : "text-[#78f7df]/70")} />}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
                {partnerTyping && <div className="flex items-center gap-2 text-[10px] font-bold text-white/27"><div className="profile-gradient-2 grid size-7 place-items-center rounded-[10px] text-[9px] font-black text-[#0b2823]">N</div><span className="rounded-full bg-white/[0.06] px-3 py-2">Nova is typing<span className="ml-1 animate-pulse">...</span></span></div>}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={submitMessage} className="shrink-0 border-t border-white/[0.07] bg-[#0d0b13]/90 p-3 sm:p-4">
                <div className="flex items-end gap-2 rounded-[20px] border border-white/[0.09] bg-white/[0.04] p-2 pl-4 focus-within:border-[#78f7df]/35 focus-within:ring-4 focus-within:ring-[#78f7df]/[0.05]">
                  <textarea
                    value={draft}
                    onChange={(event) => { setDraft(event.target.value.slice(0, 1000)); announceTyping(); }}
                    onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(event); } }}
                    rows={1}
                    placeholder="Say something nice..."
                    className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/20"
                    aria-label="Message Nova"
                  />
                  <button type="button" onClick={() => setDraft((value) => `${value} ✨`)} className="grid size-10 shrink-0 place-items-center rounded-full text-white/30 transition hover:bg-white/[0.06] hover:text-white" aria-label="Add emoji"><SmilePlus className="size-[18px]" /></button>
                  <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send message"><Send className="size-4" /></Button>
                </div>
                <p className="mt-2 px-2 text-[9px] text-white/18">Enter to send · Shift + Enter for a new line</p>
              </form>
            </div>
          ) : (
            <MediaStage profile={profile} mode={profile.mode} />
          )}
        </GlassCard>

        <aside className="hidden w-[290px] shrink-0 flex-col gap-3 xl:flex">
          <GlassCard className="rounded-[26px] p-5">
            <div className="flex items-center justify-between"><div className="eyebrow"><Heart className="size-3.5 text-[#ff76bc]" /> Your vibe</div><ChevronDown className="size-4 text-white/20" /></div>
            <div className="mt-6 flex items-center gap-3">
              <div className="profile-gradient-1 grid size-12 place-items-center rounded-2xl font-display text-sm font-black">{initials(profile.username)}</div>
              <div><p className="text-sm font-extrabold">{profile.username}</p><p className="mt-0.5 text-[10px] capitalize text-white/30">{profile.mode} · anonymous</p></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {(profile.interests.length ? profile.interests : ["Random"]).map((interest) => <span key={interest} className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[9px] font-bold text-white/36">{interest}</span>)}
            </div>
          </GlassCard>

          <GlassCard className="rounded-[26px] p-5">
            <div className="flex items-center gap-2 text-xs font-extrabold"><ShieldCheck className="size-4 text-[#78f7df]" /> You&apos;re in control</div>
            <div className="mt-4 space-y-3 text-[10px] leading-4 text-white/36">
              <p>Leave any time. You never owe a stranger your attention.</p>
              <p>Don&apos;t share personal details you want to keep private.</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}><Flag className="size-3.5" /> Report</Button>
              <Button variant="secondary" size="sm" onClick={blockPartner}><Ban className="size-3.5" /> Block</Button>
            </div>
          </GlassCard>

          <div className="mt-auto rounded-[22px] border border-[#78f7df]/10 bg-[#78f7df]/[0.04] p-4 text-[10px] leading-4 text-white/32"><ShieldCheck className="mb-2 size-4 text-[#78f7df]" />Voice and video are peer-to-peer. They are never recorded or stored by VibeConnect.</div>
        </aside>
      </div>

      <AnimatePresence>
        {notice && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full px-5 py-3 text-center text-xs font-bold text-white/75 shadow-2xl"><CheckCheck className="mr-2 inline size-4 text-[#78f7df]" />{notice}</motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {reportOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportOpen(false); }}>
            <motion.div initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="glass-card w-full max-w-md rounded-[28px] p-6">
              <div className="flex items-start justify-between"><div><p className="eyebrow"><Flag className="size-3.5 text-rose-300" /> Safety report</p><h2 className="mt-3 font-display text-2xl font-bold tracking-[-.04em]">What happened?</h2><p className="mt-2 text-xs leading-5 text-white/38">Reports are confidential. Pick the option that best describes the situation.</p></div><Button variant="ghost" size="icon" onClick={() => setReportOpen(false)}><X className="size-4" /></Button></div>
              <div className="mt-6 grid gap-2">
                {reportReasons.map((reason) => <button key={reason.value} onClick={() => submitReport(reason.value)} className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-left text-xs font-bold text-white/60 transition hover:border-rose-300/30 hover:bg-rose-300/[0.07] hover:text-white">{reason.label}<ArrowRight className="size-3.5" /></button>)}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ended && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] grid place-items-center bg-[#08070d]/88 p-4 backdrop-blur-xl">
            <motion.div initial={{ y: 18, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} className="w-full max-w-lg text-center">
              <div className="mx-auto grid size-20 place-items-center rounded-[26px] border border-white/10 bg-white/[0.06]"><PhoneOff className="size-7 text-white/60" /></div>
              <div className="eyebrow mt-7"><span className="size-1.5 rounded-full bg-white/25" /> Conversation ended</div>
              <h2 className="mt-4 font-display text-4xl font-semibold tracking-[-.055em]">Good chat?</h2>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/38">Your chat history is saved securely. Voice and video were never stored.</p>
              <div className="mt-7 flex justify-center gap-2">
                {['😕', '🙂', '✨'].map((emoji) => <button key={emoji} className="glass-subtle grid size-12 place-items-center rounded-2xl text-xl transition hover:-translate-y-1 hover:bg-white/[0.08]">{emoji}</button>)}
              </div>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button onClick={() => router.push("/matching")} size="lg"><RotateCcw className="size-4" /> Find someone new</Button>
                <Button asChild variant="secondary" size="lg"><Link href="/">Back home</Link></Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
