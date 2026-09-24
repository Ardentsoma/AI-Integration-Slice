import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/session";
import { parseOutline } from "@/lib/ai/schema";
import { sanitizeFileName } from "@/lib/ai/storage";
import { renderOutlineDocx, renderOutlinePdf } from "@/lib/ai/export";

const FORMATS = {
  pdf: { contentType: "application/pdf", render: renderOutlinePdf },
  docx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    render: renderOutlineDocx,
  },
} as const;

export type ExportFormat = keyof typeof FORMATS;

/**
 * Downloads a finished brief as a PDF or Word document. Same ownership and
 * readiness guards as the follow-up endpoint: the job must belong to the
 * signed-in user and already be "done". Works for both extraction jobs (the
 * structured outline) and follow-up jobs (the expanded brief), since both
 * store their result as the same outline JSON.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format");
  if (!format || !(format in FORMATS)) {
    return NextResponse.json(
      { error: "Use ?format=pdf or ?format=docx." },
      { status: 400 }
    );
  }

  const jobId = (await params).id;
  const job = await prisma.job.findFirst({
    where: { id: jobId, userId: user.id },
  });
  if (!job) {
    return NextResponse.json({ error: "No brief found for this job." }, { status: 404 });
  }
  if (job.status !== "done" || !job.resultJson) {
    return NextResponse.json(
      { error: "The brief is not ready yet. Wait for it to finish, then try again." },
      { status: 409 }
    );
  }

  let outline: ReturnType<typeof parseOutline>;
  try {
    outline = parseOutline(JSON.parse(job.resultJson));
  } catch {
    outline = null;
  }
  if (!outline) {
    return NextResponse.json(
      { error: "The source outline is unreadable. Upload the brief again." },
      { status: 500 }
    );
  }

  const { contentType, render } = FORMATS[format as ExportFormat];
  let file: Uint8Array<ArrayBuffer>;
  try {
    file = Uint8Array.from(await render(outline));
  } catch (e) {
    return NextResponse.json(
      { error: `render failed: ${String(e)}` },
      { status: 500 }
    );
  }

  const base =
    sanitizeFileName(outline.projectName) +
    (job.type === "follow-up" ? "-expanded" : "");
  // Content-Disposition: RFC 5987 handles non-ASCII project names; the plain
  // filename= is a compliance fallback for older clients.
  const disposition = `attachment; filename="${base}.${format}"; filename*=UTF-8''${encodeURIComponent(
    `${base}.${format}`
  )}`;

  return new NextResponse(file, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "no-store",
    },
  });
}