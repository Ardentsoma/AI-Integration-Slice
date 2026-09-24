"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// --- Client mirror of the server outline schema (lib/ai/schema.ts). Kept
// here so the view never imports the server-only module; the API returns
// already-parsed JSON that we render structurally. ---
interface Outline {
  projectName: string;
  summary: string;
  goals: string[];
  deliverables: { name: string; description: string }[];
  timeline: {
    phase: string;
    duration: string;
    start: string;
    end: string;
    tasks: string[];
    dependsOn?: string[];
  }[];
  budgetNotes: string[];
  assumptions: string[];
  openQuestions: string[];
}

interface JobView {
  id: string;
  type: "extraction" | "follow-up";
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  errorMessage: string | null;
  resultJson: unknown;
  createdAt: string;
  updatedAt: string;
}

/** One uploaded brief: its extraction result plus any expanded (follow-up)
 * result. A batch upload creates one of these per file. */
interface BriefResult {
  jobId: string;
  outline: Outline | null;
  failed: boolean;
  errorMessage: string | null;
  expanded: Outline | null;
  expandedJobId: string | null;
  expandedPending: boolean;
  expandedError: string | null;
}

/** A job the poll loop is currently watching. Extraction watches key the
 * BriefResult by jobId; follow-up watches key their parent by parentId. */
interface Watch {
  jobId: string;
  parentId?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".txt", ".pdf", ".docx"];
const POLL_INTERVAL_MS = 1500;
const POLL_GIVE_UP_MS = 2 * 60 * 1000;

type Stage =
  | "upload"
  | "uploading"
  | "processing"
  | "result"
  | "stalled"
  | "failed";

function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return "Only .txt, .pdf, or .docx files are accepted.";
  }
  if (file.size > MAX_BYTES) {
    return "File is too large. Max size is 5 MB.";
  }
  return null;
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-neutral-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-100 border-t-red-500" />
      {label}
    </div>
  );
}

function OutlineView({
  outline,
  showHeader = true,
}: {
  outline: Outline;
  showHeader?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {showHeader && (
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-red-500">
            Project outline
          </p>
          <h2 className="mt-1 font-display text-2xl tracking-tight text-neutral-500">
            {outline.projectName}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            {outline.summary}
          </p>
        </div>
      )}

      <Section title="Goals">
        <ul className="space-y-2">
          {outline.goals.map((goal, i) => (
            <li key={i} className="flex gap-2 text-sm text-neutral-400">
              <span className="text-red-500">–</span>
              <span>{goal}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Deliverables">
        <ul className="space-y-4">
          {outline.deliverables.map((d, i) => (
            <li key={i}>
              <p className="text-sm font-bold text-neutral-500">{d.name}</p>
              <p className="text-sm leading-relaxed text-neutral-400">
                {d.description}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Timeline">
        <ol className="space-y-5">
          {outline.timeline.map((phase, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-500 font-mono text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                {i < outline.timeline.length - 1 && (
                  <span className="mt-1 h-full w-px bg-neutral-100" />
                )}
              </div>
              <div className="flex-1 pb-5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-sm font-bold text-neutral-500">
                    {phase.phase}
                  </p>
                  <p className="text-xs font-mono text-neutral-300">
                    {phase.duration}
                  </p>
                </div>
                <p className="text-xs font-mono text-neutral-300">
                  {phase.start} → {phase.end}
                </p>
                {phase.tasks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {phase.tasks.map((task, j) => (
                      <li key={j} className="flex gap-2 text-sm text-neutral-400">
                        <span className="text-red-500">–</span>
                        <span>{task}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Budget notes">
        {outline.budgetNotes.length > 0 ? (
          <ul className="space-y-2">
            {outline.budgetNotes.map((note, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-400">
                <span className="text-red-500">–</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-300">No budget information given.</p>
        )}
      </Section>

      <Section title="Assumptions">
        {outline.assumptions.length > 0 ? (
          <ul className="space-y-2">
            {outline.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-400">
                <span className="text-red-500">–</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-300">None recorded.</p>
        )}
      </Section>

      <Section title="Open questions">
        {outline.openQuestions.length > 0 ? (
          <ul className="space-y-2">
            {outline.openQuestions.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-400">
                <span className="text-red-500">?</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-300">None outstanding.</p>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="border-b border-neutral-100 pb-2 text-xs font-mono uppercase tracking-[0.2em] text-neutral-300">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function downloadButtonClass(): string {
  return "cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-300 transition-colors hover:bg-neutral-50";
}

/** One uploaded brief in the batch result: its outline, downloads, the expand
 * action, and its expanded brief + its downloads. Failed briefs render an
 * honest error card instead. */
function BriefResultCard({
  brief,
  onExpand,
}: {
  brief: BriefResult;
  onExpand: (brief: BriefResult) => void;
}) {
  if (brief.failed) {
    return (
      <div className="rounded-lg border border-red-100 bg-red-50 p-5">
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-red-500">
          Failed
        </p>
        <p className="mt-2 text-sm leading-relaxed text-red-400">
          {brief.errorMessage ??
            "Something went wrong processing this brief."}
        </p>
      </div>
    );
  }

  if (!brief.outline) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-neutral-100 bg-neutral-50 p-8">
        <Spinner label="Processing…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-neutral-100 bg-white p-6 shadow-[0_10px_30px_rgba(10,18,42,0.06)]">
      <OutlineView outline={brief.outline} />

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-5">
        <span className="text-sm text-neutral-500">Download:</span>
        <a
          href={`/api/briefs/${brief.jobId}/export?format=pdf`}
          download
          className={downloadButtonClass()}
        >
          PDF
        </a>
        <a
          href={`/api/briefs/${brief.jobId}/export?format=docx`}
          download
          className={downloadButtonClass()}
        >
          DOCX
        </a>
      </div>

      <div>
        {brief.expandedPending ? (
          <div className="flex items-center justify-center py-6">
            <Spinner label="Expanding this brief into a client-ready document…" />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <button
              type="button"
              onClick={() => onExpand(brief)}
              disabled={brief.expandedPending}
              className="cursor-pointer rounded-md bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Expand this brief
            </button>
            <p className="text-xs text-neutral-300">
              Generates a fuller, client-ready brief from this outline.
            </p>
            {brief.expandedError && (
              <p className="text-sm text-red-500" role="alert">
                {brief.expandedError}
              </p>
            )}
          </div>
        )}
      </div>

      {brief.expanded && (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-6">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-red-500">
            Expanded brief
          </p>
          <div className="mt-4">
            <OutlineView outline={brief.expanded} showHeader={false} />
          </div>
          {brief.expandedJobId && (
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-5">
              <span className="text-sm text-neutral-500">
                Download expanded:
              </span>
              <a
                href={`/api/briefs/${brief.expandedJobId}/export?format=pdf`}
                download
                className={downloadButtonClass()}
              >
                PDF
              </a>
              <a
                href={`/api/briefs/${brief.expandedJobId}/export?format=docx`}
                download
                className={downloadButtonClass()}
              >
                DOCX
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BriefsApp() {
  const [stage, setStage] = useState<Stage>("upload");
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<BriefResult[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror of briefs for the poll loop's final settle check (the loop closes
  // over it but re-renders keep it fresh between awaits).
  const briefsRef = useRef<BriefResult[]>(briefs);
  useEffect(() => {
    briefsRef.current = briefs;
  }, [briefs]);

  const pollRef = useRef<{
    active: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    active: false,
    timer: null,
  });
  // Jobs currently being polled: extraction watches for a fresh batch and
  // follow-up watches as the user expands items. Source of truth for resume
  // after a stall.
  const watchesRef = useRef<Watch[]>([]);

  const stopPolling = useCallback(() => {
    const state = pollRef.current;
    state.active = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }, []);

  const fail = useCallback(
    (message: string) => {
      stopPolling();
      setServerError(message);
      setStage("failed");
    },
    [stopPolling]
  );

  /** Applies one resolved job to its BriefResult: extraction jobs fill
   * `outline`/`failed`, follow-up jobs fill `expanded`. */
  const applyWatchResult = useCallback((job: JobView, watch: Watch) => {
    if (watch.parentId) {
      setBriefs((prev) =>
        prev.map((b) => {
          if (b.jobId !== watch.parentId) return b;
          if (job.status === "done") {
            const parsed = job.resultJson as Outline | null;
            if (!parsed?.projectName) {
              return {
                ...b,
                expandedPending: false,
                expandedError:
                  "The expanded brief came back unreadable. Please try again.",
              };
            }
            return {
              ...b,
              expanded: parsed,
              expandedJobId: job.id,
              expandedPending: false,
              expandedError: null,
            };
          }
          return {
            ...b,
            expandedPending: false,
            expandedError:
              job.errorMessage ?? "The expanded brief failed. Please try again.",
          };
        })
      );
      return;
    }
    setBriefs((prev) =>
      prev.map((b) => {
        if (b.jobId !== watch.jobId) return b;
        if (job.status === "done") {
          const parsed = job.resultJson as Outline | null;
          if (!parsed?.projectName) {
            return {
              ...b,
              failed: true,
              errorMessage: job.errorMessage ?? "The outline came back unreadable.",
            };
          }
          return { ...b, outline: parsed };
        }
        return {
          ...b,
          failed: true,
          errorMessage: job.errorMessage ?? "The job failed for an unknown reason.",
        };
      })
    );
  }, []);

  /** Records a watch failure that happened before any job payload existed
   * (e.g. the job was deleted: HTTP 404). */
  const markWatchFailed = useCallback((watch: Watch, message: string) => {
    setBriefs((prev) =>
      prev.map((b) => {
        if (watch.parentId) {
          if (b.jobId !== watch.parentId) return b;
          return { ...b, expandedPending: false, expandedError: message };
        }
        if (b.jobId !== watch.jobId) return b;
        return { ...b, failed: true, errorMessage: message };
      })
    );
  }, []);

  const removeWatch = useCallback((watch: Watch) => {
    watchesRef.current = watchesRef.current.filter(
      (w) => w.jobId !== watch.jobId
    );
  }, []);

  /** Polls every active watch in one loop, replacing the old single-job
   * loop. When the last watch settles it picks the final stage. */
  const pollLoop = useCallback(
    async (startedAt: number) => {
      const deadline = startedAt + POLL_GIVE_UP_MS;
      const pending = new Set(watchesRef.current.map((w) => w.jobId));

      while (pollRef.current.active) {
        for (const jobId of [...pending]) {
          try {
            const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
            if (res.ok) {
              const job = (await res.json()) as JobView;
              if (job.status === "done" || job.status === "failed") {
                const watch = watchesRef.current.find((w) => w.jobId === jobId);
                if (watch) {
                  applyWatchResult(job, watch);
                  removeWatch(watch);
                }
                pending.delete(jobId);
              }
            } else if (res.status === 404) {
              const watch = watchesRef.current.find((w) => w.jobId === jobId);
              if (watch) {
                markWatchFailed(watch, "That job no longer exists.");
                removeWatch(watch);
              }
              pending.delete(jobId);
            }
            // Any other non-OK/network error is transient — keep polling.
          } catch {
            // Network blip; keep polling rather than failing the user.
          }
        }

        if (pending.size === 0 || !pollRef.current.active) break;

        setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));

        if (Date.now() > deadline) {
          stopPolling();
          setStage("stalled");
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!pollRef.current.active) return;
      stopPolling();

      const current = briefsRef.current;
      if (current.length > 0 && current.every((b) => b.failed)) {
        setServerError(
          current
            .map((b) => b.errorMessage)
            .filter(Boolean)
            .join(" ") || "All briefs failed."
        );
        setStage("failed");
      } else {
        setStage("result");
      }
    },
    [applyWatchResult, markWatchFailed, removeWatch, stopPolling]
  );

  /** Starts (or restarts) polling the current watch list. Watches are read
   * from the ref, so batch uploads and per-item expands both work. */
  const startPolling = useCallback(() => {
    stopPolling();
    setElapsedSeconds(0);
    pollRef.current.active = true;
    void pollLoop(Date.now());
  }, [pollLoop, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const resolvedCount = briefs.filter((b) => b.outline || b.failed).length;

  /** Batch upload: validate every file, POST them all as one request, then
   * watch every returned job id. */
  const handleFiles = useCallback(
    async (fileList: FileList | undefined) => {
      const files = fileList ? Array.from(fileList) : [];
      if (files.length === 0) return;

      const problems: string[] = [];
      for (const file of files) {
        const problem = validateFile(file);
        if (problem) problems.push(`${file.name}: ${problem}`);
      }
      if (problems.length) {
        setFileError(problems.join(" "));
        return;
      }

      setFileError(null);
      setServerError(null);
      setStage("uploading");

      const form = new FormData();
      for (const file of files) form.append("file", file);

      try {
        const res = await fetch("/api/briefs", { method: "POST", body: form });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          fail(
            (payload as { error?: string } | null)?.error ??
              "Upload failed. Please try again."
          );
          return;
        }
        const payload = (await res.json()) as { jobIds: string[] };
        setBriefs(
          payload.jobIds.map((jobId) => ({
            jobId,
            outline: null,
            failed: false,
            errorMessage: null,
            expanded: null,
            expandedJobId: null,
            expandedPending: false,
            expandedError: null,
          }))
        );
        watchesRef.current = payload.jobIds.map((jobId) => ({ jobId }));
        setStage("processing");
        startPolling();
      } catch {
        fail("Upload failed — check your connection and try again.");
      }
    },
    [fail, startPolling]
  );

  const handleFollowUp = useCallback(
    async (brief: BriefResult) => {
      if (!brief.outline) return;
      setServerError(null);
      setBriefs((prev) =>
        prev.map((b) =>
          b.jobId === brief.jobId
            ? {
                ...b,
                expandedPending: true,
                expanded: null,
                expandedJobId: null,
                expandedError: null,
              }
            : b
        )
      );

      try {
        const res = await fetch(`/api/briefs/${brief.jobId}/follow-up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "expand" }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          setBriefs((prev) =>
            prev.map((b) =>
              b.jobId === brief.jobId
                ? {
                    ...b,
                    expandedPending: false,
                    expandedError:
                      (payload as { error?: string } | null)?.error ??
                      "Could not start the follow-up. Please try again.",
                  }
                : b
            )
          );
          return;
        }
        const payload = (await res.json()) as { jobId: string };
        // Watch this follow-up against its parent brief so the loop knows
        // which expanded slot to fill when it resolves.
        watchesRef.current.push({ jobId: payload.jobId, parentId: brief.jobId });
        setStage("result");
        startPolling();
      } catch {
        setBriefs((prev) =>
          prev.map((b) =>
            b.jobId === brief.jobId
              ? {
                  ...b,
                  expandedPending: false,
                  expandedError:
                    "Could not reach the server. Check your connection and try again.",
                }
              : b
          )
        );
      }
    },
    [startPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    watchesRef.current = [];
    setBriefs([]);
    setElapsedSeconds(0);
    setFileError(null);
    setServerError(null);
    setDragOver(false);
    setStage("upload");
  }, [stopPolling]);

  const statusLabel =
    briefs.length > 1
      ? `Processing ${briefs.length} briefs with AI…`
      : "Processing with AI";

  return (
    <div className="rounded-xl border border-neutral-100 bg-white p-6 shadow-[0_10px_30px_rgba(10,18,42,0.06)]">
      {stage === "upload" && (
        <div className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload client briefs"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragOver
                ? "border-red-500 bg-red-50"
                : "border-neutral-100 bg-neutral-50 hover:border-red-200 hover:bg-neutral-100/40"
            }`}
          >
            <span className="text-3xl font-display text-neutral-300">+</span>
            <p className="text-sm font-semibold text-neutral-500">
              Drop briefs here or click to browse (one or more files)
            </p>
            <p className="text-xs font-mono text-neutral-300">
              .txt · .pdf · .docx · up to 5 MB each
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files ?? undefined);
              e.target.value = "";
            }}
          />
          {fileError && (
            <p className="text-sm text-red-500" role="alert">
              {fileError}
            </p>
          )}
          <p className="text-xs leading-relaxed text-neutral-300">
            Each brief is processed in the background to be structured into a
            project outline. You won&apos;t wait on this screen for the
            processing to start — it runs in the background and this view polls
            progress. Provider calls are capped so a batch never fires many AI
            requests at once.
          </p>
        </div>
      )}

      {stage === "uploading" && (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Spinner label="Uploading briefs…" />
          <p className="text-xs text-neutral-300">
            Storing the files, then handing them to the AI queue.
          </p>
        </div>
      )}

      {stage === "processing" && (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <Spinner label={statusLabel} />
          {elapsedSeconds > 0 && (
            <p className="text-xs font-mono text-neutral-300">
              {elapsedSeconds}s elapsed
            </p>
          )}
          {resolvedCount > 0 && (
            <p className="text-xs font-mono text-neutral-300">
              {resolvedCount} of {briefs.length} processed
            </p>
          )}
          <p className="max-w-sm text-xs leading-relaxed text-neutral-300">
            Briefs are queued behind any AI calls already running. This batch
            won&apos;t be skipped — they run a few at a time until every brief
            is done.
          </p>
        </div>
      )}

      {stage === "stalled" && (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <p className="text-sm font-semibold text-neutral-500">
            This is taking longer than expected.
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-neutral-300">
            Some briefs are still running server-side and haven&apos;t failed —
            they may be stuck behind a slow AI response. Keep checking, or
            start over.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (watchesRef.current.length === 0) {
                  reset();
                  return;
                }
                setServerError(null);
                const hasPendingExtraction = watchesRef.current.some(
                  (w) => !w.parentId
                );
                setStage(hasPendingExtraction ? "processing" : "result");
                startPolling();
              }}
              className="cursor-pointer rounded-md bg-neutral-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed"
            >
              Keep waiting
            </button>
            <button
              type="button"
              onClick={reset}
              className="cursor-pointer rounded-md border border-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-400 transition-colors hover:bg-neutral-50"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {stage === "failed" && (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <p className="font-display text-xl text-red-500">
            Processing failed
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-neutral-400">
            {serverError ?? "Something went wrong processing these briefs."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-md bg-neutral-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-neutral-600"
          >
            Try another brief
          </button>
        </div>
      )}

      {stage === "result" && (
        <div className="flex flex-col gap-6">
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-red-500">
            {briefs.length > 1 ? `${briefs.length} briefs` : "Brief"}
          </p>
          <div className="flex flex-col gap-6">
            {briefs.map((brief) => (
              <BriefResultCard
                key={brief.jobId}
                brief={brief}
                onExpand={handleFollowUp}
              />
            ))}
          </div>

          <div className="flex justify-end border-t border-neutral-100 pt-5">
            <button
              type="button"
              onClick={reset}
              className="cursor-pointer rounded-md border border-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-400 transition-colors hover:bg-neutral-50"
            >
              Start a new brief
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
