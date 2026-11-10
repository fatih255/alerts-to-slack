import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Headers = Record<string, string | undefined>;

// Hashing first gives both sides the same length, so timingSafeEqual never throws
// and the comparison time doesn't depend on how much of the secret matched.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Accepts the shared secret in an X-Alert-Secret header, or as the password of HTTP Basic auth.
 * SNS can't add custom headers, but it does send Basic auth when the subscription URL
 * looks like https://alerts:<secret>@example.com/sns.
 */
export function hasSharedSecret(headers: Headers, secret: string): boolean {
  const header = headers["x-alert-secret"];
  if (header !== undefined) return safeEqual(header, secret);

  const auth = headers["authorization"];
  if (auth?.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const password = decoded.slice(decoded.indexOf(":") + 1);
    return decoded.includes(":") && safeEqual(password, secret);
  }
  return false;
}

/** Sentry signs integration webhooks: Sentry-Hook-Signature = hex HMAC-SHA256(raw body, client secret). */
export function signSentryBody(body: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(body, "utf8").digest("hex");
}

export function hasValidSentrySignature(headers: Headers, body: string, clientSecret: string): boolean {
  const signature = headers["sentry-hook-signature"];
  if (!signature) return false;
  return safeEqual(signature, signSentryBody(body, clientSecret));
}
