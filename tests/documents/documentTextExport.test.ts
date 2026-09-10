import { describe, expect, it } from "vitest";
import {
  documentPrintHtml,
  documentTextExport,
} from "../../src/utils/documents/documentTextExport";
import { fixture } from "./fixtures";
describe("readable document copies", () => {
  it("redacts structured secrets by default and only includes them on explicit opt-in", () => {
    const doc = fixture().documents[0];
    expect(documentTextExport(doc)).not.toContain("PRIVATE_FIXTURE");
    expect(documentTextExport(doc)).toContain("[REDACTED]");
    expect(documentTextExport(doc, true)).toContain("PRIVATE_FIXTURE");
  });
  it("escapes all text and forbids scripts, forms and remote resources in print HTML", () => {
    const html = documentPrintHtml(
      '<script src="https://evil.invalid"></script><img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'none'");
  });
  it("keeps bounded sheet values and formulas readable without evaluating them", () => {
    const text = documentTextExport(fixture().documents[0]);
    expect(text).toContain("B3: =SUM(B1:B2)");
    expect(text).toContain("B1: 2");
  });
});
