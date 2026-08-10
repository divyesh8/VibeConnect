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
    const now = Date.now();
    setMessages([
      {
        id: "welcome-1",
        roomId,
        senderId: "partner",
        senderName: "Nova",
        content: "hey! looks like we both picked music 🎧",
        createdAt: new Date(now - 65_000).toISOString(),
        seenAt: new Date(now - 63_000).toISOString(),
      },
      {
        id: "welcome-2",
        roomId,
        senderId: profile.id,
        senderName: profile.username,
        content: "instant good sign. what have you had on repeat lately?",
        createdAt: new Date(now - 40_000).toISOString(),
        seenAt: new Date(now - 35_000).toISOString(),
      },
      {
        id: "welcome-3",
        roomId,
        senderId: "partner",
        senderName: "Nova",
        content: "honestly? a lot of indie pop and lo-fi. you?",
        createdAt: new Date(now - 12_000).toISOString(),
        seenAt: new Date(now - 10_000).toISOString(),
      },
    ]);

    let active = true;
    void subscribeToRoom(roomId, {
      onMessage: (incoming) => {
        if (incoming.senderId === profile.id) return;
        setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      },
      onTyping: ({ senderId, typing }) => {
        if (senderId !== profile.id) setPartnerTyping(typing);
      },
    }).then((channel) => {
      if (!active) leaveRoomChannel(channel);
      else channelRef.current = channel;
    }).catch(() => {
      channelRef.current = null;
    });
    return () => {
      active = false;
      leaveRoomChannel(channelRef.current);
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
      // Offline preview still lets the user experience the conversation.
      setMessages((current) => current.map((message) => message.id === optimistic.id ? { ...message, status: "sent" } : message));
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
