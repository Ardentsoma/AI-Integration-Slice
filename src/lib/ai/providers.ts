import "server-only";

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { aiConfig } from "./config";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  FOLLOW_UP_ACTION_INSTRUCTIONS,
  FOLLOW_UP_SYSTEM_PROMPT,
} from "./prompts";
import { outlineSchema, type Outline } from "./schema";
import { runAITask, withTimeout, AiTimeoutError } from "./queue";
import {
  createMemoryRateLimiter,
  type RateLimitStore,
} from "../rate-limit";

/**
 * Provider-facing code for the two AI roles in this slice.
 *
 * - Extraction (Gemini): official @google/generative-ai SDK, JSON mode with a
 *   responseSchema, plus our own Zod validation on top.
 * - Follow-up (DeepSeek): OpenAI's official SDK pointed at DeepSeek's
 *   OpenAI-compatible endpoint (DeepSeek has no dedicated JS SDK).
 *
 * Every network call is wrapped in the shared timeout AND the shared
 * concurrency limiter AND the shared per-provider egress rate meter.
 * Egress meter is process-local; move to a shared store before scaling.
 */

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `The ${provider} provider is not configured. Add its API key to .env.`
    );
    this.name = "ProviderNotConfiguredError";
  }
}

type ProviderName = keyof typeof aiConfig.rateLimits.providerEgress;

// One in-memory token bucket per provider (see aiConfig.rateLimits
// .providerEgress). Lazily created so imports stay side-effect free.
const providerEgressMeters = new Map<ProviderName, RateLimitStore>();

function getProviderEgressMeter(providerName: ProviderName): RateLimitStore {
  let meter = providerEgressMeters.get(providerName);
  if (!meter) {
    const { rpm } = aiConfig.rateLimits.providerEgress[providerName];
    meter = createMemoryRateLimiter(rpm, rpm / 60);
    providerEgressMeters.set(providerName, meter);
  }
  return meter;
}

/** Wraps a provider call in the process-wide egress meter: one token per
 * call at the provider's configured requests/min. Denied calls throw
 * ProviderRateLimitExceededError without touching the wire, so the retry loop
 * below can back off the exact amount the bucket specifies. */
function withProviderMeter<T>(
  providerName: ProviderName,
  task: () => Promise<T>
): Promise<T> {
  const { allowed, retryAfter } = getProviderEgressMeter(providerName).check(
    providerName,
    Date.now()
  );
  if (!allowed) {
    throw new ProviderRateLimitExceededError(providerName, retryAfter);
  }
  return task();
}

/** Thrown when a provider call succeeded on the wire but the response was
 * malformed (non-JSON, out of schema, or empty). Jobs fail fast on this. */
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

/** Thrown when a provider call is blocked by the in-process egress meter
 * before ever reaching the wire. Treated as transient so the retry loop backs
 * off the exact time the bucket says, then tries again. */
export class ProviderRateLimitExceededError extends Error {
  constructor(
    readonly providerName: string,
    readonly retryAfter: number
  ) {
    super(
      `The ${providerName} provider is currently rate-limited. Retry again in ${Math.max(
        Math.ceil(retryAfter),
        1
      )}s.`
    );
    this.name = "ProviderRateLimitExceededError";
  }
}

let gemini: GoogleGenerativeAI | null = null;

function getGeminiClient(): GoogleGenerativeAI {
  if (!aiConfig.providers.gemini.apiKey) {
    throw new ProviderNotConfiguredError("Gemini");
  }
  if (!gemini) gemini = new GoogleGenerativeAI(aiConfig.providers.gemini.apiKey);
  return gemini;
}

let deepSeek: OpenAI | null = null;

function getDeepSeekClient(): OpenAI {
  if (!aiConfig.providers.deepseek.apiKey) {
    throw new ProviderNotConfiguredError("DeepSeek");
  }
  if (!deepSeek) {
    // DeepSeek has no dedicated JS SDK, but exposes an OpenAI-compatible API,
    // so the official OpenAI SDK is pointed at DeepSeek's endpoint.
    deepSeek = new OpenAI({
      apiKey: aiConfig.providers.deepseek.apiKey,
      baseURL: aiConfig.providers.deepseek.baseURL,
      // We do our own timeout + single retry in the job processor; disabling
      // the SDK's own retries avoids duplicate hidden work on top of that.
      maxRetries: 0,
      timeout: aiConfig.providers.deepseek.timeoutMs,
    });
  }
  return deepSeek;
}

/** Extracts a JSON object out of a model response, tolerating a markdown
 * fence if one slips through despite JSON mode. */
function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** True for failures worth retrying: our own timeout, the egress meter,
 * low-level network errors (TypeError), and HTTP 429/5xx from the provider.
 * Everything else (invalid key, 402 no balance, malformed response) is
 * permanent and must surface immediately. */
function isTransientAIError(err: unknown): boolean {
  if (err instanceof AiTimeoutError) return true;
  if (err instanceof ProviderRateLimitExceededError) return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; status?: number };
  if (e.name === "TypeError") return true;
  return typeof e.status === "number" && [429, 500, 502, 503, 504].includes(e.status);
}

/** Reads a numeric `retry-after` header (seconds) out of a provider SDK error,
 * tolerating both the plain-object style (openai v3/older) and the fetch
 * Headers style (openai v7 `APIError.headers`, undici Headers). Returns ms or
 * null when absent/unparseable — callers fall back to exponential backoff. */
function readProviderRetryAfterMs(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const headers = (err as { headers?: unknown }).headers;
  if (headers == null) return null;

  let raw: string | null = null;
  if (
    typeof headers === "object" &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    raw = (headers as { get: (name: string) => string | null }).get(
      "retry-after"
    );
  } else {
    const record = headers as Record<string, unknown>;
    const value = record["retry-after"] ?? record["Retry-After"];
    if (typeof value === "string") raw = value;
    else if (Array.isArray(value) && typeof value[0] === "string") {
      raw = value[0];
    }
  }

  if (raw == null) return null;
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

/** How long to wait before the next retry attempt. Precedence: our own egress
 * meter's retryAfter, then the provider's `retry-after` header, then the
 * configured exponential backoff. Floor of 1s avoids busy-loop spin. */
function transientRetryDelayMs(err: unknown, attempt: number): number {
  const { backoffBaseMs, backoffFactor } = aiConfig.retries;

  if (err instanceof ProviderRateLimitExceededError) {
    return Math.max(err.retryAfter * 1000, 1000);
  }
  const providerRetryAfterMs = readProviderRetryAfterMs(err);
  if (providerRetryAfterMs !== null) {
    return Math.max(providerRetryAfterMs, 1000);
  }
  return backoffBaseMs * Math.pow(backoffFactor, attempt);
}

/** Runs a provider task, retrying transient failures (503 high-demand, 429,
 * timeouts, network blips, egress meter) with backoff before giving up and
 * rethrowing. Each attempt separately acquires the concurrency slot, its own
 * timeout, and its own egress-meter token. */
async function withTransientRetry<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  const { maxTransientRetries } = aiConfig.retries;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxTransientRetries; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastErr = err;
      if (!isTransientAIError(err) || attempt >= maxTransientRetries) throw err;
      const delayMs = transientRetryDelayMs(err, attempt);
      console.warn(
        `[ai] ${label} transient failure (${(err as Error).message}); retrying in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

/** Role 1 — extraction. Calls Gemini in JSON mode and validates the result
 * against the Zod outline schema. Throws InvalidResponseError when the model
 * returns malformed/off-schema output so the caller can decide to retry.
 * Returns the parsed outline plus the model name that actually produced it
 * (relevant when the fallback chain kicks in). */
export async function extractOutlineFromBrief(
  briefText: string,
  opts: { strict: boolean }
): Promise<{ outline: Outline; model: string }> {
  const cfg = aiConfig.providers.gemini;
  const systemInstruction = opts.strict
    ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${aiConfig.extraction.strictReminder}`
    : EXTRACTION_SYSTEM_PROMPT;

  // Walk the model chain: try the primary with its transient retries, then
  // each fallback in turn. This keeps extraction alive during provider-side
  // model saturations (e.g. 3.6-flash constantly 503ing) instead of failing
  // every upload until the outage passes. Only transient errors (503/429/
  // timeout/network) advance to the next model; hard errors throw immediately.
  let lastErr: unknown;
  for (const modelName of [cfg.model, ...cfg.fallbackModels]) {
    try {
      const model = getGeminiClient().getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: {
          temperature: cfg.temperature,
          maxOutputTokens: cfg.maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_JSON_SCHEMA,
        },
      });

      const raw = await withTransientRetry(`gemini extraction (${modelName})`, () =>
        runAITask(() =>
          withTimeout(
            withProviderMeter("gemini", () =>
              model.generateContent({
                contents: [{ role: "user", parts: [{ text: briefText }] }],
              })
            ),
            cfg.timeoutMs,
            `Gemini extraction timed out after ${cfg.timeoutMs}ms.`
          )
        )
      );

      const text = raw.response?.text?.() ?? "";
      if (!text.trim()) {
        throw new InvalidResponseError(
          "Gemini returned an empty response. Please try again."
        );
      }

      const parsed = outlineSchema.safeParse(parseJsonObject(text));
      if (!parsed.success) {
        // Aggregate the failing paths for a clear, honest error message.
        const paths = parsed.error.issues
          .slice(0, 5)
          .map((issue) => issue.path.join(".") || "(root)")
          .join(", ");
        throw new InvalidResponseError(
          `Gemini's response did not match the outline schema (missing/invalid: ${paths}).`
        );
      }

      return { outline: parsed.data, model: modelName };
    } catch (err) {
      if (!isTransientAIError(err)) throw err;
      lastErr = err;
      console.warn(
        `[ai] gemini extraction (${modelName}) failed transitively: ${(err as Error).message};
 trying next model in fallback chain`
      );
    }
  }
  throw lastErr;
}

/** Role 2 — follow-up action. Runs the requested action (e.g. "expand") on a
 * finished outline via DeepSeek and returns the expanded brief as the same
 * structured Outline as extraction, plus the model used. */
export async function runFollowUpAction(
  outline: Outline,
  action: string
): Promise<{ outline: Outline; model: string }> {
  const cfg = aiConfig.providers.deepseek;
  const instruction = FOLLOW_UP_ACTION_INSTRUCTIONS[action];
  if (!instruction) {
    throw new InvalidResponseError(`Unknown follow-up action: ${action}`);
  }

  const client = getDeepSeekClient();
  const completion = await withTransientRetry("deepseek follow-up", () =>
    runAITask(() =>
      withTimeout(
        withProviderMeter("deepseek", () =>
          client.chat.completions.create({
            model: cfg.model,
            temperature: cfg.temperature,
            max_tokens: cfg.maxOutputTokens,
            // DeepSeek (like OpenAI) supports JSON-mode output; combined with
            // the prompt demanding the exact outline schema this returns
            // structured data, not markdown, so rendering/export both work
            // with the same Outline shape used for extraction.
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: FOLLOW_UP_SYSTEM_PROMPT },
              {
                role: "user",
                content: `${instruction}\n\nOUTLINE:\n${JSON.stringify(outline, null, 2)}`,
              },
            ],
          })
        ),
        cfg.timeoutMs,
        `DeepSeek follow-up timed out after ${cfg.timeoutMs}ms.`
      )
    )
  );

  const content = completion.choices[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new InvalidResponseError(
      "DeepSeek returned an empty response. Please try again."
    );
  }

  const parsed = outlineSchema.safeParse(parseJsonObject(content));
  if (!parsed.success) {
    // Aggregate the failing paths for a clear, honest error message.
    const paths = parsed.error.issues
      .slice(0, 5)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new InvalidResponseError(
      `DeepSeek's expanded brief did not match the outline schema (missing/invalid: ${paths}).`
    );
  }

  return { outline: parsed.data, model: cfg.model };
}