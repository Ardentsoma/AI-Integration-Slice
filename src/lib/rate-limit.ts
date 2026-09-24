import type { NextRequest } from "next/server";

/**
 * Per-process in-memory rate limiter (token bucket) for local development.
 *
 * Tradeoff: data lives in this process's memory, so limits reset on restart
 * and are not shared across multiple server instances. For production this
 * should be swapped for a shared store (Upstash Redis / Redis) — the
 * `RateLimitStore` interface below is the seam to plug one in without
 * touching the route handlers.
 */
export interface RateLimitStore {
  check(key: string, now: number): { allowed: boolean; retryAfter: number };
}

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

// In-memory implementation. Replace with a Redis-backed implementation behind
// the same interface for production. NOTE: local-only, resets on restart.
const buckets = new Map<string, TokenBucketState>();

export function createMemoryRateLimiter(
  capacity: number,
  refillPerSecond: number
): RateLimitStore {
  return {
    check(key: string, now: number) {
      return checkTokenBucket(key, now, capacity, refillPerSecond);
    },
  };
}

function refillBucket(
  bucket: TokenBucketState,
  capacity: number,
  refillPerSecond: number,
  now: number
) {
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + ((now - bucket.lastRefill) / 1000) * refillPerSecond
  );
  bucket.lastRefill = now;
}

function checkTokenBucket(
  key: string,
  now = Date.now(),
  capacity: number,
  refillPerSecond: number
): { allowed: boolean; retryAfter: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    buckets.set(key, bucket);
  } else {
    refillBucket(bucket, capacity, refillPerSecond, now);
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfter: 0 };
  }

  const deficit = 1 - bucket.tokens;
  return { allowed: false, retryAfter: Math.ceil(deficit / refillPerSecond) };
}

export interface RateLimitConfig {
  capacity: number;
  refillPerSecond: number;
}

// Endpoint budgets. Keyed by IP + account identifier (email for auth flows,
// userId for AI endpoints) so one endpoint can be hammered only from that
// combination, without an attacker on a single IP locking out a legit
// account globally.
export const RATE_LIMITS = {
  signin: { capacity: 5, refillPerSecond: 5 / 60 }, //  5 / min  per IP+email
  signup: { capacity: 5, refillPerSecond: 5 / 60 }, //  5 / min  per IP+email
  resetRequest: { capacity: 3, refillPerSecond: 3 / 3600 }, // 3 / hour per IP+email
  resend: { capacity: 5, refillPerSecond: 5 / 600 }, //  5 / 10min per IP+email
  briefUpload: { capacity: 5, refillPerSecond: 5 / 60 }, //  5 / min  per IP+user (AI brief uploads)
  followUp: { capacity: 10, refillPerSecond: 10 / 60 }, // 10 / min  per IP+user (follow-up actions)
  ip: { capacity: 40, refillPerSecond: 40 / 60 }, // 40 / min  per IP (any endpoint)
} satisfies Record<string, RateLimitConfig>;

/** Extracts the best-effort client IP from forwarded headers (dev-safe). */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "local";
}

export type Endpoint =
  | "signin"
  | "signup"
  | "resetRequest"
  | "resend"
  | "briefUpload"
  | "followUp";

/** Applies the endpoint budget (IP+identity keyed) plus the shared per-IP
 * bucket. Buckets are namespaced with the endpoint so "5/min" on an endpoint
 * means five calls to that endpoint, not five any-endpoint calls on one
 * account. Returns the effective Retry-After (seconds) from the culprit bucket. */
function checkBucket(
  request: NextRequest,
  endpoint: Endpoint,
  identityKey: string
): { allowed: boolean; retryAfter: number } {
  const ip = clientIp(request);
  const config = RATE_LIMITS[endpoint];

  const accountResult = checkTokenBucket(
    `${endpoint}:${ip}:${identityKey}`,
    Date.now(),
    config.capacity,
    config.refillPerSecond
  );
  if (!accountResult.allowed) return accountResult;

  const ipResult = checkTokenBucket(
    `ip:${ip}`,
    Date.now(),
    RATE_LIMITS.ip.capacity,
    RATE_LIMITS.ip.refillPerSecond
  );
  return ipResult;
}

/**
 * Applies the endpoint budget keyed by IP + email (auth flows). See
 * `checkBucket` for the bucket layout.
 */
export function checkEndpointRateLimit(
  request: NextRequest,
  endpoint: Endpoint,
  email: string
): { allowed: boolean; retryAfter: number } {
  return checkBucket(request, endpoint, email);
}

/**
 * Applies the endpoint budget keyed by IP + signed-in userId. Used by the
 * brief-upload and follow-up action endpoints so limits follow the user (not
 * just their email), even though these calls are never anonymous.
 */
export function checkUserRateLimit(
  request: NextRequest,
  endpoint: Endpoint,
  userId: string
): { allowed: boolean; retryAfter: number } {
  return checkBucket(request, endpoint, userId);
}