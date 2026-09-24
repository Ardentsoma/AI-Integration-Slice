import "server-only";

import { SchemaType, type Schema } from "@google/generative-ai";
import { aiConfig } from "./config";

/**
 * Typed adapters over the AI role prompts. Every tunable string (system
 * prompts, action instructions) now lives in aiConfig.prompts in
 * lib/ai/config.ts — edit them there. This file exists to add the Gemini
 * JSON-mode schema, which is a structural contract (not a tunable value)
 * and must stay in sync with the Zod schema in lib/ai/schema.ts.
 */

// --- Role 1: Extraction (Gemini) -------------------------------------------
// Prompt text is aiConfig.prompts.extractionSystemPrompt. The schema below
// mirrors outlineSchema in lib/ai/schema.ts; used as
// generationConfig.responseSchema so the provider constrains its output
// shape, with our own Zod validation running as the second gate on top.
export const EXTRACTION_SYSTEM_PROMPT: string =
  aiConfig.prompts.extractionSystemPrompt;

export const EXTRACTION_JSON_SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    projectName: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    goals: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    deliverables: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
        },
        required: ["name", "description"],
      },
    },
    timeline: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          phase: { type: SchemaType.STRING },
          duration: { type: SchemaType.STRING },
          start: { type: SchemaType.STRING },
          end: { type: SchemaType.STRING },
          tasks: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          dependsOn: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["phase", "duration", "start", "end", "tasks"],
      },
    },
    budgetNotes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    assumptions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    openQuestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: [
    "projectName",
    "summary",
    "goals",
    "deliverables",
    "timeline",
    "budgetNotes",
    "assumptions",
    "openQuestions",
  ],
};

// --- Role 2: Follow-up action (DeepSeek) ------------------------------------
// Prompt text is aiConfig.prompts.followUpSystemPrompt; the instructions map
// is aiConfig.prompts.followUpActionInstructions.
export const FOLLOW_UP_SYSTEM_PROMPT: string = aiConfig.prompts.followUpSystemPrompt;

// Natural-language instructions for the one supported action, substituted
// into the user turn. Keyed by the `action` field in the API payload.
export const FOLLOW_UP_ACTION_INSTRUCTIONS: Record<string, string> =
  aiConfig.prompts.followUpActionInstructions;