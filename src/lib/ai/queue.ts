import "server-only";

import pLimit from "p-limit";
import { aiConfig } from "./config";

/**
 * Module-wide concurrency gate for every provider network call. Whatever
 * number of briefs are uploaded at once, only aiConfig.concurrency
 * .maxParallelAICalls rise at a time; the rest queue on the p-limit promise
 * and run as earlier calls finish. The limiter is module-scoped, so the cap
 * applies across all jobs, not per request.
 */
const limit = pLimit(aiConfig.concurrency.maxParallelAICalls);

/** Runs a provider call through the shared concurrency limiter. */
export function runAITask<T>(task: () => Promise<T>): Promise<T> {
  return limit(task);
}

/** Error thrown when a provider call exceeded its configured timeout. */
export class AiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTimeoutError";
  }
}

/**
 * Guarantees a promise settles within `ms`, regardless of whether the
 * underlying SDK obeys an abort signal. The provider call is kept alive
 * (harmless, it just keeps retrying the timeout'd request) but the caller
 * sees a deterministic AiTimeoutError.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiTimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}