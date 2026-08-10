import { SignJWT } from "jose";

export async function signRealtimeToken(userId: string) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + 15 * 60)
    .sign(new TextEncoder().encode(secret));
}
