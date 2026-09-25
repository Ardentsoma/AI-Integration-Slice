# DOCUMENTATION.md — Scope: AI Integration Slice

## 1. What This Is

Scope's AI integration slice lets a freelance designer upload one or more
messy client briefs (plain text, PDF, or Word). Each file is processed in the
background and extracted into a structured project outline —
`projectName`, `summary`, `goals`, `deliverables`, `timeline`, `budgetNotes`,
`assumptions`, and `openQuestions` — using Google Gemini. The designer can
then run a follow-up action on any finished outline (today: "expand this into
a fuller client-ready brief") using DeepSeek. The expanded brief comes back in
the **same structured outline format as the original extraction**, so it
renders and exports identically to the initial one.

The outline and the expanded version can both be downloaded as a **PDF or
DOCX** file, generated server-side from the structured outline.

**Authentication** is inherited unchanged from **Slice 1**: email + password
signup/signin with a 6-digit email verification code, HMAC-signed session
cookies backed by a `Session` table, and one-shot hashed password-reset
tokens. This slice re-used that flow as-is (see `src/lib/auth/`) and added
only the AI routes and pages on top. All of these routes are ownership-guarded
per request — a signed-in user can only read/download their own jobs.

This slice deliberately does not include editing, sharing, collaborative
review, or a history view across briefs. It also does not include a persistent
job queue (see Sections 6 and 7 for the real tradeoffs).

---

## 2. How To Run It

1. Install dependencies: `npm install`.
2. Environment variables (see `.env.example`):
   - `DATABASE_URL` — PostgreSQL connection string (the app role connects as
     `scope`/`scope_secret` in the bundled docker-compose Postgres).
   - `AUTH_SECRET` — secret used to sign the session cookie
     (HMAC-SHA-256); from Slice 1.
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` —
     Gmail SMTP for the email-verification code. If `SMTP_USER`/`SMTP_PASS`
     are blank, verification codes are printed to the server console
     ("email:dev" mode) — from Slice 1.
   - `GEMINI_API_KEY` — from Google AI Studio; used by the extraction role.
   - `DEEPSEEK_API_KEY` — from DeepSeek's platform; used by the follow-up
     action role via the OpenAI SDK pointed at DeepSeek's endpoint (see
     Section 5, "SDKs vs Raw HTTP").
   - `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
     `R2_BUCKET_NAME` — Cloudflare R2 credentials for brief file storage.
   - `R2_ENDPOINT` — optional override for the S3 endpoint (tests/self-hosted
     setups).
3. Database setup: `npx prisma migrate deploy` (applies the checked-in
   migrations), then `npx prisma generate`.
4. Start: `npm run dev`.
5. Open `http://localhost:3000`, create an account (email verification
   required), then use the briefs page at `http://localhost:3000/dashboard/briefs`.

---

## 3. The Flow, Step By Step

**Uploading briefs**

The user drops one or more briefs (up to 5 per batch, `.txt`/`.pdf`/`.docx`,
max 5 MB each) onto `/dashboard/briefs`. The `BriefsApp` component posts a
`multipart/form-data` request with every file to `POST /api/briefs`. The
server:

1. applies the per-user upload rate limit and validates the whole batch
   atomically (an invalid file rejects the entire batch with a clear error),
2. uploads each file's bytes directly to Cloudflare R2
   (`src/lib/ai/storage.ts`, key layout `briefs/{userId}/{jobId}/{name}`),
3. creates one `Job` row per file with status `pending`,
4. replies immediately with `{ jobIds: string[] }` — the user is never kept
   waiting on the AI call itself.

The extraction jobs are then fired in the background (fire-and-forget in the
same Node process; see "Jobs and Workers" below).

**Background processing (extraction)**

Each queued job (`runExtractionJob` in `src/lib/ai/jobs.ts`) downloads its
file from R2 by storage key, extracts plain text (UTF-8 for `.txt`,
`pdf-parse` for `.pdf`, `mammoth` for `.docx` — `src/lib/ai/extract.ts`), and
sends it to Gemini using the extraction system prompt with `responseSchema`
JSON mode. The response is validated against a Zod `outlineSchema` in our own
code before being persisted. The job row tracks fine-grained progress
(`processingStage`: downloading-file → extracting-text → calling-provider),
so the client can show where each file is. Status ends at `done` (with
`resultJson`) or `failed` (with `errorMessage`).

**Viewing the result**

The client polls `GET /api/jobs/[id]` for every job in the batch until each is
done/failed, then renders one card per brief from the stored `resultJson`. A
"Download: PDF | DOCX" row per brief hits
`GET /api/briefs/[id]/export?format=pdf|docx`, which renders the outline
server-side (`pdf-lib` for PDF, `docx` for Word — `src/lib/ai/export.ts`).

**The follow-up action**

Clicking "Expand this brief" sends `POST /api/briefs/[id]/follow-up` with the
extraction job id as the parent. The server verifies the parent belongs to the
user and is `done`, creates a new "follow-up" `Job` linked to its parent via
`parentJobId`, and replies immediately. The background job
(`runFollowUpJob`) calls DeepSeek in JSON mode with the follow-up system
prompt and the outline as input; the response is a **new outline object in the
same schema**, validated with the same Zod schema, and stored as the
follow-up job's `resultJson`. The client renders it with the same structured
outline view (without repeating the headline) plus its own "Download expanded:
PDF | DOCX" row.

---

## 4. The Data Model

The actual Prisma schema (`prisma/schema.prisma`) is:

```prisma
model Job {
  id String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  type String                 // "extraction" | "follow-up"
  status String @default("pending") // pending | processing | done | failed

  processingStage String?     // downloading-file | extracting-text | calling-provider
  attempts Int @default(0)   // AI attempts so far (1 = first try, …)
  originalFileName String    // sanitized name the user uploaded
  contentType String?        // MIME type declared at upload
  fileSizeBytes Int?         // uploaded byte size

  errorMessage String?
  inputStorageKey String      // R2 object key; never the file bytes

  provider String?            // "gemini" | "deepseek"
  model    String?            // model that actually produced the result
  charactersExtracted Int?    // text chars actually sent to the model

  parentJobId String?         // follow-ups link to the extraction they extend
  parent      Job?  @relation("JobHierarchy", fields: [parentJobId], references: [id], onDelete: SetNull)
  childJobs   Job[] @relation("JobHierarchy")

  resultJson String?          // structured outline JSON (both roles)

  startedAt  DateTime?
  finishedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, status])
  @@index([userId, createdAt])
  @@index([parentJobId])
}
```

**`Job`**

- Holds one row per unit of AI work — either an extraction or a follow-up
  action — with a full lifecycle plus a fine-grained `processingStage` the
  client polls on, rather than a simple boolean.
- `inputStorageKey` — only a reference to the file in Cloudflare R2 is stored
  here, never the file's contents. `originalFileName`, `contentType`, and
  `fileSizeBytes` record file metadata at upload time.
- `attempts` / `errorMessage` — `attempts` exists to track how many AI tries a
  job took (1 = first attempt, 2 = retried after a validation failure), and
  `errorMessage` gives an honest, user-facing failure reason instead of a
  silent dead row. `startedAt`/`finishedAt` let a dashboard measure duration.
- `resultJson` — a JSON string containing the full structured outline object
  for both roles. It is structured because the outline is a fixed shape that
  is rendered, validated, and exported; free text would force fragile parsing
  later.
- `provider` / `model` — recorded *after* the call so the fallback chain
  exposes which model really ran (the extraction primary model is
  `gemini-3.5-flash` with `gemini-3.1-flash-lite` as fallback).
- `parentJobId` — the self-relation makes a follow-up job's provenance
  explicit, so the whole history of one brief reads as a tree.

**Which constraints make an invalid state impossible?**

- A job is only ever created by its owner (`userId` enforced in every route),
  and every route re-scopes queries to the signed-in user.
- Only `pending` → `processing` → `done|failed` transitions happen in the
  worker (`markJobFailed` uses `updateMany` with `status IN (pending,
  processing)`, so a slow retry can never overwrite a job that just
  succeeded).
- `resultJson`/the outline is validated against the Zod schema before it is
  written, so a `done` job always holds parseable, schema-shaped data.
- `originalFileName` is `NOT NULL` and backfilled from the storage key for
  legacy rows.

---

## 5. The Concepts

### What an API Endpoint Is

- **What it is:** A server URL that accepts an HTTP request (with auth
  session, query params, and a body) and returns a JSON or binary response —
  the contract between the client and the server.
- **Why it is needed:** The browser cannot touch Postgres, R2, or the AI
  providers directly; every interaction (upload, poll, expand, download)
  flows through a route handler on the server.
- **How I implemented it:** Next.js Route Handlers under `src/app/api/`:
  `POST /api/briefs` (batch upload), `GET /api/jobs/[id]` (status poll),
  `POST /api/briefs/[id]/follow-up` (expand), and
  `GET /api/briefs/[id]/export?format=pdf|docx` (download). Auth routes
  (`/api/auth/...`) came from Slice 1 unchanged.
- **What I chose against, and why:** Doing AI work inline in the upload
  request (see "Jobs and Workers"). Also, exposing a raw GraphQL/RPC layer —
  each of these is a single narrow action, so one focused REST endpoint each
  is simpler to secure and reason about.

### SDKs vs Raw HTTP

- **What it is:** Using the provider's official client library instead of
  hand-writing HTTP `fetch` calls against their REST API.
- **Why it is needed:** Providers use their own auth schemes, error shapes,
  streaming, and JSON modes; an official SDK encodes all of that correctly.
- **How I implemented it:** Google's official SDK
  (`@google/generative-ai`) for extraction, including `responseSchema` JSON
  mode. DeepSeek has no dedicated JS SDK, so I used OpenAI's official SDK
  (`openai`) configured with `baseURL: "https://api.deepseek.com"`, since
  DeepSeek's API is OpenAI-compatible — this satisfies the brief's allowance
  to use "a compatible official SDK" where a provider has none of its own.
  DeepSeek's JSON mode is enabled via `response_format: {
  "type": "json_object" }`, which the OpenAI SDK forwards unchanged.
- **What I chose against, and why:** Raw HTTP with `fetch` — an official SDK
  handles request formatting, error types, and transport correctly out of the
  box; hand-rolling HTTP would reintroduce bugs the SDK already solved. I do
  keep the SDK's own *retries* off (`maxRetries: 0`) because our job layer
  owns timeout + retry semantics and would otherwise double hidden work.

### System Prompts vs User Prompts

- **What it is:** The `system` message fixes the model's role and the hard
  output contract; the `user` message carries the per-request data.
- **Why it is needed:** Separating them keeps instructions stable while the
  actual brief/outline data changes every call, and lets the system prompt
  carry the schema contract the model must obey.
- **How I implemented it:** Both system prompts live in
  `src/lib/ai/config.ts` under `aiConfig.prompts` and are sourced verbatim by
  `src/lib/ai/prompts.ts`.

  Extraction system prompt (Gemini):

  > You are a senior freelance design project manager helping a designer turn
  > a raw, messy client brief into a clean project outline.
  >
  > Extract from the brief, and only from the brief, the following. Do not
  > invent details the brief does not contain; when something is missing,
  > record it under openQuestions or assumptions instead of making it up.
  >
  > 1. goals — the concrete outcomes the client wants, as short bullet
  >    phrases.
  > 2. deliverables — the tangible things you will produce for the client,
  >    each with a short name and a one-sentence description of what the
  >    client actually receives.
  > 3. timeline — a realistic phase-by-phase plan. Break the work into
  >    phases, and for each phase give a phase name, a human-readable
  >    duration, start and end labels, the tasks inside that phase, and any
  >    other phases it depends on. Use the brief's own timing when it gives
  >    one; otherwise give your best scoping estimate and flag it under
  >    openQuestions.
  > 4. budgetNotes — any budget figure, range, or constraint the brief
  >    mentions. If the brief gives no budget, say so explicitly.
  > 5. assumptions — what this outline implicitly assumes about the client,
  >    the project, or the work being in scope.
  > 6. openQuestions — anything the brief leaves unanswered that the designer
  >    would need to confirm with the client.
  >
  > Also provide:
  > - projectName — a working title derived from the brief.
  > - summary — a two-to-three sentence plain-language recap of what the
  >   client is asking for.
  >
  > Return only a single JSON object that matches the schema exactly. Do not
  > include markdown, code fences, commentary, or anything outside the JSON
  > object.

  Follow-up system prompt (DeepSeek):

  > You are a senior freelance design strategist producing a polished,
  > client-ready document for a designer's client.
  >
  > You will be given a structured project outline that an AI assistant
  > extracted from a raw client brief. Expand every part of it into a fuller,
  > client-ready version the designer can confidently share back with their
  > client. Keep the same structure; write the content, not a description of
  > the content.
  >
  > Return ONLY a single JSON object that matches the SAME schema as the
  > input outline:
  > - projectName: a working title derived from the brief.
  > - summary: a polished 3-4 sentence plain-language recap.
  > - goals: an array of concrete, outcome-focused statements the client will
  >   recognize.
  > - deliverables: an array of { name, description }, with each description
  >   being 2-3 complete sentences describing exactly what the client
  >   receives.
  > - timeline: an array of phases, each with phase, duration, start, end,
  >   tasks (expanded into clear, specific steps), and dependsOn.
  > - budgetNotes: any budget figure, range, or constraint, stated plainly.
  > - assumptions: what this outline implicitly assumes.
  > - openQuestions: a short list of clarifying questions the designer still
  >   needs answered.
  >
  > Do not add facts, prices, commitments, or scope that is not already
  > present in the outline. You are expanding and clarifying — not inventing.
  > Return only the JSON object, no markdown, no commentary, nothing outside
  > it.

- **What I chose against, and why:** A single giant system prompt that both
  explains the schema *and* changes per request — that would conflate fixed
  rules with variable data and make the model's behavior harder to tune.

### Model Parameters

- **What it is:** The knobs (temperature, token budget, timeout) that shape
  quality, cost, and latency of each model call.
- **Why it is needed:** A one-size-fits-all call would either ramble (high
  temperature on extraction) or read like a template (low temperature on
  prose), and without a timeout a hung provider call would freeze a worker
  forever.
- **How I implemented it:** All values live in `aiConfig.providers`
  (`src/lib/ai/config.ts`):

  - **Gemini extraction:** model `gemini-3.5-flash` (fallback
    `gemini-3.1-flash-lite`), `temperature: 0.1` (deterministic,
    repeatable outlines — same brief, same outline), `maxOutputTokens: 4096`
    (schema is ~1 KB JSON; lots of headroom), `timeoutMs: 60_000` (live
    testing showed flash models occasionally take >30 s under high demand).
  - **DeepSeek follow-up:** model `deepseek-chat`, `temperature: 0.7`
    (client-facing prose benefits from reworded phrasing but stays below
    incoherence), `maxOutputTokens: 2048` (a full expanded brief), `timeoutMs:
    45_000`, SDK retries disabled in favor of our own.
- **What I chose against, and why:** Temperature 0 on extraction (breaks JSON
  repeatability less than you'd think, but adds nothing), letting a model
  stream freely without a `maxOutputTokens` cap (unbounded cost/latency), and
  trusting provider defaults for timeouts (they tend to be much longer than a
  background job should park a worker).

### Structured Output and Schema Validation

- **What it is:** Asking the model to return a machine-readable shape and
  then independently checking that shape before trusting it.
- **Why it is needed:** Free-form prose can't be rendered into the outline
  view or exported; even JSON-mode models occasionally drift out of schema.
- **How I implemented it:** Both roles:
  1. Request a constrained shape — Gemini via `responseSchema`
     (`EXTRACTION_JSON_SCHEMA`), DeepSeek via `response_format:
     {"type":"json_object"}` plus an explicit schema description in the
     prompt.
  2. Validate independently with the Zod `outlineSchema`
     (`src/lib/ai/schema.ts`) before anything is persisted.
  3. On schema failure during extraction, retry once with a strict reminder
     appended ("Return ONLY valid JSON conforming to the schema, no prose, no
     markdown fences"), then mark the job failed with the aggregated failing
     paths. Follow-up output failing validation fails the job with the same
     style of message.
- **What I chose against, and why:** Trusting the provider's schema
  enforcement alone — a provider can still return malformed, partial, or
  null-array JSON, so Zod validation is the actual safety net (it also coerces
  sparse/missing arrays to `[]`).

### Jobs and Workers

- **What it is:** The model of "record the intent, reply to the user, do the
  long work later" — a job row + a background worker that advances it.
- **Why it is needed:** AI calls take seconds to minutes; blocking the request
  on them is a bad user experience and ties up server capacity per request.
- **How I implemented it:** Each upload/follow-up creates a `pending` row and
  replies instantly. `runExtractionJob` / `runFollowUpJob`
  (`src/lib/ai/jobs.ts`) advance the row through `processing` (updating
  `processingStage`) to `done`/`failed`, and the client polls `GET
  /api/jobs/[id]`. `runAITask` (`src/lib/ai/queue.ts`) funnels every provider
  call through the shared concurrency limiter and timeout wrapper.
- **What I chose against, and why:** Processing the AI call synchronously
  inside the upload request — the user would stare at a spinner tied to an
  unpredictable external API, and a slow provider would back up every upload
  request. Also, a full message broker for this slice (see Section 7);
  fire-and-forget in-process workers are the honest local-dev tradeoff.

### Queues, FIFO, and Concurrency Capping

- **What it is:** Bounding how many *external* calls can be in flight at once,
  regardless of how many jobs are queued.
- **Why it is needed:** Uploading many files at once without a cap means
  firing that many simultaneous provider calls, risking cost spikes and
  provider-side throttling (and burning your API quota before jobs finish).
- **How I implemented it:** `p-limit` (`src/lib/ai/queue.ts`) caps concurrent
  provider calls at `aiConfig.concurrency.maxParallelAICalls = 2`. Jobs beyond
  that queue until a slot frees; the concurrency limiter is module-scoped, so
  the cap is global across all jobs, not per request. The provider egress
  rate meters (below) layer on top for the sustained rate.
- **What I chose against, and why:** Rolling my own mutex/queue — `p-limit` is
  a small, battle-tested concurrency primitive. And a per-user concurrency
  pool instead of a global one — the cap exists to protect the shared API
  key, so it must be shared across users.

### Rate Limiting as a Cost Control

- **What it is:** Rejecting requests that exceed a budget — either per user or
  globally per provider.
- **Why it is needed:** Each AI call costs real money per request; without a
  limit, repeatedly triggering the upload or follow-up endpoint translates
  directly into uncontrolled provider spend.
- **How I implemented it:** Two layers (`src/lib/rate-limit.ts` and the AI
  provider layer):

  1. **Ingress, per user** — in-memory token buckets: `briefUpload` 5/min per
     IP+user on `POST /api/briefs`, `followUp` 10/min per IP+user, plus a
     shared per-IP ceiling (40/min) across endpoints.
  2. **Egress, per provider** — process-wide meters (`gemini` 15
     requests/min, `deepseek` 10 requests/min, tuned to the free tiers in
     `aiConfig.rateLimits.providerEgress`). Every outbound call takes a token
     from its provider's bucket before touching the wire
     (`withProviderMeter`); denied calls are treated as transient, backed off
     by the bucket's exact `retryAfter`, and retried — so N users uploading at
     once can never blow the shared API key's quota.
  3. **Provider `Retry-After`** — when a provider still returns 429 with a
     `retry-after` header, the retry delay honours it instead of a fixed
     backoff (`transientRetryDelayMs`).
- **What I chose against, and why:** A per-user-only limit (users are not the
  threat; the shared key's total quota is) — hence the global egress meters.
  Also relying on provider-side limits alone: 429s are throttling *after* the
  fact, and hammering until they appear costs money on the way.

### Why Files Live in Object Storage, Not the Database

- **What it is:** Storing binary uploads in cloud object storage and keeping
  only a pointer in Postgres.
- **Why it is needed:** Databases are optimized for relational queries and
  transactional integrity, not for hosting multi-MB blobs.
- **How I implemented it:** Uploaded bytes go directly to Cloudflare R2 via
  the S3-compatible AWS SDK (`src/lib/ai/storage.ts`, `PutObjectCommand`),
  keyed `briefs/{userId}/{jobId}/{sanitized-name}` so the key is derivable
  from the job row alone. The `Job` row stores only `inputStorageKey`.
- **What I chose against, and why:** Storing the file as binary in Postgres —
  this bloats the database, slows backups and migrations, and isn't what a
  relational DB is built for. Object storage also gives a free path to
  one-object-per-brief cleanup later.

### My Cost Model

- **What it is:** A running estimate of what a "run" costs, so the rate cases
  in place are justified against real money.
- **Why it is needed:** Serverless-scale AI spend is invisible until the bill;
  knowing the per-run cost is what makes "max 2 concurrent calls + 15
  requests/min" mean something concrete.
- **How I implemented it:** Typical numbers for this workload:

  - **Extraction (Gemini flash-class):** input is capped at 40_000 chars ≈
    ~10–12k tokens; output is the ~1 KB outline ≈ ~500–1k tokens. At roughly
    $0.10–0.40 per 1M input and $0.40–2.40 per 1M output tokens for
    flash-class models, one extraction is on the order of **$0.001–0.005**.
    With 15 requests/min and a 5/min per-user ingress cap the worst-case spend
    is a few cents per minute, not dollars.
  - **Follow-up (DeepSeek):** input is the extracted outline (~1–2k tokens);
    output up to `maxOutputTokens: 2048`. DeepSeek-chat tier pricing puts one
    expansion at roughly **$0.001–0.002**.
  - **Caps that bound the total:** `maxTransientRetries: 2` (3 attempts per
    job at most), the global concurrency cap of 2, and the per-provider egress
    meters. I chose not to wire a monthly budget alert since these numbers
    put the realistic ceiling well under a dollar even under sustained use —
    something I'd add if this slice moved toward real users.
- **What I chose against, and why:** Pre-billing or hard-stopping on a token
  counter in this slice — the concurrency + egress + retry caps already bound
  spend tightly, and a false-positive hard-stop (failing a legitimate brief
  because a shared monthly counter tripped) is worse than the risk it guards.

---

## 6. What Went Wrong

**Problem 1 — npm install died with EACCES on the cache folder**

- Symptom: `npm install` failed with `EEXIST`/`EACCES: permission denied,
  mkdir <project>/.npm-cache/_cacache/...` and then `EACCES` against
  `/Users/<user>/.npm/_cacache`.
- Investigation: The first error showed the npm cache had been pointed into
  another project's folder (`.npm-cache` inside "Voice Note to Task App") via
  a stale `npm config set cache`. After resetting it to the default, a second
  error revealed the real cache contained root-owned files.
- Cause: npm had been run with `sudo` at least once, so cache files were owned
  by root — a regular user's npm then couldn't spawn new cache dirs.
- Fix: `npm config rm cache`, then `sudo chown -R 501:20 ~/.npm` to give the
  cache back to the normal user. Permanent rule: **never run `sudo npm`** —
  use a version manager (`nvm`/`fnm`) if global installs need it.

**Problem 2 — every PDF parse failed under Turbopack's dev server**

- Symptom: uploading a `.pdf` brief failed at the extraction stage with a
  pdfjs worker error, while `.txt` and `.docx` worked.
- Investigation: Turbopack rewrites pdfjs-dist's built-in worker URL
  (`new URL("./pdf.worker.mjs", import.meta.url)`) into a `.next/.../chunks/`
  path that doesn't exist at runtime, so the Node "fake worker" couldn't load.
- Cause: The worker loading strategy baked into pdfjs-dist is incompatible
  with Turbopack's module URL rewriting.
- Fix: `resolvePdfWorkerSrc()` (`src/lib/ai/extract.ts`) resolves the real
  `pdf.worker.mjs` file from disk and sets `pdfjs.GlobalWorkerOptions.workerSrc`
  before parsing, sharing the same module instance pdf-parse uses internally.

**Problem 3 — Gemini occasionally returned off-schema output**

- Symptom: A successful 200 response whose JSON failed our schema, or sparse
  output omitting required arrays.
- Investigation: Reproduced the failure across retries; the failures were
  validation-layer, not transport-layer (no 4xx/5xx from the provider).
- Cause: JSON-mode models still drift — missing/`null` array fields sneaked
  through despite `responseSchema`.
- Fix: Zod `outlineSchema` validates before persistence (coercing missing
  arrays to `[]`), extraction retries once with a strict reminder appended,
  and the job fails with the aggregated failing schema paths only after that
  retry — so a bad response never reaches the user as "done".

**Problem 4 — PDF export threw on non-Latin characters**

- Symptom: `GET /api/briefs/[id]/export?format=pdf` returned a 500 render
  error for briefs whose content contained emoji, CJK, or arrows.
- Investigation: The exception pointed into `pdf.save()`.
- Cause: pdf-lib's standard fonts carry only the WinAnsi glyph set; any
  codepoint outside it makes `save()` throw on the whole document.
- Fix: `toWinAnsi()` (`src/lib/ai/export.ts`) maps unknown codepoints to `?`
  before drawing, so a PDF always renders even for non-Latin briefs (the DOCX
  path has full Unicode and needs no such guard).

**Problem 5 — the expanded brief's headline rendered twice**

- Symptom: After a follow-up, the same project title appeared twice on the
  result page.
- Investigation: The expanded output is a second outline of the **same**
  `projectName`, and it was rendered with the same `OutlineView` component the
  initial outline uses — including its big title header.
- Cause: The expanded view reused the full outline renderer instead of just
  the section body, duplicating the headline directly under the initial
  outline that already shows it.
- Fix: `OutlineView` gained a `showHeader` prop; the expanded brief renders
  `showHeader={false}` under its "Expanded brief" label, keeping the sections
  without repeating the headline.

---

## 7. What This Slice Does Not Handle

**Breaks at scale**

- Jobs run as in-process fire-and-forget promises. A restart mid-batch leaves
  jobs stuck in `processing`; 100 concurrent uploads would spawn 100 worker
  calls (provider calls stay capped at 2, but R2 downloads + text extraction
  all run at once, so memory can spike). Two server instances would double the
  worker count and the fire-and-forget fan-out.
- The rate limiter and egress meters are in-memory: they reset on restart and
  are not shared across instances, so a multi-instance deployment would need a
  Redis-backed store behind the `RateLimitStore` interface (which was designed
  from the start as the seam for this).

**Would add before real users**

- A real queue (BullMQ + Redis, or SQS): durable jobs, retries with proper
  backoff, and a dead-letter queue for permanently failed jobs instead of rows
  sitting in `failed`.
- Shared (Redis) rate limiting and provider egress meters across instances.
- A user-triggered "retry this brief" action, and cleanup of R2 objects for
  deleted/expired jobs.
- A monthly budget guard on aggregate provider spend once real users arrive.

**Left out deliberately vs. time**

- Deliberately out of the brief: editing/sharing/collaborative review,
  job history across briefs.
- Time-constrained: pagination or filtering on a jobs list, per-model cost
  telemetry, and a dead-letter queue would have made the job layer
  production-ready, but the fire-and-forget + poll design covers the brief's
  requirement honestly without a message broker.

---

## 8. If I Built This Again

The one thing I'd change is starting with a real durable queue (BullMQ +
Redis) instead of fire-and-forget in-process workers from day one. The
in-process design is honest and simple, but it pushed the complexity elsewhere:
every handler needed a fire-and-forget spawn, the client needed a polling loop
with a stall/resume screen, and a process restart can strand jobs in
`processing` with no worker to ever finish them. A queue would have absorbed
the "keep waiting" resume case entirely, made retries and backoff a
configuration option rather than hand-rolled loops, and (`parentJobId`,
provider/model provenance already in the schema) slid straight into the
existing data model — the cost is just a Redis dependency and a worker process,
which any production version of this system needs anyway.