import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { followUpActionSchema, parseOutline, type Outline } from "@/lib/ai/schema";
import { runFollowUpJob } from "@/lib/ai/jobs";
import { checkUserRateLimit } from "@/lib/rate-limit";

/**
 * Follow-up action endpoint. A user-triggered action (today: "expand") on an
 * already-extracted outline. Creates a "follow-up" job from the parent
 * extraction's result, replies immediately, and runs the DeepSeek call in the
 * background — same don't-block-on-AI pattern as the upload endpoint.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const limit = checkUserRateLimit(request, "followUp", user.id);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many follow-up actions. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const parentJobId = (await params).id;
  const body = await request.json().catch(() => null);
  const parsed = followUpActionSchema.safeParse({ ...body, jobId: parentJobId });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid follow-up request." },
      { status: 400 }
    );
  }
  const { action } = parsed.data;

  // The follow-up can only act on an outline that belongs to this user and
  // has finished extracting; ownership is scoped in the query, never trusted
  // from the client.
  const parentJob = await prisma.job.findFirst({
    where: { id: parentJobId, userId: user.id },
  });
  if (!parentJob) {
    return NextResponse.json(
      { error: "No brief found for this job." },
      { status: 404 }
    );
  }
  if (parentJob.type !== "extraction" || parentJob.status !== "done" || !parentJob.resultJson) {
    return NextResponse.json(
      { error: "The outline is not ready yet. Wait for it to finish, then try again." },
      { status: 409 }
    );
  }

  let outline: Outline | null = null;
  try {
    outline = parseOutline(JSON.parse(parentJob.resultJson));
  } catch {
    outline = null;
  }
  if (!outline) {
    return NextResponse.json(
      { error: "The source outline is unreadable. Upload the brief again." },
      { status: 500 }
    );
  }

  const jobId = randomUUID();
  // Provenance: the follow-up expands the same brief file its parent used, so
  // inputStorageKey points at that same object and the file metadata (name,
  // type, size) is copied down from the parent extraction.
  await prisma.job.create({
    data: {
      id: jobId,
      userId: user.id,
      type: "follow-up",
      status: "pending",
      inputStorageKey: parentJob.inputStorageKey,
      parentJobId: parentJob.id,
      originalFileName: parentJob.originalFileName,
      contentType: parentJob.contentType,
      fileSizeBytes: parentJob.fileSizeBytes,
    },
    select: { id: true },
  });

  void runFollowUpJob(jobId, outline, action).catch((err) => {
    console.error("[jobs] follow-up worker crashed", err);
  });

  return NextResponse.json({ jobId, type: "follow-up" }, { status: 201 });
}