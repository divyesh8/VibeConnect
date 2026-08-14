import type { RealtimeChannel } from "@supabase/supabase-js";
import { ensureAnonymousAuth, getBrowserSupabase } from "@/services/supabase";
import type { AnonymousProfile } from "@/types";

export async function connectQueuePresence(
  profile: AnonymousProfile,
  queueStatus: "searching" | "confirming",
  onSync: (liveSearchingSessions: number) => void,
) {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  const session = await ensureAnonymousAuth();
  if (!session.access_token || session.user.id !== profile.id) throw new Error("Presence authorization failed");
  console.info("[AUTH] session:", session.user.id);
  await supabase.realtime.setAuth(session.access_token);

  const topic = `queue:${profile.mode}`;
  console.info("[REALTIME] subscribing:", topic);
  const channel = supabase.channel(topic, {
    config: {
      private: true,
      presence: { key: profile.id },
    },
  });

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState<{ user_id: string; status: string }>();
    // Reconnects can briefly leave more than one Presence meta for one key.
    // Count authenticated user IDs, not metas, so one browser is never shown
    // as two available people.
    const liveSearchingSessions = new Set(
      Object.values(state)
        .flat()
        .filter((presence) => presence.status === "searching")
        .map((presence) => presence.user_id),
    ).size;
    onSync(liveSearchingSessions);
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
        const error = new Error("Presence connection timed out before Supabase returned a channel state.");
        console.error("[REALTIME] FULL ERROR:", error);
        finish(() => reject(error));
      }, 10_000);

      channel.subscribe(async (realtimeStatus, subscriptionError) => {
        console.info("[REALTIME] STATUS:", realtimeStatus, { topic });
        if (subscriptionError) {
          console.error("[REALTIME] FULL ERROR:", subscriptionError);
          console.error("[REALTIME] ERROR NAME:", subscriptionError.name);
          console.error("[REALTIME] ERROR MESSAGE:", subscriptionError.message);
          console.error("[REALTIME] ERROR CAUSE:", subscriptionError.cause);
        }
        if (realtimeStatus === "SUBSCRIBED") {
          try {
            await channel.track({ user_id: profile.id, status: queueStatus, online_at: new Date().toISOString() });
            finish(resolve);
          } catch (error) {
            finish(() => reject(error));
          }
        }
        if (realtimeStatus === "CHANNEL_ERROR" || realtimeStatus === "TIMED_OUT" || realtimeStatus === "CLOSED") {
          finish(() => reject(subscriptionError ?? new Error(`Presence channel ${realtimeStatus.toLowerCase()}`)));
        }
      });
    });
  } catch (error) {
    await supabase.removeChannel(channel).catch(() => undefined);
    throw error;
  }

  return channel;
}

export async function disconnectQueuePresence(channel: RealtimeChannel | null) {
  const supabase = getBrowserSupabase();
  if (!supabase || !channel) return;
  await channel.untrack();
  await supabase.removeChannel(channel);
}
