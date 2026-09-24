import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { aiConfig } from "@/lib/ai/config";
import {
  buildBriefStorageKey,
  putBrief,
  sanitizeFileName,
} from "@/lib/ai/storage";
import { runExtractionJob } from "@/lib/ai/jobs";
import { checkUserRateLimit } from "@/lib/rate-limit";

function isAllowedBriefFile(name: string, mimeType: string): boolean {
  const lower = name.toLowerCase();
  const extOk = aiConfig.upload.allowedExtensions.some(
    (ext) => lower.endsWith(ext)
  );
  if (!extOk) return false;
  // Some browsers send application/octet-stream (or an empty type) for text
  // files; accept those only when the extension already matched above. For
  // anything else, the declared type must be a text or PDF mime too.
  if (!mimeType || mimeType === "application/octet-stream") return true;
  return (
    mimeType === "text/plain" ||
    mimeType === "application/pdf" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType.startsWith("text/plain")
  );
}

/**
 * Upload-trigger endpoint (batch). Accepts one or more brief files, pushes
 * each to Cloudflare R2 (never PostgreSQL), records a "pending" job per file,
 * replies immediately with every job id, and only then runs the AI extraction
 * jobs in the background. The provider-call concurrency cap + per-provider
 * egress meters bound how many of those jobs actually hit Gemini at once.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const limit = checkUserRateLimit(request, "briefUpload", user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter(
    (value): value is globalThis.File => value instanceof globalThis.File
  );
  if (!form || files.length === 0) {
    return NextResponse.json(
      { error: "Upload at least one brief file (.txt, .pdf, or .docx) in the 'file' field." },
      { status: 400 }
    );
  }

  if (files.length > aiConfig.upload.maxFilesPerUpload) {
    return NextResponse.json(
      {
        error: `Select up to ${aiConfig.upload.maxFilesPerUpload} files at a time.`,
      },
      { status: 400 }
    );
  }

  // Validate the whole batch before touching storage: a bad file aborts the
  // upload atomically so a mixed batch can't leave half-processed briefs.
  for (const file of files) {
    if (!isAllowedBriefFile(file.name, file.type)) {
      return NextResponse.json(
        {
          error: `"${file.name}" is not an accepted file. Only ${aiConfig.upload.allowedExtensions.join(", ")} files are accepted.`,
        },
        { status: 415 }
      );
    }
    if (file.size > aiConfig.upload.maxBytes) {
      return NextResponse.json(
        {
          error: `"${file.name}" is too large. Max size is ${Math.round(
            aiConfig.upload.maxBytes / (1024 * 1024)
          )} MB.`,
        },
        { status: 413 }
      );
    }
  }

  // File bytes go to R2 first. Only the storage key (a pointer) is ever
  // stored in PostgreSQL — never the file content itself.
  const staged: { jobId: string; key: string; file: globalThis.File }[] = [];
  try {
    for (const file of files) {
      const jobId = randomUUID();
      const key = buildBriefStorageKey(user.id, jobId, file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      await putBrief({ key, body: bytes, contentType: file.type });
      staged.push({ jobId, key, file });
    }
  } catch (err) {
    console.error("[briefs] R2 upload failed", err);
    return NextResponse.json(
      { error: "One or more of your files could not be stored. Please try again." },
      { status: 502 }
    );
  }

  // Job rows are created as "pending" and the user is answered right away; the
  // AI calls run afterward in the background (see runExtractionJob), so the
  // upload request itself never blocks on Gemini.
  const jobIds: string[] = [];
  for (const { jobId, key, file } of staged) {
    const job = await prisma.job.create({
      data: {
        id: jobId,
        userId: user.id,
        type: "extraction",
        status: "pending",
        inputStorageKey: key,
        originalFileName: sanitizeFileName(file.name),
        contentType: file.type || null,
        fileSizeBytes: file.size,
      },
      select: { id: true },
    });
    jobIds.push(job.id);
  }

  // Fire the extractions in the background. Tradeoff: in this local single
  // process the promises keep running after the response; a production
  // deployment would hand this to a real queue worker instead.
  for (const jobId of jobIds) {
    void runExtractionJob(jobId).catch((err) => {
      console.error("[jobs] extraction worker crashed", err);
    });
  }

  return NextResponse.json({ jobIds }, { status: 201 });
}