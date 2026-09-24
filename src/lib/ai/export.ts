import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { Outline } from "./schema";

/**
 * Renders a finished outline into a printable document the designer can hand
 * to the client. Two formats:
 *  - PDF via pdf-lib (pure JS, no native deps) drawing text with manual
 *    wrapping + pagination.
 *  - DOCX via the "docx" package so the designer can keep editing it.
 * Both walk the same "blocks" structure so the two formats stay equivalent.
 */

type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string };

function blocksFromOutline(outline: Outline): Block[] {
  const blocks: Block[] = [
    { kind: "title", text: outline.projectName },
    { kind: "heading", text: "Summary" },
    { kind: "paragraph", text: outline.summary },
  ];

  if (outline.goals.length > 0) {
    blocks.push({ kind: "heading", text: "Goals" });
    for (const goal of outline.goals) blocks.push({ kind: "bullet", text: goal });
  }

  if (outline.deliverables.length > 0) {
    blocks.push({ kind: "heading", text: "Deliverables" });
    for (const deliverable of outline.deliverables) {
      blocks.push({ kind: "bullet", text: `${deliverable.name} — ${deliverable.description}` });
    }
  }

  if (outline.timeline.length > 0) {
    blocks.push({ kind: "heading", text: "Timeline" });
    for (const phase of outline.timeline) {
      const window = [phase.start, phase.end].filter(Boolean).join(" -> ");
      blocks.push({
        kind: "bullet",
        text: `${phase.phase} (${phase.duration})${window ? ` — ${window}` : ""}`,
      });
      for (const task of phase.tasks) blocks.push({ kind: "bullet", text: `  • ${task}` });
      if (phase.dependsOn.length > 0) {
        blocks.push({
          kind: "bullet",
          text: `  Depends on: ${phase.dependsOn.join(", ")}`,
        });
      }
    }
  }

  if (outline.budgetNotes.length > 0) {
    blocks.push({ kind: "heading", text: "Budget" });
    for (const note of outline.budgetNotes) blocks.push({ kind: "bullet", text: note });
  }

  if (outline.assumptions.length > 0) {
    blocks.push({ kind: "heading", text: "Assumptions" });
    for (const assumption of outline.assumptions)
      blocks.push({ kind: "bullet", text: assumption });
  }

  if (outline.openQuestions.length > 0) {
    blocks.push({ kind: "heading", text: "Open Questions" });
    for (const question of outline.openQuestions)
      blocks.push({ kind: "bullet", text: question });
  }

  return blocks;
}

// --- PDF -------------------------------------------------------------------

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** pdf-lib's standard fonts only carry the WinAnsi glyph set; any character
 * outside it (emoji, CJK, arrows, …) makes save() throw. Map unknown
 * codepoints to "?" so a PDF always renders, even for briefs that paste in
 * non-Latin text. The DOCX path has no such limit (full Unicode). */
function toWinAnsi(line: string): string {
  let out = "";
  for (const ch of line) {
    const code = ch.codePointAt(0)!;
    const ok =
      (code >= 0x20 && code <= 0x7e) || // ASCII printable
      (code >= 0xa0 && code <= 0xff) || // Latin-1: ç, ã, €-adjacent, ±, …
      code === 0x2013 || // – en dash
      code === 0x2014 || // — em dash
      code === 0x2018 || code === 0x2019 || // ' '
      code === 0x201c || code === 0x201d || // " "
      code === 0x2022 || // • bullet
      code === 0x2026 || // … ellipsis
      code === 0x20ac; // € euro
    out += ok ? ch : "?";
  }
  return out;
}

export async function renderOutlinePdf(outline: Outline): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(outline.projectName);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 20) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const draw = (text: string, font: PDFFont, size: number, color = rgb(0.1, 0.1, 0.1)) => {
    const lines = wrapText(toWinAnsi(text), font, size, CONTENT_WIDTH);
    for (const line of lines) {
      ensureSpace(size + 6);
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color });
      y -= size + 6;
    }
  };

  draw(outline.projectName, bold, 20);
  y -= 6;

  const heading = (text: string) => {
    y -= 8;
    draw(text, bold, 13, rgb(0.65, 0.23, 0.23));
    y -= 4;
  };

  const bullet = (text: string, indent: number) => {
    const lines = wrapText(toWinAnsi(text), regular, 10.5, CONTENT_WIDTH - indent);
    lines.forEach((line, i) => {
      ensureSpace(11);
      page.drawText(line, { x: MARGIN + indent + (i === 0 ? 12 : 0), y: y - 11, size: 10.5, font: regular });
      y -= 15;
    });
  };

  for (const block of blocksFromOutline(outline)) {
    switch (block.kind) {
      case "title":
        draw(block.text, bold, 20);
        y -= 6;
        break;
      case "heading":
        heading(block.text);
        break;
      case "paragraph":
        draw(block.text, regular, 10.5);
        y -= 4;
        break;
      case "bullet":
        bullet(block.text, 8);
        break;
    }
  }

  return pdf.save();
}

// --- DOCX ------------------------------------------------------------------

export async function renderOutlineDocx(outline: Outline): Promise<Buffer> {
  const bullet = (text: string, level: number) =>
    new Paragraph({ children: [new TextRun({ text })], bullet: { level } });

  const children: Paragraph[] = [];
  for (const block of blocksFromOutline(outline)) {
    switch (block.kind) {
      case "title":
        children.push(
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: block.text, bold: true })],
          })
        );
        break;
      case "heading":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: block.text, bold: true })],
          })
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: [new TextRun({ text: block.text })] }));
        break;
      case "bullet":
        if (block.text.startsWith("  ")) {
          children.push(bullet(block.text.trim(), 1));
        } else {
          children.push(bullet(block.text, 0));
        }
        break;
    }
  }

  const doc = new Document({
    title: outline.projectName,
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}