"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { connectQueuePresence, disconnectQueuePresence } from "@/services/presence";
import type { AnonymousProfile } from "@/types";

export function useQueuePresence(profile: AnonymousProfile | null, queueStatus: "searching" | "confirming", enabled = true) {
  const [liveSearchingSessions, setLiveSearchingSessions] = useState(0);
  const [presenceConnected, setPresenceConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handedOffRef = useRef(false);
  const queueStatusRef = useRef(queueStatus);

  useEffect(() => {
    queueStatusRef.current = queueStatus;
  }, [queueStatus]);

  useEffect(() => {
    if (!profile || !enabled) return;
    let active = true;

    const heartbeat = async () => {
      await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "searching" }),
      }).catch(() => undefined);
    };

    void heartbeat();
    const heartbeatTimer = window.setInterval(() => void heartbeat(), 10_000);
    void connectQueuePresence(profile, queueStatusRef.current, setLiveSearchingSessions)
      .then((channel) => {
        if (!active) void disconnectQueuePresence(channel);
        else {
          channelRef.current = channel;
          setPresenceConnected(true);
          void channel.track({ user_id: profile.id, status: queueStatusRef.current, online_at: new Date().toISOString() });
        }
      })
      .catch(() => {
        if (active) setPresenceConnected(false);
      });

    const handlePageHide = () => {
      if (!handedOffRef.current) navigator.sendBeacon("/api/presence/offline");
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("pagehide", handlePageHide);
      if (!handedOffRef.current) navigator.sendBeacon("/api/presence/offline");
      void disconnectQueuePresence(channelRef.current);
      channelRef.current = null;
      setPresenceConnected(false);
    };
  }, [enabled, profile]);

  useEffect(() => {
    if (!enabled || !profile || !channelRef.current) return;
    void channelRef.current.track({ user_id: profile.id, status: queueStatus, online_at: new Date().toISOString() });
  }, [enabled, profile, queueStatus]);

  const handoffToRoom = useCallback(() => {
    handedOffRef.current = true;
  }, []);

  const markOffline = useCallback(async () => {
    handedOffRef.current = true;
    await disconnectQueuePresence(channelRef.current);
    channelRef.current = null;
    await fetch("/api/presence/offline", { method: "POST", keepalive: true }).catch(() => undefined);
  }, []);

  return { liveSearchingSessions, presenceConnected, handoffToRoom, markOffline };
}
