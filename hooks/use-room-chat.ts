"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { leaveRoomChannel, sendTyping, subscribeToRoom } from "@/services/realtime";
import type { AnonymousProfile, ChatMessage } from "@/types";

export function useRoomChat(roomId: string, profile: AnonymousProfile | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!profile) return;
    queueMicrotask(() => setMessages([]));

    let active = true;
    void fetch(`/api/messages?roomId=${encodeURIComponent(roomId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { messages?: ChatMessage[] };
        if (active && data.messages) setMessages(data.messages);
      })
      .catch(() => undefined);
    void subscribeToRoom(roomId, {
      onMessage: (incoming) => {
        if (incoming.senderId === profile.id) return;
        setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      },
      onTyping: ({ senderId, typing }) => {
        if (senderId !== profile.id) setPartnerTyping(typing);
      },
    }).then((channel) => {
      if (!active) void leaveRoomChannel(channel);
      else channelRef.current = channel;
    }).catch(() => {
      channelRef.current = null;
    });
    return () => {
      active = false;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      void leaveRoomChannel(channelRef.current);
      channelRef.current = null;
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
    setMessages((current) => [...current, optimistic]);
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId, content: optimistic.content, clientId: optimistic.id }),
      });
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: response.ok ? "sent" : "failed" } : message));
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
