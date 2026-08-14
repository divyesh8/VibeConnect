import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureAnonymousAuth, getBrowserSupabase } from "@/services/supabase";
import type { ChatMessage } from "@/types";

export type RealtimeSubscriptionStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

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
    onStatus?: (status: RealtimeSubscriptionStatus, error?: Error) => void;
  },
  purpose: "signaling" | "chat" = "signaling",
) {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("Supabase is not configured");

  const session = await ensureAnonymousAuth();
  if (!session.access_token || !session.user.id) throw new Error("The anonymous Supabase session is incomplete.");
  console.info("[AUTH] session:", session.user.id);
  await supabase.realtime.setAuth(session.access_token);

  const topic = purpose === "chat" ? `room:${roomId}:chat` : `room:${roomId}`;
  console.info(`[${purpose === "chat" ? "CHAT" : "SIGNAL"}] subscribing:`, topic);
  const channel = supabase
    .channel(topic, { config: { private: true, broadcast: { self: false, ack: purpose === "signaling" } } })
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

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        operation();
      };
      const timeout = window.setTimeout(() => {
        const error = new Error("Realtime connection timed out before Supabase returned a channel state.");
        console.error("[REALTIME] FULL ERROR:", error);
        handlers.onStatus?.("TIMED_OUT", error);
        finish(() => reject(error));
      }, 10_000);

      channel.subscribe((status, subscriptionError) => {
        console.info("[REALTIME] STATUS:", status, { topic });
        if (subscriptionError) {
          console.error("[REALTIME] FULL ERROR:", subscriptionError);
          console.error("[REALTIME] ERROR NAME:", subscriptionError.name);
          console.error("[REALTIME] ERROR MESSAGE:", subscriptionError.message);
          console.error("[REALTIME] ERROR CAUSE:", subscriptionError.cause);
        }
        handlers.onStatus?.(status, subscriptionError);
        if (status === "SUBSCRIBED") finish(resolve);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          const error = subscriptionError ?? new Error(`Realtime channel ${status.toLowerCase()}`);
          finish(() => reject(error));
        }
      });
    });
  } catch (error) {
    await supabase.removeChannel(channel).catch(() => undefined);
    throw error;
  }

  return channel;
}

export async function sendTyping(channel: RealtimeChannel | null, senderId: string, typing: boolean) {
  await channel?.send({ type: "broadcast", event: "typing", payload: { senderId, typing } });
}

export async function sendSignal(channel: RealtimeChannel | null, signal: SignalPayload) {
  if (!channel) throw new Error("The private signaling channel is not ready.");
  const status = await channel.send({ type: "broadcast", event: "webrtc", payload: signal });
  if (status !== "ok") throw new Error(`The signaling broadcast ${status}.`);
}

export async function leaveRoomChannel(channel: RealtimeChannel | null) {
  const supabase = getBrowserSupabase();
  if (supabase && channel) await supabase.removeChannel(channel);
}
