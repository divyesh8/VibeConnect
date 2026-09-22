import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

export function getBrowserSupabase() {
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  browserClient = url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 12 } },
      })
    : null;
  return browserClient;
}

export async function ensureAnonymousAuth() {
  const supabase = getBrowserSupabase();
  if (!supabase) throw new Error("Supabase is not configured");
  try {
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session) return existing.session;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      console.error("[AUTH] Supabase anonymous sign-in failed:", error);
      throw new Error(error?.message ?? "Could not create an anonymous identity");
    }
    return data.session;
  } catch (authError) {
    console.error("[AUTH] ensureAnonymousAuth failed:", authError);
    const details = authError instanceof Error ? authError.message : String(authError);
    throw new Error(`Anonymous identity service unavailable: ${details}`);
  }
}

export function createServerSupabase() {
  const url = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
