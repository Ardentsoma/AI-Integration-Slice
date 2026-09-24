import "server-only";

import { z } from "zod";

/**
 * Structural validation for AI output. We never trust the provider's own
 * schema enforcement blindly — every extraction/follow-up response is parsed
 * against these schemas in our own code before anything is persisted.
 */

// Gemini JSON-mode top-level covers nulls/skip for empty arrays, but sparse
// JSON occasionally omits or nulls an array field; coerce those to [] so a
// missing-but-optional section doesn't fail the whole outline.
const jsonArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(item)
  );

export const deliverableSchema = z.object({
  // Short name for the deliverable ("Brand identity", "Launch site").
  name: z.string().min(1, "Deliverable name is empty."),
  // What the client actually gets, in enough detail to scope it.
  description: z.string().min(1, "Deliverable description is empty."),
});

export const timelineItemSchema = z.object({
  // Label for this chunk of work ("Discovery", "Design").
  phase: z.string().min(1, "Timeline phase is empty."),
  // Human-readable length ("2 weeks"); free text because briefs describe
  // time loosely and exact dates are rarely known at scoping time.
  duration: z.string().min(1, "Timeline duration is empty."),
  // Start marker — used when the brief gives relative timing ("Week 1").
  start: z.string().min(1, "Timeline start is empty."),
  // End marker for the phase, consistent with `start`.
  end: z.string().min(1, "Timeline end is empty."),
  // Concrete things done inside this phase.
  tasks: jsonArray(z.string().min(1)).describe("Work items in this phase"),
  // Other phases this one waits on ("definitions" etc.) — may be empty.
  dependsOn: jsonArray(z.string().min(1)).describe("Phase dependencies"),
});

export const outlineSchema = z.object({
  // Working title for the project, derived from the brief.
  projectName: z.string().min(1, "projectName is empty."),
  // 2-3 sentence plain-language recap of what the client is asking for.
  summary: z.string().min(1, "summary is empty."),
  // Top-level outcomes the designer is being hired to achieve.
  goals: jsonArray(z.string().min(1)).describe("Project goals"),
  // Concrete things delivered to the client.
  deliverables: jsonArray(deliverableSchema).describe("Deliverables"),
  // Ordered phases with timing so the timeline can be shown top-to-bottom.
  timeline: jsonArray(timelineItemSchema).describe("Project timeline"),
  // Budget figures/limits mentioned in the brief; empty when the client
  // gave none or the brief says "unknown".
  budgetNotes: jsonArray(z.string().min(1)).describe("Budget notes"),
  // Things the outline assumes to be true (implied by the brief's gaps);
  // surfaced so the designer can confirm them with the client.
  assumptions: jsonArray(z.string().min(1)).describe("Assumptions"),
  // Questions the outline couldn't answer fully from the brief alone.
  openQuestions: jsonArray(z.string().min(1)).describe("Open questions"),
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