# PRD: Freelance Client Project Manager

## 1. Product summary

A subscription web app for solo freelance designers. A designer signs up, subscribes on a single paid tier after a 7-day trial, adds clients, and creates projects under each client. For each project, the designer uploads a brief or moodboard (PDF, image, or pasted text). Claude's vision-capable API reads the upload and generates a structured project outline covering scope, deliverables, timeline, and budget notes. Each designer's clients, projects, and outlines are isolated from every other designer's data at the database level.

## 2. Problem statement

Freelance designers receive client briefs in inconsistent formats (PDFs, screenshots, Pinterest-style moodboards, rambling emails). Turning that raw material into a scoped, shareable project outline is manual and repetitive. Designers also juggle client records across email, spreadsheets, and notes apps, with no single system tying a client to their project history. This product removes the manual outline-writing step and gives each designer one private system of record for their clients and projects.

## 3. Goals and non-goals

**Goals**
- Let a designer go from raw brief to structured outline in under 2 minutes of active work.
- Give each designer a private, isolated view of their own clients and projects.
- Convert trial users into paying subscribers through a single clear paid tier.
- Keep the AI generation step reliable enough that most outlines are usable without a full rewrite.

**Non-goals**
- No team or agency accounts in v1. No shared seats, no role-based permissions.
- No client-facing login or portal in v1.
- No native mobile app in v1.
- No support for design-tool links (Figma, Canva) as brief sources in v1.
- No multiple pricing tiers in v1. One paid plan only.

## 4. User personas

**Primary: The established solo designer**
Runs design work as their main income. Has 5 to 15 active clients at a time. Currently tracks clients in a mix of email threads and a spreadsheet. Wants to look organized and respond to new briefs fast. Will pay for a tool that saves them real time on scoping.

**Secondary: The part-time or new freelancer**
Design is a side income or a recent transition. Has 1 to 4 clients. Less confident writing a scope document from scratch. Values the AI outline as a starting template more than as a time-saver, since they have more time than experience.

## 5. Functional requirements

1. A user can create an account with email and password, or with Google OAuth.
2. A user must verify their email address before uploading a brief or starting a trial, if they signed up with email and password.
3. A new account starts a 7-day free trial automatically on first login, with no card required to start the trial.
4. A user must add a valid payment method through Flutterwave before the trial ends to keep access after day 7.
5. A user can create a client record with a name, and optional email, company, and notes fields.
6. A user can create a project under a specific client, with a title and no other required fields at creation.
7. A user can upload up to 10 files per project, each up to 20MB, in PDF, JPG, or PNG format, or paste plain text as a brief.
8. A user can trigger AI outline generation for a project once at least one brief asset (file or pasted text) exists.
9. The system generates an outline containing scope, a deliverables list, a timeline with phases, and budget notes, and stores it as a new version tied to the project.
10. A user can view all past outline versions for a project and see which version is marked current.
11. A user can re-run AI generation on the same project, which creates a new outline version without deleting prior versions.
12. A user can manually edit any field of a generated outline, and the edit is saved as an update to that version, not a new version.
13. A user can manually create an outline from a blank form if AI generation fails or is not wanted.
14. A user can only see, edit, or delete clients, projects, and outlines tied to their own user id. No query path may return another user's records.
15. The system enforces a monthly cap of 50 AI generation calls per account. The 51st call in a billing cycle is blocked with an in-app message and does not consume a retry.
16. A user can see their remaining AI generation count for the current billing cycle from their account settings page.
17. A user can cancel their subscription at any time from account settings, with cancellation taking effect at the end of the current billing period.
18. A user with a canceled or expired subscription can log in, view existing clients and projects in read-only mode, but cannot create new projects, upload new briefs, or trigger new AI generations.
19. A user can delete a client, which cascades to delete all projects, brief assets, and outlines under that client, after a confirmation step.
20. A user can export a single project's current outline as plain text for copying into an email or proposal.
21. A failed AI generation call shows an error message with a retry button and does not consume the user's monthly AI generation count.
22. A failed file upload (wrong format, over size limit) is rejected client-side before it reaches storage, with the specific reason shown to the user.

## 6. AI processing pipeline

**Input**
One or more brief assets tied to a project: PDF files, JPG/PNG images, or a plain text field. All files are already stored in Supabase Storage with a record in the `BriefAsset` table before generation starts.

**Processing steps**
1. User clicks "Generate Outline" on a project page. A server action runs.
2. The server action checks the user's monthly AI generation count against the 50-call cap. If exceeded, it returns an error and stops.
3. The server action fetches all `BriefAsset` rows for the project and downloads each file from Supabase Storage.
4. Images and PDFs are passed to the Claude API as document/image content blocks. Pasted text is passed as a text block. All assets for one project are sent in a single API call.
5. The system prompt instructs Claude to return only a JSON object matching a fixed schema: `scope` (string), `deliverables` (array of strings), `timeline` (array of objects with `phase` and `durationDays`), `budgetNotes` (string).
6. The API response is parsed as JSON. If parsing fails, the system retries the call once with an added instruction to return valid JSON only, no prose.
7. If the second attempt also fails to parse, the generation is marked failed, no outline version is created, and the user sees the retry-or-manual-entry option.
8. On successful parse, the system writes a new `ProjectOutline` row with an incremented `version` number for that project and marks it current.
9. The user's `aiUsageCount` for the current billing cycle is incremented by 1 only on a successful, saved generation.
10. The new outline is returned to the client and rendered in an editable form.

**Output format**
Strict JSON: `{ "scope": string, "deliverables": string[], "timeline": [{ "phase": string, "durationDays": number }], "budgetNotes": string }`. No markdown, no extra keys, no prose outside the JSON object.

**Failure handling**
- Malformed JSON after two attempts: generation marked failed, no version created, no usage count consumed, user sees "We couldn't generate an outline from these files. Try again or build one manually."
- Claude API timeout or 5xx error: single automatic retry after 2 seconds, then surface the same failure message if it repeats.
- Unreadable or corrupted file (e.g. a scanned PDF with no extractable content and no visible text in the rendered image): Claude is instructed to return an empty `deliverables` array and a `scope` value of `"Unable to extract sufficient detail from the uploaded files."` This is treated as a successful call, not a failure, so the user gets a real (if thin) outline they can edit rather than a dead end.

## 7. Technical requirements

- **Frontend:** Next.js 14, App Router, TypeScript in strict mode, Tailwind CSS. All data-mutating actions use server actions, not client-side fetch to custom API routes, except for the Flutterwave webhook receiver.
- **Backend:** Next.js API route dedicated to the Flutterwave webhook endpoint (`/api/webhooks/flutterwave`). All other backend logic lives in server actions colocated with the pages that use them.
- **Database:** PostgreSQL, schema managed with Prisma migrations. No raw SQL outside of Prisma except for the row-level security policies, which are applied through a Prisma migration's raw SQL block since Prisma's schema language does not express RLS policies natively.
- **Data isolation:** Postgres row-level security policies on `Client`, `Project`, `BriefAsset`, and `ProjectOutline` tables, keyed to a `user_id` column, active as a safety net. Every Prisma query in application code includes an explicit `where: { userId: session.user.id }` clause (or a join back to it) as the primary enforcement layer, since Prisma does not set the Postgres session variable RLS depends on automatically. **Assumption:** the app sets the RLS session variable through a Prisma middleware or `$executeRaw SET` call at the start of each request, using the authenticated user's id from the Supabase session.
- **Auth:** Supabase Auth for email/password and Google OAuth. Session tokens validated on every server action through Supabase's server-side client.
- **File storage:** Supabase Storage, one private bucket per environment (`briefs-dev`, `briefs-prod`), with a storage policy restricting access to the uploading user's own files. Signed URLs used for any temporary client-side file access, expiring after 5 minutes.
- **Payments:** Flutterwave subscriptions API for recurring billing, Flutterwave webhook for payment event handling.
- **AI processing:** Anthropic Claude API, vision-capable model, called server-side only. API key stored as a Vercel environment variable, never exposed to the client.
- **Hosting:** Vercel, with separate preview and production environments. Environment variables (database URL, Supabase keys, Flutterwave keys, Claude API key) set per environment in Vercel's dashboard.
- **Rate limiting:** The AI generation server action checks the monthly cap in the database before calling Claude, and rejects the call synchronously if the cap is already reached, rather than relying on Claude API-side limits.

## 8. Business model

| Tier | Price | Billing | Included |
|---|---|---|---|
| Free trial | $0 | 7 days, no card required to start | Full feature access, capped at 5 AI outline generations during the trial |
| Pro | $19/month (USD-equivalent) | Monthly, auto-renews via Flutterwave, card required to continue past trial | Unlimited clients and projects, 50 AI outline generations per month, full version history, plain-text outline export |

**Assumption:** the $19/month price point and the currencies supported at launch (USD, NGN, GBP, KES through Flutterwave's local payment methods) are placeholders pending real pricing research. This is listed under Open Questions.

**Flutterwave integration**
- **Subscription creation:** When a trial user adds a payment method, the app creates a Flutterwave customer and initiates a tokenized card charge through Flutterwave's subscription/payment plan flow, storing the returned `flutterwaveCustomerId` and `flutterwaveSubscriptionId` on the user's `Subscription` record.
- **Webhook events handled:** the app listens on `/api/webhooks/flutterwave` for charge completion events tied to the recurring plan. On each event, the handler verifies the request using the `verif-hash` header against the stored secret, looks up the transaction by `tx_ref`, and records a `Transaction` row.
  - Successful charge: `Subscription.status` set to `active`, `currentPeriodEnd` advanced by one billing cycle.
  - Failed charge: `Subscription.status` set to `past_due`. The user keeps access for a 3-day grace period, then access is downgraded to read-only if the retry also fails.
- **Access effects:** a `past_due` or `expired` subscription status blocks new project creation, new uploads, and new AI generations at the server-action level, independent of what the UI shows, so a stale client-side session cannot bypass the check.
- **Assumption:** exact Flutterwave webhook event names and payload structure should be confirmed against current Flutterwave API documentation at implementation time. This PRD assumes a standard charge-completion webhook model.

## 9. Risks

- **AI output quality:** a generated outline that misreads the brief could damage a designer's credibility with their client if used without review. Mitigated by making every outline editable before use, never auto-sent to clients.
- **AI cost exposure:** vision API calls on large PDFs and images cost more per call than text-only calls. The 50-call monthly cap limits worst-case cost per user but does not eliminate margin risk if usage clusters near the cap.
- **Confidential client material:** uploaded briefs may contain client-confidential or copyrighted content (client logos, proprietary product info). No data processing agreement or content-liability policy is defined yet. This is an unresolved legal risk, listed under Open Questions.
- **Third-party dependency risk:** the product depends on Anthropic, Supabase, and Flutterwave all being available. An outage in any one blocks a core flow (AI generation, auth/storage, or billing respectively).
- **Payment method coverage:** Flutterwave's strength is African payment methods; designers outside Flutterwave's well-supported regions may hit friction paying by card, affecting conversion.
- **Low outline acceptance:** if designers consistently rewrite most of the generated outline, the core value proposition weakens and churn risk rises. This is the reason outline acceptance rate is tracked as a primary success metric.
- **RLS and application-layer isolation drift:** because isolation is enforced both at the Postgres RLS layer and in application code, a bug that only fixes one layer without the other could create a false sense of security. Both layers must be tested independently.

## 10. Data model

| Entity | Key fields | Relationships |
|---|---|---|
| User | id, email, authProvider, fullName, businessName, aiUsageCount, aiUsageResetAt | Has many Client, has many Project, has one Subscription, has many Transaction |
| Client | id, userId, name, email, company, notes | Belongs to User, has many Project |
| Project | id, userId, clientId, title, status | Belongs to User, belongs to Client, has many BriefAsset, has many ProjectOutline |
| BriefAsset | id, projectId, fileUrl, fileType, fileSizeBytes, rawTextContent | Belongs to Project |
| ProjectOutline | id, projectId, version, scope, deliverables, timeline, budgetNotes, generationStatus, aiModelUsed | Belongs to Project |
| Subscription | id, userId, flutterwaveCustomerId, flutterwaveSubscriptionId, planCode, status, trialEndsAt, currentPeriodEnd | Belongs to User (one-to-one) |
| Transaction | id, userId, flutterwaveTxRef, amount, currency, status | Belongs to User |

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id             String    @id @default(uuid())
  email          String    @unique
  passwordHash   String?
  authProvider   String    // "email" | "google"
  fullName       String
  businessName   String?
  aiUsageCount   Int       @default(0)
  aiUsageResetAt DateTime
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  clients        Client[]
  projects       Project[]
  subscription   Subscription?
  transactions   Transaction[]
}

model Client {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  name      String
  email     String?
  company   String?
  notes     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  projects  Project[]

  @@index([userId])
}

model Project {
  id        String            @id @default(uuid())
  userId    String
  user      User              @relation(fields: [userId], references: [id])
  clientId  String
  client    Client            @relation(fields: [clientId], references: [id])
  title     String
  status    String            // "draft" | "outline_generated" | "in_progress" | "completed" | "archived"
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  assets    BriefAsset[]
  outlines  ProjectOutline[]

  @@index([userId])
  @@index([clientId])
}

model BriefAsset {
  id             String   @id @default(uuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id])
  fileUrl        String
  fileType       String   // "pdf" | "jpg" | "png" | "text"
  fileSizeBytes  Int
  rawTextContent String?
  uploadedAt     DateTime @default(now())

  @@index([projectId])
}

model ProjectOutline {
  id               String   @id @default(uuid())
  projectId        String
  project          Project  @relation(fields: [projectId], references: [id])
  version          Int
  scope            String
  deliverables     Json
  timeline         Json
  budgetNotes      String
  generationStatus String   // "success" | "failed" | "manual"
  aiModelUsed      String?
  createdAt        DateTime @default(now())

  @@unique([projectId, version])
  @@index([projectId])
}

model Subscription {
  id                        String    @id @default(uuid())
  userId                    String    @unique
  user                      User      @relation(fields: [userId], references: [id])
  flutterwaveCustomerId     String?
  flutterwaveSubscriptionId String?
  planCode                  String
  status                    String    // "trialing" | "active" | "past_due" | "cancelled" | "expired"
  trialEndsAt               DateTime?
  currentPeriodEnd          DateTime?
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt
}

model Transaction {
  id               String   @id @default(uuid())
  userId           String
  user             User     @relation(fields: [userId], references: [id])
  flutterwaveTxRef String   @unique
  amount           Decimal
  currency         String
  status           String   // "successful" | "failed" | "pending"
  createdAt        DateTime @default(now())

  @@index([userId])
}
```

## 11. Success metrics

| Metric | Definition | Initial 90-day target |
|---|---|---|
| Trial-to-paid conversion rate | Percent of trial signups that add a payment method and reach `active` subscription status before or at trial end | 15% |
| Weekly active designers | Percent of paying users who create or edit at least one client, project, or outline in a given week | 40% |
| Outline acceptance rate | Percent of AI-generated outlines where the user's manual edits change less than 20% of the generated field content, measured by field-level diff | 70% |

**Assumption:** all three target numbers above are placeholder benchmarks, not validated against market data. Flagged under Open Questions.

## 12. Assumptions

- Assumption: the RLS session variable is set per-request through Prisma middleware or a raw `SET` statement, since Prisma does not do this automatically.
- Assumption: passwords are hashed with bcrypt or Argon2 through Supabase Auth's built-in handling, not custom-rolled.
- Assumption: the monthly AI generation cap is set at 50 calls per account for the Pro tier and 5 calls total for the trial period.
- Assumption: failed-generation retries do not consume the user's monthly AI call count; only successfully saved outlines do.
- Assumption: a past-due subscription gets a 3-day grace period before access drops to read-only.
- Assumption: signed URLs for private file access expire after 5 minutes.
- Assumption: the Pro tier is priced at $19/month USD-equivalent, with Flutterwave handling local currency conversion for NGN, GBP, and KES at launch.
- Assumption: success metric targets (15% conversion, 40% weekly active, 70% outline acceptance) are unvalidated starting benchmarks, not researched targets.
- Assumption: Flutterwave webhook event names follow a standard charge-completion pattern; exact payload structure needs confirmation against current Flutterwave docs before implementation.
- Assumption: an unreadable or content-empty brief upload still produces a "successful" but thin outline rather than a hard failure, so the user is never left with nothing to edit.

## 13. Phased roadmap

**Phase 1: MVP (weeks 1 to 6)**
Auth (email/password, Google OAuth), client CRUD, project CRUD, file upload to Supabase Storage, single-call AI outline generation with the fixed JSON schema, manual outline editing, RLS and application-layer data isolation, Flutterwave trial-to-paid flow for a single tier.

**Phase 2: Retention and reliability (weeks 7 to 10)**
Outline version history, plain-text export, AI generation failure handling and retry logic, monthly usage cap enforcement and display, past-due and grace-period billing states, basic account settings page.

**Phase 3: Growth (weeks 11 to 16)**
Outline acceptance rate tracking (field-level diff measurement), in-app usage analytics dashboard for the designer, support for additional currencies on Flutterwave, evaluation of demand for a client-facing read-only outline link.

## 14. Open questions

1. What happens to a designer's data after they cancel their subscription: how long is it retained before deletion, and is deletion automatic or on request.
2. How is confidential or copyrighted client material in uploaded briefs handled legally: does the product need a data processing agreement, a content liability clause in the terms of service, or both.
3. What is the actual subscription price and which currencies should be supported at launch, beyond the placeholder $19/month assumption used in this PRD.
4. What are the real target numbers for trial-to-paid conversion, weekly active designers, and outline acceptance rate, based on market research rather than the placeholder benchmarks used in this PRD.
