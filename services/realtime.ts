import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/services/supabase";
import type { ChatMessage } from "@/types";

export type SignalPayload =
  | { kind: "peer-ready"; mediaReady: boolean; roomId: string; senderId: string; timestamp: number; nonce: string }
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; roomId: string; senderId: string; timestamp: number; nonce: string }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit; roomId: string; senderId: string; timestamp: number; nonce: string }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit; roomId: string; senderId: string; timestamp: number; nonce: string }
  | { kind: "restart-request"; roomId: string; senderId: string; timestamp: number; nonce: string }
  | { kind: "skip" | "call-ended" | "peer-disconnected"; roomId: string; senderId: string; timestamp: number; nonce: string };

function isSignalPayload(value: unknown, roomId: string): value is SignalPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.roomId === roomId
    && typeof payload.senderId === "string"
    && typeof payload.timestamp === "number"
    && typeof payload.nonce === "string"
    && ["peer-ready", "offer", "answer", "ice-candidate", "restart-request", "skip", "call-ended", "peer-disconnected"].includes(String(payload.kind));
}

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

  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  supabase.realtime.setAuth(data.session.access_token);

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
    .on("broadcast", { event: "webrtc" }, ({ payload }) => {
      if (isSignalPayload(payload, roomId)) handlers.onSignal?.(payload);
    });

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
  if (!channel) throw new Error("The private signaling channel is not ready.");
  await channel?.send({ type: "broadcast", event: "webrtc", payload: signal });
}

export async function leaveRoomChannel(channel: RealtimeChannel | null) {
  const supabase = getBrowserSupabase();
  if (supabase && channel) await supabase.removeChannel(channel);
}
