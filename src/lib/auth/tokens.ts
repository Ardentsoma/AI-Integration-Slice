import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** 6-digit numeric verification code from a CSPRNG. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Cryptographically random 256-bit token for reset links. */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** Store only the sha-256 of codes/tokens in the DB. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time hex string comparison (used for code/token hash checks). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}