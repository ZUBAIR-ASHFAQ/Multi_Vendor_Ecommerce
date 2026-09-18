import { REPORT_OUTPUT_FORMAT, type ReportCode } from "./reports.constants.js";

/** One generated export file ready for Module 21 private storage. */
export interface RenderedReportExport {
  body: Uint8Array;
  mimeType: string;
  extension: string;
}

/** Converts one scalar export value into stable display text without JSON object leakage. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Escapes one CSV field using RFC-4180-compatible quoting. */
function csvField(value: unknown): string {
  const text = scalarText(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** Renders a deterministic CSV with the first row's key order as the column contract. */
function renderCsv(rows: ReadonlyArray<Record<string, unknown>>): Uint8Array {
  if (rows.length === 0) return new TextEncoder().encode("\n");
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const lines = [
    headers.map(csvField).join(","),
    ...rows.map((row) => headers.map((header) => csvField(row[header])).join(",")),
  ];
  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

/** Escapes text used inside a PDF literal string. */
function pdfText(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/\(/gu, "\\(").replace(/\)/gu, "\\)");
}

/** Limits one PDF line so a wide tabular row cannot corrupt the fixed-width export page. */
function truncatePdfLine(value: string, maxLength = 150): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

/** Converts tabular rows into readable line-oriented text for the dependency-free PDF renderer. */
function reportPdfLines(
  reportCode: ReportCode,
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const lines = [`Marketplace report: ${reportCode}`, ""];
  if (rows.length === 0) return [...lines, "No rows matched the selected filters."];

  const headers = Object.keys(rows[0] as Record<string, unknown>);
  lines.push(headers.join(" | "));
  lines.push("-".repeat(Math.min(150, Math.max(20, headers.join(" | ").length))));
  for (const row of rows) {
    lines.push(
      truncatePdfLine(headers.map((header) => scalarText(row[header])).join(" | ")),
    );
  }
  return lines;
}

/** Builds a small standards-compliant text PDF without introducing another rendering dependency. */
function renderPdf(
  reportCode: ReportCode,
  rows: ReadonlyArray<Record<string, unknown>>,
): Uint8Array {
  const allLines = reportPdfLines(reportCode, rows);
  const linesPerPage = 46;
  const pages: string[][] = [];
  for (let index = 0; index < allLines.length; index += linesPerPage) {
    pages.push(allLines.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) pages.push([]);

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  let nextId = 4;

  for (const _page of pages) {
    pageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  }

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((lines, pageIndex) => {
    const pageId = pageObjectIds[pageIndex] as number;
    const contentId = contentObjectIds[pageIndex] as number;
    const contentLines = ["BT", "/F1 8 Tf", "36 806 Td", "10 TL"];
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) contentLines.push("T*");
      contentLines.push(`(${pdfText(line)}) Tj`);
    });
    contentLines.push("ET");
    const content = `${contentLines.join("\n")}\n`;
    objects[pageId] = [
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842]`,
      `/Resources << /Font << /F1 ${fontId} 0 R >> >>`,
      `/Contents ${contentId} 0 R >>`,
    ].join(" ");
    objects[contentId] = `<< /Length ${new TextEncoder().encode(content).byteLength} >>\nstream\n${content}endstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = new TextEncoder().encode(pdf).byteLength;
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = new TextEncoder().encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    const offset = offsets[id] ?? 0;
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Renders one allow-listed Module 20 export format from already-authorized tabular rows. */
export function renderReportExport(
  reportCode: ReportCode,
  outputFormat: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): RenderedReportExport {
  if (outputFormat === REPORT_OUTPUT_FORMAT.CSV) {
    return {
      body: renderCsv(rows),
      mimeType: "text/csv",
      extension: "csv",
    };
  }
  if (outputFormat === REPORT_OUTPUT_FORMAT.PDF) {
    return {
      body: renderPdf(reportCode, rows),
      mimeType: "application/pdf",
      extension: "pdf",
    };
  }
  throw new Error(`Unsupported report output format: ${outputFormat}`);
}
