import type { RealtimeChannel } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/services/supabase";
import type { AnonymousProfile } from "@/types";

export async function connectQueuePresence(
  profile: AnonymousProfile,
  status: "searching" | "confirming",
  onSync: (liveSearchingSessions: number) => void,
) {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  const response = await fetch(`/api/presence-token?mode=${encodeURIComponent(profile.mode)}`);
  if (!response.ok) throw new Error("Presence authorization failed");
  const { token } = await response.json() as { token: string };
  await supabase.realtime.setAuth(token);

  const channel = supabase.channel(`queue:${profile.mode}`, {
    config: {
      private: true,
      presence: { key: profile.id },
    },
  });

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState<{ user_id: string; status: string }>();
    const liveSearchingSessions = Object.values(state)
      .flat()
      .filter((presence) => presence.status === "searching").length;
    onSync(liveSearchingSessions);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Presence connection timed out")), 8000);
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        window.clearTimeout(timeout);
        await channel.track({ user_id: profile.id, status, online_at: new Date().toISOString() });
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        window.clearTimeout(timeout);
        reject(new Error(`Presence channel ${status.toLowerCase()}`));
      }
    });
  });

  return channel;
}

export async function disconnectQueuePresence(channel: RealtimeChannel | null) {
  const supabase = getBrowserSupabase();
  if (!supabase || !channel) return;
  await channel.untrack();
  await supabase.removeChannel(channel);
}
