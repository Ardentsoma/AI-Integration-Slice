import "server-only";

import { prisma } from "@/lib/prisma";
import { aiConfig } from "./config";
import { extractTextFromBuffer, UnsupportedFileError } from "./extract";
import { getBriefFile, StorageNotConfiguredError } from "./storage";
import {
  extractOutlineFromBrief,
  InvalidResponseError,
  ProviderNotConfiguredError,
  runFollowUpAction,
} from "./providers";
import { AiTimeoutError } from "./queue";
import { type Outline } from "./schema";

/**
 * Background job processors. These run after the upload/follow-up API routes
 * have already replied to the user; each moves its job through pending ->
 * processing -> done/failed and updates the row as it goes, so the client can
 * poll an honest, granular state.
 *
 * Tradeoff note: in this dev setup the processors run fire-and-forget in the
 * same Node process, which is fine for a local single instance. In production
 * this is where a queue worker (BullMQ/SQS/etc.) would be wired in so long AI
 * work survives restarts and scales horizontally.
 */

/** Only transitions to failed from a non-terminal status, so a slow retry can
 * never stomp over a job that just succeeded. */
async function markJobFailed(jobId: string, message: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, status: { in: ["pending", "processing"] } },
    data: {
      status: "failed",
      errorMessage: message,
      processingStage: null,
      finishedAt: new Date(),
    },
  });
}

/** Maps any thrown error to a clear, user-facing failure reason. Provider
 * SDK errors sometimes carry raw status blobs, so recognisable transport
 * failures are normalised to plain language first. */
export function messageFromError(err: unknown): string {
  if (err instanceof AiTimeoutError) return err.message;
  if (err instanceof InvalidResponseError) return err.message;
  if (err instanceof ProviderNotConfiguredError) return err.message;
  if (err instanceof StorageNotConfiguredError) return err.message;
  if (err instanceof UnsupportedFileError) return err.message;

  if (err instanceof Error) {
    const name = err.name;
    // Undici/Node use these names for aborted or deadline-exceeded requests.
    if (name === "AbortError" || name === "TimeoutError") {
      return "The AI provider timed out. Please try again.";
    }
    if (name === "TypeError" && /fetch/i.test(err.message)) {
      return "A network error occurred while contacting the AI provider.";
    }
    return err.message;
  }
  return "An unexpected error occurred while processing the brief.";
}

/** Role 1 job: download the brief from R2, push it through Gemini's JSON-mode
 * extraction, validate with Zod, retry once on schema drift, persist. */
export async function runExtractionJob(jobId: string): Promise<void> {
  let attempts = 0;
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    // Guard against double-processing: only untouched pending rows run.
    if (!job || job.status !== "pending") return;

    attempts = 1;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "processing",
        processingStage: "downloading-file",
        startedAt: new Date(),
        attempts,
      },
    });

    const file = await getBriefFile(job.inputStorageKey);
    await prisma.job.update({
      where: { id: jobId },
      data: { processingStage: "extracting-text" },
    });
    const originalName =
      job.originalFileName || job.inputStorageKey.split("/").pop() || "brief";
    const text = (await extractTextFromBuffer(file.buffer, originalName)).trim();

    if (text.length < aiConfig.upload.minBriefChars) {
      throw new InvalidResponseError(
        `The uploaded brief contained no readable text${text.length > 0 ? ` (only ${text.length} characters)` : ""}. Upload a .txt, .pdf, or .docx that actually contains the brief.`
      );
    }

    // Cap what reaches the model so an enormous PDF can't overflow context.
    const briefText = text.slice(0, aiConfig.upload.maxBriefChars);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        processingStage: "calling-provider",
        charactersExtracted: briefText.length,
      },
    });

    let outline: Outline | null = null;
    let usedModel: string | null = null;
    for (
      let attempt = 1;
      attempt <= aiConfig.extraction.maxRetries + 1;
      attempt += 1
    ) {
      attempts = attempt;
      await prisma.job.update({ where: { id: jobId }, data: { attempts } });
      try {
        const extracted = await extractOutlineFromBrief(briefText, {
          strict: attempt > 1,
        });
        outline = extracted.outline;
        usedModel = extracted.model;
        break;
      } catch (err) {
        // Schemma drift → retry once with the strict reminder appended; other
        // errors (timeout/provider) surface immediately as honest failures.
        if (
          err instanceof InvalidResponseError &&
          attempt <= aiConfig.extraction.maxRetries
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!outline) {
      throw new InvalidResponseError(
        "The extraction could not be parsed into a valid outline after retrying."
      );
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "done",
        resultJson: JSON.stringify(outline),
        attempts,
        provider: "gemini",
        model: usedModel,
        processingStage: null,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await markJobFailed(jobId, messageFromError(err));
  }
}

/** Role 2 job: apply one user-triggered action (e.g. "expand") to a finished
 * outline via DeepSeek, storing the expanded result in resultJson as the same
 * structured Outline as extraction. */
export async function runFollowUpJob(
  jobId: string,
  outline: Outline,
  action: string
): Promise<void> {
  let attempts = 0;
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "pending") return;

    attempts = 1;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "processing",
        processingStage: "calling-provider",
        startedAt: new Date(),
        attempts,
      },
    });

    let expanded: Outline | null = null;
    let usedModel: string | null = null;
    for (
      let attempt = 1;
      attempt <= aiConfig.followUp.maxRetries + 1;
      attempt += 1
    ) {
      attempts = attempt;
      await prisma.job.update({ where: { id: jobId }, data: { attempts } });
      try {
        const result = await runFollowUpAction(outline, action, {
          strict: attempt > 1,
        });
        expanded = result.outline;
        usedModel = result.model;
        break;
      } catch (err) {
        // Schema drift -> retry once with the strict reminder appended; other
        // errors (timeout/provider) surface immediately as honest failures.
        if (
          err instanceof InvalidResponseError &&
          attempt <= aiConfig.followUp.maxRetries
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!expanded) {
      throw new InvalidResponseError(
        "The expanded brief could not be parsed into a valid outline after retrying."
      );
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "done",
        resultJson: JSON.stringify(expanded),
        attempts,
        provider: "deepseek",
        model: usedModel,
        processingStage: null,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    await markJobFailed(jobId, messageFromError(err));
  }
}