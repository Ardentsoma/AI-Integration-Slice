export const SESSION_COOKIE = "scope_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Signs and verifies session cookies using HMAC-SHA-256 via the Web Crypto
 * API so the same code runs in middleware (Node/Edge) and in Node route
 * handlers. Cookie format:
 *   base64url("{sessionId}.{expiresAtMs}") + "." + base64url(hmac)
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return secret;
}

function encodeB64url(input: string): string {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeB64url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
  return atob(padded);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  const bytes = new Uint8Array(signature);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSessionCookie(
  sessionId: string,
  expiresAtMs: number,
  secret: string
): Promise<string> {
  const payload = `${sessionId}.${expiresAtMs}`;
  const signature = await hmacSign(payload, secret);
  return `${encodeB64url(payload)}.${signature}`;
}

export interface VerifiedSession {
  sessionId: string;
  expiresAtMs: number;
}

export async function verifySessionCookie(
  value: string,
  secret: string
): Promise<VerifiedSession | null> {
  try {
    const [encodedPayload, signature] = value.split(".");
    if (!encodedPayload || !signature) return null;

    const payload = decodeB64url(encodedPayload);
    const expected = await hmacSign(payload, secret);
    if (!constantTimeEqual(signature, expected)) return null;

    const dot = payload.lastIndexOf(".");
    if (dot <= 0) return null;
    const sessionId = payload.slice(0, dot);
    const expiresAtMs = Number(payload.slice(dot + 1));
    if (!sessionId || !Number.isFinite(expiresAtMs)) return null;

    // Reject already-expired cookies before any DB work.
    if (expiresAtMs < Date.now()) return null;

    return { sessionId, expiresAtMs };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}