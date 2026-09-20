import { describe, expect, it } from "vitest";
import {
  REPORT_CODE,
  REPORT_OUTPUT_FORMAT,
} from "../../src/modules/reports/reports.constants.js";
import { renderReportExport } from "../../src/modules/reports/reports.export.js";

/** Decodes generated export bytes for deterministic text assertions. */
function decode(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

describe("Module 20 report export renderer", () => {
  it("renders deterministic RFC-4180-compatible CSV escaping without changing exact money text", () => {
    const rendered = renderReportExport(REPORT_CODE.SALES, REPORT_OUTPUT_FORMAT.CSV, [
      { orderNo: "ORD-1", note: "comma,quote\"line", amount: "1234567890.1234" },
    ]);

    expect(rendered.mimeType).toBe("text/csv");
    expect(rendered.extension).toBe("csv");
    expect(decode(rendered.body)).toBe(
      'orderNo,note,amount\r\nORD-1,"comma,quote""line",1234567890.1234\r\n',
    );
  });

  it("renders an empty CSV as a valid deterministic file instead of leaking undefined fields", () => {
    const rendered = renderReportExport(REPORT_CODE.INVENTORY, REPORT_OUTPUT_FORMAT.CSV, []);
    expect(decode(rendered.body)).toBe("\n");
  });

  it("renders a valid PDF header and a no-rows message for an empty report", () => {
    const rendered = renderReportExport(REPORT_CODE.PAYOUTS, REPORT_OUTPUT_FORMAT.PDF, []);
    const text = decode(rendered.body);
    expect(rendered.mimeType).toBe("application/pdf");
    expect(rendered.extension).toBe("pdf");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Marketplace report: payouts");
    expect(text).toContain("No rows matched the selected filters.");
    expect(text).toContain("%%EOF");
  });

  it("fails closed for an unsupported export format", () => {
    expect(() => renderReportExport(REPORT_CODE.SALES, "xlsx", [])).toThrow(
      "Unsupported report output format: xlsx",
    );
  });
});
