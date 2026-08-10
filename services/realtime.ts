import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/services/supabase";
import type { ChatMessage } from "@/types";

export type SignalPayload =
  | { kind: "ready"; senderId: string }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; senderId: string }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit; senderId: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit; senderId: string };

export async function subscribeToRoom(
  roomId: string,
  handlers: {
    onMessage?: (message: ChatMessage) => void;
    onTyping?: (payload: { senderId: string; typing: boolean }) => void;
    onSignal?: (signal: SignalPayload) => void;
  },
) {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;

  const tokenResponse = await fetch(`/api/realtime-token?roomId=${encodeURIComponent(roomId)}`);
  if (!tokenResponse.ok) return null;
  const { token } = await tokenResponse.json() as { token: string };
  supabase.realtime.setAuth(token);

  const channel = supabase
    .channel(`room:${roomId}`, { config: { private: true, broadcast: { self: false } } })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new as Record<string, string | null>;
        handlers.onMessage?.({
          id: String(row.id),
          roomId: String(row.room_id),
          senderId: String(row.sender_id),
          senderName: "",
          content: String(row.content),
          createdAt: String(row.created_at),
          seenAt: row.seen_at ? String(row.seen_at) : null,
        });
      },
    )
    .on("broadcast", { event: "typing" }, ({ payload }) => handlers.onTyping?.(payload as { senderId: string; typing: boolean }))
    .on("broadcast", { event: "webrtc" }, ({ payload }) => handlers.onSignal?.(payload as SignalPayload));

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Realtime connection timed out")), 8000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(timeout);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        window.clearTimeout(timeout);
        reject(new Error(`Realtime channel ${status.toLowerCase()}`));
      }
    });
  });

  return channel;
}

export async function sendTyping(channel: RealtimeChannel | null, senderId: string, typing: boolean) {
  await channel?.send({ type: "broadcast", event: "typing", payload: { senderId, typing } });
}

export async function sendSignal(channel: RealtimeChannel | null, signal: SignalPayload) {
  await channel?.send({ type: "broadcast", event: "webrtc", payload: signal });
}

export function leaveRoomChannel(channel: RealtimeChannel | null) {
  const supabase = getBrowserSupabase();
  if (supabase && channel) void supabase.removeChannel(channel);
}
