"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { announceMessageAvailable, leaveRoomChannel, sendTyping, subscribeToRoom } from "@/services/realtime";
import type { AnonymousProfile, ChatMessage } from "@/types";

export function useRoomChat(roomId: string, profile: AnonymousProfile | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelPromiseRef = useRef<Promise<RealtimeChannel> | null>(null);
  const typingTimer = useRef<number | null>(null);
  const knownMessageIdsRef = useRef(new Set<string>());
  const seenMessageHintIdsRef = useRef(new Set<string>());
  const verifyingMessageIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!profile) return;
    queueMicrotask(() => setMessages([]));
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
            return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
          });
        }
      })
      .catch(() => undefined);
    const subscription = subscribeToRoom(roomId, {
      onMessage: (incoming) => {
        if (incoming.senderId === profile.id) return;
        knownMessageIdsRef.current.add(incoming.id);
        if (process.env.NODE_ENV === "development") {
          console.info("[CHAT] Postgres delivery", { latencyMs: Math.max(0, Date.now() - Date.parse(incoming.createdAt)) });
        }
        setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      },
      onMessageHint: (hint) => {
        if (
          hint.senderId === profile.id
          || knownMessageIdsRef.current.has(hint.messageId)
          || seenMessageHintIdsRef.current.has(hint.messageId)
          || verifyingMessageIdsRef.current.has(hint.messageId)
          || verifyingMessageIdsRef.current.size >= 4
        ) return;
        if (seenMessageHintIdsRef.current.size >= 512) seenMessageHintIdsRef.current.clear();
        seenMessageHintIdsRef.current.add(hint.messageId);
        verifyingMessageIdsRef.current.add(hint.messageId);
        const verificationStarted = performance.now();
        void fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}&messageId=${encodeURIComponent(hint.messageId)}`, { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) return;
            const data = await response.json() as { messages?: ChatMessage[] };
            const verified = data.messages?.[0];
            if (!active || !verified || verified.senderId !== hint.senderId) return;
            knownMessageIdsRef.current.add(verified.id);
            setMessages((current) => current.some((item) => item.id === verified.id) ? current : [...current, verified]);
            if (process.env.NODE_ENV === "development") {
              console.info("[CHAT] broadcast hint verified", {
                verificationMs: Math.round(performance.now() - verificationStarted),
                approximateEndToEndMs: Math.max(0, Date.now() - hint.sentAt),
              });
            }
          })
          .catch((verificationError) => {
            if (process.env.NODE_ENV === "development") console.warn("[CHAT] message verification failed; Postgres delivery remains active", verificationError);
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
      else channelRef.current = channel;
    }).catch(() => {
      channelRef.current = null;
      if (channelPromiseRef.current === subscription) channelPromiseRef.current = null;
    });
    return () => {
      active = false;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      void leaveRoomChannel(channelRef.current);
      channelRef.current = null;
      if (channelPromiseRef.current === subscription) channelPromiseRef.current = null;
    };
  }, [profile, roomId]);

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
    setMessages((current) => [...current, optimistic]);
    try {
      const requestStarted = performance.now();
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId, content: optimistic.content, clientId: optimistic.id }),
      });
      const payload = await response.json().catch(() => null) as { messageId?: string; acceptedAt?: string } | null;
      if (process.env.NODE_ENV === "development" && response.ok) {
        console.info("[CHAT] message persisted", { apiMs: Math.round(performance.now() - requestStarted), roomScoped: true });
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
          if (process.env.NODE_ENV === "development") console.info("[CHAT] fast delivery hint", { announced, messageId });
        })().catch((announcementError) => {
          if (process.env.NODE_ENV === "development") console.warn("[CHAT] fast delivery hint failed; Postgres delivery remains active", announcementError);
        });
      }
    } catch {
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: "failed" } : message));
    }
  }, [profile, roomId]);

  const announceTyping = useCallback(() => {
    if (!profile) return;
    void sendTyping(channelRef.current, profile.id, true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => void sendTyping(channelRef.current, profile.id, false), 1200);
  }, [profile]);

  return { messages, partnerTyping, sendMessage, announceTyping };
}
