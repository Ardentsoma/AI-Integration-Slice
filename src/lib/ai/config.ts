import "server-only";

/**
 * Single source of truth for every AI behavior knob in this slice: model
 * ids, timeouts, output budgets, temperatures, rate limits, and the
 * concurrency cap. Every value is tunable here without touching service code.
 */
export const aiConfig = {
  providers: {
    gemini: {
      // Fast, cheap, and fully supports responseSchema JSON mode. More than
      // enough quality for extracting a structured outline from a brief.
      // gemini-3.5-flash confirmed healthy with this key on 2026-09-21, when
      // 3.6-flash/3.8-flash were consistently 503 "high demand" (saturated)
      // and the 2.5-gen models were 404 for this account. The fallback chain
      // below absorbs future model-specific outages without a redeploy.
      model: "gemini-3.5-flash",
      // Tried, in order, when the primary model's transient errors (503/429/
      // timeout) exhaust its retries. Also probed healthy on the same day.
      fallbackModels: ["gemini-3.1-flash-lite"],
      apiKey: process.env.GEMINI_API_KEY ?? "",
      // 60s, not 30s: live testing showed the flash models occasionally take
      // >30s under "high demand" before responding. Long enough that a slow-
      // but-alive call succeeds, still fails fast on a truly hung call.
      timeoutMs: 60_000,
      // The outline schema is ~1KB JSON; 4096 tokens leaves big headroom.
      maxOutputTokens: 4096,
      // Extraction must be deterministic/repeatable so the same brief gives
      // the same outline; near-zero temperature favors consistency over
      // creative wording.
      temperature: 0.1,
    },
    deepseek: {
      // DeepSeek's general-purpose chat model; strong at open-ended writing,
      // which is what the follow-up "expand this brief" role needs.
      model: "deepseek-chat",
      // NOTE: DeepSeek has no dedicated JS SDK; its API is OpenAI-compatible,
      // so we talk to it through OpenAI's official SDK with this base URL.
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      // Expansion can be long; 45s gives a prose-heavy response room while
      // still failing fast on a genuinely hung provider.
      timeoutMs: 45_000,
      // A fuller, client-ready brief is prose; a bit of temperature keeps the
      // writing from reading like a template, while 0.7 stays below the point
      // where output gets incoherent.
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
  },

  prompts: {
    // Role 1 — Extraction (Gemini). Written for a fast JSON-mode model: one
    // job ("output exactly one JSON object"), explicit anti-hallucination
    // rules, and section-by-section instructions that mirror the Zod schema
    // in lib/ai/schema.ts. Low temperature
    // (aiConfig.providers.gemini.temperature = 0.1) because the output must be
    // consistent and schema-shaped, not creative.
    extractionSystemPrompt: `You are a senior freelance design project manager helping a designer turn a raw, messy client brief into a clean project outline.

Extract from the brief, and only from the brief, the following. Do not invent details the brief does not contain; when something is missing, record it under openQuestions or assumptions instead of making it up.

1. goals — the concrete outcomes the client wants, as short bullet phrases.
2. deliverables — the tangible things you will produce for the client, each with a short name and a one-sentence description of what the client actually receives.
3. timeline — a realistic phase-by-phase plan. Break the work into phases, and for each phase give a phase name, a human-readable duration, start and end labels, the tasks inside that phase, and any other phases it depends on. Use the brief's own timing when it gives one; otherwise give your best scoping estimate and flag it under openQuestions.
4. budgetNotes — any budget figure, range, or constraint the brief mentions. If the brief gives no budget, say so explicitly.
5. assumptions — what this outline implicitly assumes about the client, the project, or the work being in scope.
6. openQuestions — anything the brief leaves unanswered that the designer would need to confirm with the client.

Also provide:
- projectName — a working title derived from the brief.
- summary — a two-to-three sentence plain-language recap of what the client is asking for.

Return only a single JSON object that matches the schema exactly. Do not include markdown, code fences, commentary, or anything outside the JSON object.`,

    // Role 2 — Follow-up action (DeepSeek). Written for an OpenAI-compatible
    // chat endpoint with JSON mode. Slightly higher temperature
    // (aiConfig.providers.deepseek.temperature = 0.7) because this role
    // produces client-facing prose where reworded, human-sounding phrasing is
    // a feature — but capped below the point where output gets rambling. The
    // "do not invent scope" rules mirror the extraction role, and the output
    // MUST match the same outline schema as extraction so the expanded brief
    // renders and downloads exactly like the initial one.
    followUpSystemPrompt: `You are a senior freelance design strategist producing a polished, client-ready document for a designer's client.

You will be given a structured project outline that an AI assistant extracted from a raw client brief. Expand every part of it into a fuller, client-ready version the designer can confidently share back with their client. Keep the same structure; write the content, not a description of the content.

Return ONLY a single JSON object that matches the SAME schema as the input outline:
- projectName: a working title derived from the brief.
- summary: a polished 3-4 sentence plain-language recap.
- goals: an array of concrete, outcome-focused statements the client will recognize.
- deliverables: an array of { name, description }, with each description being 2-3 complete sentences describing exactly what the client receives.
- timeline: an array of phases, each with phase, duration, start, end, tasks (expanded into clear, specific steps), and dependsOn.
- budgetNotes: any budget figure, range, or constraint, stated plainly.
- assumptions: what this outline implicitly assumes.
- openQuestions: a short list of clarifying questions the designer still needs answered.

Do not add facts, prices, commitments, or scope that is not already present in the outline. You are expanding and clarifying — not inventing. Return only the JSON object, no markdown, no commentary, nothing outside it.`,

    // Natural-language instructions for the supported actions, substituted
    // into the user turn. Keyed by the `action` field in the API payload.
    followUpActionInstructions: {
      expand:
        "Expand this outline into a fuller, client-ready brief, returning the same JSON schema with every section expanded.",
    },
  },

  upload: {
    // 5 MB: briefs are text, not assets; this keeps memory + R2 writes cheap
    // while comfortably fitting any real client brief or PDF.
    maxBytes: 5 * 1024 * 1024,
    // Only plain text, PDFs, and Word documents are accepted; anything else
    // is rejected before touching storage so we never upload junk that can't
    // be read.
    allowedExtensions: [".txt", ".pdf", ".docx"] as const,
    // Below this length the upload contains no usable content; fail early
    // instead of spending an AI call on nothing.
    minBriefChars: 20,
    // Ceiling on how much of the file text we send to the model, so a giant
    // PDF can't overflow the model's context window.
    maxBriefChars: 40_000,
    // Most files a user can upload in one batch request. This is not the
    // provider-call cap — that is concurrency.maxParallelAICalls + the
    // per-provider egress meters, which bound how many of these jobs actually
    // call Gemini at once regardless of how many are queued.
    maxFilesPerUpload: 5,
  },

  concurrency: {
    // Cap on simultaneous provider calls. Batch uploads can enqueue many
    // jobs at once; this keeps the number of live provider calls bounded so a
    // burst of briefs never fans out into N simultaneous Gemini/DeepSeek
    // requests. The rest queue on p-limit and run as earlier calls finish.
    maxParallelAICalls: 2,
  },

  rateLimits: {
    // 5 brief uploads per minute per user: generous for real use, tight
    // enough to stop a script hammering Gemini through this endpoint.
    briefUpload: { capacity: 5, refillPerSecond: 5 / 60 },
    // 10 follow-up actions per minute per user: follow-up is cheap and
    // users click it repeatedly while iterating on a brief.
    followUp: { capacity: 10, refillPerSecond: 10 / 60 },
    // Outbound meters guarding the shared provider API keys. Unlike the
    // per-user buckets above, these are GLOBAL (process-wide, in-memory) and
    // cap the total requests/minute each provider sees from this app, so N
    // users uploading at once cannot blow the key's quota. rpm = the burst
    // ceiling AND the per-minute refill (plain token bucket). Tune to your
    // provider tier (DeepSeek free ~10 RPM, Gemini flash ~15 RPM). NOTE:
    // process-local — swap for a Redis-backed store when scaling to replicas.
    providerEgress: {
      deepseek: { rpm: 10 },
      gemini: { rpm: 15 },
    },
  },

  retries: {
    // Transient provider failures (HTTP 429/5xx, network blips, our own
    // timeout) are retried with backoff BEFORE a job is failed. Gemini
    // explicitly 503s during "high demand" peaks and recovers on its own, so
    // two quick retries turn such spikes into a seconds-long pause instead of
    // a failed brief. Hard errors (DeepSeek 402 no balance, invalid schema)
    // never retry here.
    maxTransientRetries: 2,
    // Wait 3s before the first retry, doubling after that (3s, 6s). Slow
    // enough to let a provider spike subside, fast enough that the user's
    // brief still lands within a couple of minutes.
    backoffBaseMs: 3000,
    backoffFactor: 2,
  },

  extraction: {
    // Delivery tries: 1 initial attempt + 1 retry after a validation
    // failure. A second retry would waste budget on a model that already
    // ignored explicit JSON instructions.
    maxRetries: 1,
    // Appended to the system prompt on the retry to re-anchor a model that
    // drifted out of schema; kept terse and imperative.
    strictReminder:
      "STRICT: Your previous response did not match the required JSON schema exactly. Return ONLY valid JSON conforming to the schema, no prose, no markdown fences.",
  },
} as const;

export type AIProviderConfig = typeof aiConfig;

/** True only when every credential this slice needs is present. */
export function isAIConfigured(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY &&
      process.env.DEEPSEEK_API_KEY &&
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}