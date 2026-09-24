/**
 * Tiny sessionStorage wrapper for auth form state.
 *
 * - Session-scoped (per browser tab) and dropped when the tab closes; cleared
 *   automatically once the owning flow completes (e.g. sign-in, verify).
 * - ONLY non-sensitive fields are ever saved: email and full name. Passwords,
 *   password confirmations and OTP codes are never persisted.
 * - Safe to call from anywhere: returns null / no-ops on the server and when
 *   storage is unavailable (private browsing), so it degrades gracefully to
 *   plain uncontrolled form behaviour.
 */
const PREFIX = "scope_form.";

export const KEYS = {
  signinEmail: `${PREFIX}signin.email`,
  signupFullName: `${PREFIX}signup.fullName`,
  signupEmail: `${PREFIX}signup.email`,
  forgotEmail: `${PREFIX}forgot.email`,
} as const;

export function loadFormValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveFormValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable — nothing to persist, keep the form usable.
  }
}

export function clearFormValue(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}