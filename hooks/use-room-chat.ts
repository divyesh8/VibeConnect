"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { announceMessageAvailable, leaveRoomChannel, sendTyping, subscribeToRoom } from "@/services/realtime";
import type { AnonymousProfile, ChatMessage } from "@/types";

export type ChatDiagnostics = {
  channelStatus: "IDLE" | "CONNECTING" | "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";
  lastPostStatus: "idle" | "success" | "failed";
  lastBroadcastStatus: "idle" | "sent" | "failed";
  lastVerificationStatus: "idle" | "success" | "failed";
  postgresFallbackUsed: boolean;
  messageCount: number;
};

const INITIAL_CHAT_DIAGNOSTICS: ChatDiagnostics = {
  channelStatus: "IDLE",
  lastPostStatus: "idle",
  lastBroadcastStatus: "idle",
  lastVerificationStatus: "idle",
  postgresFallbackUsed: false,
  messageCount: 0,
};

export function useRoomChat(roomId: string, profile: AnonymousProfile | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [chatDiagnostics, setChatDiagnostics] = useState<ChatDiagnostics>(INITIAL_CHAT_DIAGNOSTICS);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelPromiseRef = useRef<Promise<RealtimeChannel> | null>(null);
  const typingTimer = useRef<number | null>(null);
  const knownMessageIdsRef = useRef(new Set<string>());
  const seenMessageHintIdsRef = useRef(new Set<string>());
  const verifyingMessageIdsRef = useRef(new Set<string>());

  const log = useCallback((message: string, data?: unknown) => {
    if (process.env.NODE_ENV === "development") {
      const prefix = `[VC][room=${roomId}][user=${profile?.id ?? "anon"}][CHAT]`;
      if (data !== undefined) {
        console.info(`${prefix} ${message}`, data);
      } else {
        console.info(`${prefix} ${message}`);
      }
    }
  }, [profile?.id, roomId]);

  useEffect(() => {
    if (!profile) return;
    queueMicrotask(() => {
      setMessages([]);
      setChatDiagnostics({ ...INITIAL_CHAT_DIAGNOSTICS, channelStatus: "CONNECTING" });
    });
    knownMessageIdsRef.current.clear();
    seenMessageHintIdsRef.current.clear();
    verifyingMessageIdsRef.current.clear();

    let active = true;

    void fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { messages?: ChatMessage[] };
        if (active && data.messages) {
          for (const message of data.messages) knownMessageIdsRef.current.add(message.id);
          setMessages((current) => {
            const merged = new Map(data.messages?.map((message) => [message.id, message]) ?? []);
            for (const message of current) merged.set(message.id, message);
            const sorted = [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
            setChatDiagnostics((diag) => ({ ...diag, messageCount: sorted.length }));
            return sorted;
          });
        }
      })
      .catch(() => undefined);

    const subscription = subscribeToRoom(roomId, {
      onStatus: (status) => {
        if (active) {
          setChatDiagnostics((current) => ({ ...current, channelStatus: status }));
        }
      },
      onMessage: (incoming) => {
        if (incoming.senderId === profile.id) return;
        const wasKnown = knownMessageIdsRef.current.has(incoming.id);
        knownMessageIdsRef.current.add(incoming.id);
        log("Postgres delivery", { latencyMs: Math.max(0, Date.now() - Date.parse(incoming.createdAt)) });
        setMessages((current) => {
          if (current.some((item) => item.id === incoming.id)) return current;
          const next = [...current, incoming];
          setChatDiagnostics((diag) => ({
            ...diag,
            postgresFallbackUsed: !wasKnown,
            messageCount: next.length,
          }));
          return next;
        });
      },
      onMessageHint: (hint) => {
        if (
          hint.senderId === profile.id
          || knownMessageIdsRef.current.has(hint.messageId)
          || seenMessageHintIdsRef.current.has(hint.messageId)
          || verifyingMessageIdsRef.current.has(hint.messageId)
        ) return;
        if (seenMessageHintIdsRef.current.size >= 512) seenMessageHintIdsRef.current.clear();
        seenMessageHintIdsRef.current.add(hint.messageId);
        verifyingMessageIdsRef.current.add(hint.messageId);
        const verificationStarted = performance.now();
        void fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}&messageId=${encodeURIComponent(hint.messageId)}`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) throw new Error(`Verification HTTP ${response.status}`);
            const data = await response.json() as { messages?: ChatMessage[] };
            const verified = data.messages?.[0];
            if (!active || !verified || verified.senderId !== hint.senderId) return;
            knownMessageIdsRef.current.add(verified.id);
            setMessages((current) => {
              if (current.some((item) => item.id === verified.id)) return current;
              const next = [...current, verified];
              setChatDiagnostics((diag) => ({
                ...diag,
                lastVerificationStatus: "success",
                messageCount: next.length,
              }));
              return next;
            });
            log("broadcast hint verified", {
              verificationMs: Math.round(performance.now() - verificationStarted),
              approximateEndToEndMs: Math.max(0, Date.now() - hint.sentAt),
            });
          })
          .catch((verificationError) => {
            seenMessageHintIdsRef.current.delete(hint.messageId);
            setChatDiagnostics((diag) => ({ ...diag, lastVerificationStatus: "failed" }));
            if (process.env.NODE_ENV === "development") {
              console.warn(`[VC][room=${roomId}][user=${profile.id}][CHAT] message verification failed; Postgres delivery remains active`, verificationError);
            }
          })
          .finally(() => verifyingMessageIdsRef.current.delete(hint.messageId));
      },
      onTyping: ({ senderId, typing }) => {
        if (senderId !== profile.id) setPartnerTyping(typing);
      },
    }, "chat");
    channelPromiseRef.current = subscription;
    void subscription.then((channel) => {
      if (!active) void leaveRoomChannel(channel);
      else {
        channelRef.current = channel;
        setChatDiagnostics((current) => ({ ...current, channelStatus: "SUBSCRIBED" }));
      }
    }).catch(() => {
      channelRef.current = null;
      if (channelPromiseRef.current === subscription) channelPromiseRef.current = null;
      setChatDiagnostics((current) => ({ ...current, channelStatus: "CHANNEL_ERROR" }));
    });
    return () => {
      active = false;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      void leaveRoomChannel(channelRef.current);
      channelRef.current = null;
      if (channelPromiseRef.current === subscription) channelPromiseRef.current = null;
    };
  }, [log, profile, roomId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!profile || !content.trim()) return;
    const optimistic: ChatMessage = {
      id: crypto.randomUUID(),
      roomId,
      senderId: profile.id,
      senderName: profile.username,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    knownMessageIdsRef.current.add(optimistic.id);
    setMessages((current) => {
      const next = [...current, optimistic];
      setChatDiagnostics((diag) => ({ ...diag, messageCount: next.length }));
      return next;
    });
    try {
      const requestStarted = performance.now();
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId, content: optimistic.content, clientId: optimistic.id }),
      });
      const payload = await response.json().catch(() => null) as { messageId?: string; acceptedAt?: string } | null;
      if (response.ok) {
        log("message persisted", { apiMs: Math.round(performance.now() - requestStarted), roomScoped: true });
        setChatDiagnostics((diag) => ({ ...diag, lastPostStatus: "success" }));
      } else {
        setChatDiagnostics((diag) => ({ ...diag, lastPostStatus: "failed" }));
      }
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: response.ok ? "sent" : "failed" } : message));
      if (response.ok) {
        const messageId = payload?.messageId ?? optimistic.id;
        void (async () => {
          const pendingChannel = channelPromiseRef.current;
          const channel = channelRef.current ?? (pendingChannel ? await pendingChannel.catch(() => null) : null);
          const announced = await announceMessageAvailable(channel, {
            roomId,
            messageId,
            senderId: profile.id,
            sentAt: Date.now(),
          });
          setChatDiagnostics((diag) => ({ ...diag, lastBroadcastStatus: announced ? "sent" : "failed" }));
          log("fast delivery hint", { announced, messageId });
        })().catch((announcementError) => {
          setChatDiagnostics((diag) => ({ ...diag, lastBroadcastStatus: "failed" }));
          if (process.env.NODE_ENV === "development") {
            console.warn(`[VC][room=${roomId}][user=${profile.id}][CHAT] fast delivery hint failed; Postgres delivery remains active`, announcementError);
          }
        });
      }
    } catch {
      setChatDiagnostics((diag) => ({ ...diag, lastPostStatus: "failed" }));
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: "failed" } : message));
    }
  }, [log, profile, roomId]);

  const announceTyping = useCallback(() => {
    if (!profile) return;
    void sendTyping(channelRef.current, profile.id, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => void sendTyping(channelRef.current, profile.id, false), 1200);
  }, [profile]);

  return { messages, partnerTyping, sendMessage, announceTyping, chatDiagnostics };
}
