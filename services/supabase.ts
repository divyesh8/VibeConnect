import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;
let anonymousAuthPromise: Promise<Session> | null = null;

function sanitizeUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

function getSafeEndpoint(rawUrl?: string | null): string {
  if (!rawUrl) return "unknown";
  try {
    return new URL(rawUrl.trim()).hostname;
  } catch {
    return "invalid_url";
  }
}

export function getBrowserSupabase(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;

  const url = sanitizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();

  if (typeof window !== "undefined") {
    console.info(`[VC][CONFIG] supabaseUrlConfigured=${Boolean(url)} supabaseAnonKeyConfigured=${Boolean(anonKey)}`);
  }

  browserClient = url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
        realtime: {
          params: { eventsPerSecond: 12 },
        },
      })
    : null;

  return browserClient;
}

export async function ensureAnonymousAuth(): Promise<Session> {
  const supabase = getBrowserSupabase();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabase) {
    console.error(`[VC][AUTH] type=CONFIG_ERROR message="Client Supabase configuration missing" supabaseUrlConfigured=${Boolean(rawUrl)} supabaseAnonKeyConfigured=${Boolean(anonKey)}`);
    throw new Error("Connection service is not configured.");
  }

  if (anonymousAuthPromise) {
    return anonymousAuthPromise;
  }

  anonymousAuthPromise = (async () => {
    try {
      // 1. Check whether a valid Supabase session already exists
      try {
        const { data: existing, error: sessionError } = await supabase.auth.getSession();
        if (!sessionError && existing?.session?.access_token && existing.session.user?.id) {
          return existing.session;
        }
      } catch (sessionErr) {
        const msg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
        console.warn(`[VC][AUTH] type=SESSION_CHECK_ERROR message=${msg}`);
      }

      // 2. No valid session exists; call signInAnonymously() with retry & exponential backoff
      const maxRetries = 2;
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const delayMs = attempt * 350;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        try {
          const { data, error } = await supabase.auth.signInAnonymously();

          if (error) {
            const isAnonymousDisabled =
              error.code === "anonymous_provider_disabled" ||
              error.status === 422 ||
              (typeof error.message === "string" &&
                error.message.toLowerCase().includes("anonymous") &&
                error.message.toLowerCase().includes("disabled"));

            if (isAnonymousDisabled) {
              console.error(`[VC][AUTH] type=AUTH_ERROR status=${error.status ?? 422} code=${error.code ?? "anonymous_provider_disabled"}`);
              throw new Error("Connection service configuration is incomplete.");
            }

            if (error.status === 401 || error.code === "invalid_api_key") {
              console.error(`[VC][AUTH] type=AUTH_ERROR status=${error.status} code=${error.code}`);
              throw new Error("Connection service configuration is incomplete.");
            }

            console.error(`[VC][AUTH] type=AUTH_ERROR status=${error.status ?? "unknown"} code=${error.code ?? "unknown"}`);
            lastError = error;

            if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
              throw new Error("Connection service configuration is incomplete.");
            }
            continue;
          }

          if (data?.session) {
            return data.session;
          }
        } catch (callError) {
          lastError = callError;

          if (callError instanceof Error && (
            callError.message === "Connection service configuration is incomplete." ||
            callError.message === "Connection service is not configured."
          )) {
            throw callError;
          }

          const errMsg = callError instanceof Error ? callError.message : String(callError);
          const isNetwork =
            errMsg.toLowerCase().includes("fetch") ||
            errMsg.toLowerCase().includes("network") ||
            callError instanceof TypeError;

          const endpoint = getSafeEndpoint(rawUrl);

          if (isNetwork) {
            console.error(`[VC][AUTH] type=NETWORK_ERROR endpoint=${endpoint} message=${errMsg}`);
          } else {
            console.error(`[VC][AUTH] type=AUTH_ERROR endpoint=${endpoint} message=${errMsg}`);
          }
        }
      }

      const finalMsg = lastError instanceof Error ? lastError.message : String(lastError);
      const isConfigRelated =
        finalMsg.toLowerCase().includes("disabled") ||
        finalMsg.toLowerCase().includes("invalid_api_key") ||
        finalMsg.toLowerCase().includes("api key");

      if (isConfigRelated) {
        throw new Error("Connection service configuration is incomplete.");
      }

      throw new Error("Connection service is temporarily unavailable. Please try again.");
    } finally {
      anonymousAuthPromise = null;
    }
  })();

  return anonymousAuthPromise;
}

export function createServerSupabase(): SupabaseClient | null {
  const url = sanitizeUrl(
    process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const serviceKey = (
    process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

