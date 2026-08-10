import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "local";
}

export function allowRequest(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) return { allowed: false, remaining: 0 };
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count };
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function allowDistributedRequest(
  supabase: SupabaseClient | null,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  if (!supabase) return allowRequest(key, limit, windowSeconds * 1000).allowed;
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_key: await sha256(key),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return allowRequest(key, limit, windowSeconds * 1000).allowed;
  return Boolean(data);
}

export function secureEquals(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
