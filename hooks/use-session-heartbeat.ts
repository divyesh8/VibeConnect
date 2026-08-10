"use client";

import { useEffect, useRef } from "react";

export function useSessionHeartbeat(enabled: boolean, onRoomEnded?: () => void) {
  const onRoomEndedRef = useRef(onRoomEnded);
  useEffect(() => {
    onRoomEndedRef.current = onRoomEnded;
  }, [onRoomEnded]);
  useEffect(() => {
    if (!enabled) return;
    const beat = async () => {
      const response = await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "connected" }),
      }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json() as { roomActive?: boolean };
      if (data.roomActive === false) onRoomEndedRef.current?.();
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 10_000);
    const handlePageHide = () => navigator.sendBeacon("/api/presence/offline");
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [enabled]);
}
