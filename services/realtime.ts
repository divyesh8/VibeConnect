import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/services/supabase";
import type { ChatMessage } from "@/types";

export type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; senderId: string }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit; senderId: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit; senderId: string };

export function subscribeToRoom(
  roomId: string,
  handlers: {
    onMessage?: (message: ChatMessage) => void;
    onTyping?: (payload: { senderId: string; typing: boolean }) => void;
    onSignal?: (signal: SignalPayload) => void;
  },
) {
  const supabase = getBrowserSupabase();
  if (!supabase) return null;

  const channel = supabase
    .channel(`room:${roomId}`, { config: { broadcast: { self: false } } })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new as Record<string, string | null>;
        handlers.onMessage?.({
          id: String(row.id),
          roomId: String(row.room_id),
          senderId: String(row.sender_id),
          senderName: "Stranger",
          content: String(row.content),
          createdAt: String(row.created_at),
          seenAt: row.seen_at ? String(row.seen_at) : null,
        });
      },
    )
    .on("broadcast", { event: "typing" }, ({ payload }) => handlers.onTyping?.(payload as { senderId: string; typing: boolean }))
    .on("broadcast", { event: "webrtc" }, ({ payload }) => handlers.onSignal?.(payload as SignalPayload))
    .subscribe();

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
