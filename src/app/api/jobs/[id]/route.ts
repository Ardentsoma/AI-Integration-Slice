import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/session";

function parseStoredJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Job status endpoint the client polls. Returns the granular lifecycle
 * (pending/processing/done/failed) plus the outcome so the UI can render an
 * honest processing state and, on completion, the structured outline.
 * Ownership is enforced per-request: a user can only read their own jobs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const job = await prisma.job.findFirst({
    where: { id: (await params).id, userId: user.id },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    processingStage: job.processingStage,
    attempts: job.attempts,
    errorMessage: job.errorMessage,
    originalFileName: job.originalFileName,
    contentType: job.contentType,
    fileSizeBytes: job.fileSizeBytes,
    provider: job.provider,
    model: job.model,
    charactersExtracted: job.charactersExtracted,
    resultJson: parseStoredJson(job.resultJson),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
}