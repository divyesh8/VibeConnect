type TurnstileResult = {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export async function verifyTurnstile(token: string | undefined, remoteIp: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: remoteIp,
    idempotency_key: crypto.randomUUID(),
  });
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as TurnstileResult;
    return result.success && (!result.action || result.action === "create-session");
  } catch (error) {
    console.error("[SECURITY] bot challenge verification failed", error);
    return false;
  }
}
