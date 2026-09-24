import "server-only";

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Texts a client brief must be readable from before any AI call is spent. */

export class UnsupportedFileError extends Error {
  constructor() {
    super(
      "This file type is not supported. Upload a plain text (.txt), PDF (.pdf), or Word (.docx) file."
    );
    this.name = "UnsupportedFileError";
  }
}

/**
 * Turbopack rewrites pdfjs-dist's built-in default worker URL
 * (`new URL("./pdf.worker.mjs", import.meta.url)`) into a `.next/.../chunks/`
 * path that doesn't exist at runtime, so the Node "fake worker" fails to load
 * and every PDF parse dies. Point it at the real worker file instead. Returns
 * null if neither resolution method can find it, in which case pdfjs keeps its
 * (broken under Turbopack) default and the original error surfaces.
 */
function resolvePdfWorkerSrc(): string | null {
  const direct = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs"
  );
  if (fs.existsSync(direct)) return direct;

  const meta = import.meta as unknown as { resolve?: (s: string) => string | URL };
  try {
    if (typeof meta.resolve === "function") {
      const resolved = meta.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      const str = typeof resolved === "string" ? resolved : resolved.toString();
      if (str.startsWith("file:")) {
        const fromUrl = fileURLToPath(str);
        if (fs.existsSync(fromUrl)) return fromUrl;
      } else if (fs.existsSync(str)) {
        return str;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Extracts plain text from an uploaded brief. .txt is decoded as UTF-8;
 * .pdf is parsed with pdf-parse (dynamic import keeps it out of the eager
 * server bundle). Nothing here ever writes the file to the database.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<string> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".txt")) {
    return buffer.toString("utf8");
  }

  if (lower.endsWith(".pdf")) {
    // Both are ESM with an identical specifier, so this pdfjs instance is the
    // same module pdf-parse's PDFParse uses internally (shared module cache) —
    // setting GlobalWorkerOptions here is honored by its getDocument call.
    const [{ PDFParse }, pdfjs] = await Promise.all([
      import("pdf-parse"),
      import("pdfjs-dist/legacy/build/pdf.mjs"),
    ]);
    const workerSrc = resolvePdfWorkerSrc();
    if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    const parser = new PDFParse({ data: buffer, verbosity: 0 });
    try {
      const result = await parser.getText();
      // Build the text from page entries rather than the library's
      // concatenated `text` field, which pads each page with a
      // "-- N of M --" footer that would pollute the extraction.
      return result.pages.map((page) => page.text).join("\n\n");
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith(".docx")) {
    // mammoth converts Word docs to text without a browser or native deps.
    // It needs a standalone Buffer (not a zero-offset view over a larger
    // ArrayBuffer), so copy the slice into a fresh allocation.
    const { extractRawText } = await import("mammoth");
    const result = await extractRawText({ buffer: Buffer.from(buffer) });
    return result.value.trim();
  }

  throw new UnsupportedFileError();
}