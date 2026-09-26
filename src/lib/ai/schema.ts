import "server-only";

import { z } from "zod";

/**
 * Structural validation for AI output. We never trust the provider's own
 * schema enforcement blindly — every extraction/follow-up response is parsed
 * against these schemas in our own code before anything is persisted.
 *
 * Only Gemini is called with a provider-side responseSchema. DeepSeek is
 * called with json_object mode, which guarantees valid JSON and nothing more,
 * so every field below normalizes the shapes models actually return for a
 * schema described in prose: a bare string where an array was asked for, a
 * number where a duration label was expected, a null section. One loose
 * section should never throw away an otherwise complete outline.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Models routinely answer a "how long?" field with a bare number ("2", meaning
// two weeks). Keep the value as text instead of discarding the whole outline.
const coerceText = (value: unknown): unknown => {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value;
};

// A required, non-blank string that tolerates the model answering with a
// scalar. The caller's message is what a user sees on a genuinely blank field.
const text = (message: string) => z.preprocess(coerceText, z.string().min(1, message));

// Read first when an object has to be flattened into a sentence, because a
// prose field is what the UI should show.
const PROSE_KEYS = ["note", "notes", "text", "value", "detail", "description", "summary"];

const nonEmpty = (values: string[]): string[] =>
  values.map((value) => value.trim()).filter((value) => value.length > 0);

/** Normalizes anything a model can plausibly return for "array of strings"
 * into a real string[]: a bare scalar, an object, a nested list, or a list
 * carrying blank/empty entries. */
function toStringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return nonEmpty([value]);
  if (typeof value === "number" || typeof value === "boolean") {
    return nonEmpty([String(value)]);
  }
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (isPlainObject(value)) {
    for (const key of PROSE_KEYS) {
      const prose = value[key];
      if (typeof prose === "string" && prose.trim()) return nonEmpty([prose]);
    }
    // e.g. { total: 5000, currency: "USD" } -> "total: 5000, currency: USD",
    // which reads as a note; a raw JSON dump would not.
    const pairs = Object.entries(value).filter(
      ([, entry]) => typeof entry === "string" || typeof entry === "number"
    );
    if (pairs.length > 0) {
      return nonEmpty(pairs.map(([key, entry]) => `${key}: ${entry}`));
    }
    return nonEmpty([JSON.stringify(value)]);
  }
  return [];
}

// A "list of strings" section. Omitted/null means the section is empty, and
// loose shapes are flattened rather than failing the outline.
const stringList = z.preprocess(toStringList, z.array(z.string().min(1)));

// A list of structured items: an omitted/null section is empty, and blank
// holes are dropped so one null entry can't fail a good list.
const itemList = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return [];
      if (!Array.isArray(value)) return value;
      return value.filter((entry) => entry !== null && entry !== undefined);
    },
    z.array(item)
  );

export const deliverableSchema = z.object({
  // Short name for the deliverable ("Brand identity", "Launch site").
  name: text("Deliverable name is empty."),
  // What the client actually gets, in enough detail to scope it.
  description: text("Deliverable description is empty."),
});

export const timelineItemSchema = z.object({
  // Label for this chunk of work ("Discovery", "Design").
  phase: text("Timeline phase is empty."),
  // Human-readable length ("2 weeks"); free text because briefs describe
  // time loosely and exact dates are rarely known at scoping time.
  duration: text("Timeline duration is empty."),
  // Start marker — used when the brief gives relative timing ("Week 1").
  start: text("Timeline start is empty."),
  // End marker for the phase, consistent with `start`.
  end: text("Timeline end is empty."),
  // Concrete things done inside this phase.
  tasks: stringList.describe("Work items in this phase"),
  // Other phases this one waits on ("definitions" etc.) — may be empty.
  dependsOn: stringList.describe("Phase dependencies"),
});

export const outlineSchema = z.object({
  // Working title for the project, derived from the brief.
  projectName: text("projectName is empty."),
  // 2-3 sentence plain-language recap of what the client is asking for.
  summary: text("summary is empty."),
  // Top-level outcomes the designer is being hired to achieve.
  goals: stringList.describe("Project goals"),
  // Concrete things delivered to the client.
  deliverables: itemList(deliverableSchema).describe("Deliverables"),
  // Ordered phases with timing so the timeline can be shown top-to-bottom.
  timeline: itemList(timelineItemSchema).describe("Project timeline"),
  // Budget figures/limits mentioned in the brief; empty when the client
  // gave none or the brief says "unknown".
  budgetNotes: stringList.describe("Budget notes"),
  // Things the outline assumes to be true (implied by the brief's gaps);
  // surfaced so the designer can confirm them with the client.
  assumptions: stringList.describe("Assumptions"),
  // Questions the outline couldn't answer fully from the brief alone.
  openQuestions: stringList.describe("Open questions"),
});

export type Outline = z.infer<typeof outlineSchema>;
export type Deliverable = z.infer<typeof deliverableSchema>;

/** Casts an unknown extracted value into a validated Outline (or null). */
export function parseOutline(value: unknown): Outline | null {
  const result = outlineSchema.safeParse(value);
  return result.success ? result.data : null;
}

// --- API request payloads -------------------------------------------------

export const followUpActionSchema = z.object({
  // The extraction job this follow-up is expanding on. Must belong to the
  // requesting user and already be "done".
  jobId: z.string().min(1, "jobId is required.").describe("Source job id"),
  // The one supported action today; kept as a literal so adding actions
  // later is a one-line change, not a new endpoint.
  action: z.literal("expand").default("expand").describe("Follow-up action"),
});

export type FollowUpActionInput = z.infer<typeof followUpActionSchema>;

/** Follow-up responses are prose, so the only structural requirement is
 * that DeepSeek actually returned readable text. */
export function isValidFollowUpContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}