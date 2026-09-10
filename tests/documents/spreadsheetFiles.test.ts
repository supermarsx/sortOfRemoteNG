import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import {
  importSpreadsheetFile,
  exportSpreadsheetFile,
  inspectSpreadsheetZip,
} from "../../src/utils/documents/spreadsheetFiles";
describe("bounded offline spreadsheet files", () => {
  it("imports CSV as literal text and neutralizes formula-looking values on export", async () => {
    const result = await importSpreadsheetFile(
      "demo.csv",
      new TextEncoder().encode(
        'Name,Value\r\n"Demo, row",=WEBSERVICE("x")\r\nOther,+cmd',
      ),
    );
    expect(result.workbook.sheets[0].cells.B2).toEqual({
      value: '=WEBSERVICE("x")',
    });
    const file = await exportSpreadsheetFile(result.workbook, "csv");
    expect(new TextDecoder().decode(file.bytes)).toContain("'=WEBSERVICE");
    expect(new TextDecoder().decode(file.bytes)).toContain("'+cmd");
  });
  it("roundtrips a genuine offline XLSX through preflight and ExcelJS", async () => {
    const input = await importSpreadsheetFile(
      "sample.csv",
      new TextEncoder().encode("Name,Count\nRouter,2"),
    );
    input.workbook.sheets[0].cells.C2 = {
      value: 4,
      formula: "=SUM(B2,B2)",
      note: "Synthetic note",
    };
    input.workbook.sheets.push({
      ...structuredClone(input.workbook.sheets[0]),
      id: "second",
      name: "Second",
    });
    const file = await exportSpreadsheetFile(input.workbook, "xlsx");
    expect(inspectSpreadsheetZip(file.bytes).length).toBeGreaterThan(5);
    const copy = await importSpreadsheetFile(file.name, file.bytes);
    expect(copy.workbook.sheets).toHaveLength(2);
    expect(copy.workbook.sheets[0].cells.C2.formula).toBe("=SUM(B2,B2)");
    expect(copy.workbook.sheets[0].cells.C2.note).toBe("Synthetic note");
  });
  it("rejects external hyperlinks and unsafe formula workbooks before exposing them", async () => {
    const source = new Workbook();
    const sheet = source.addWorksheet("External");
    sheet.getCell("A1").value = {
      text: "Link",
      hyperlink: "https://secret.example.invalid",
    };
    await expect(
      importSpreadsheetFile(
        "external.xlsx",
        new Uint8Array(await source.xlsx.writeBuffer()),
      ),
    ).rejects.toThrow(/unsafe/);
    sheet.getCell("A1").value = {
      formula: 'WEBSERVICE("https://example.invalid")',
    };
    await expect(
      importSpreadsheetFile(
        "formula.xlsx",
        new Uint8Array(await source.xlsx.writeBuffer()),
      ),
    ).rejects.toThrow();
  });
  it("rejects oversize, truncated, ZIP64 and macro-named formats before decompression", async () => {
    expect(() =>
      inspectSpreadsheetZip(new Uint8Array(9 * 1024 * 1024)),
    ).toThrow();
    expect(() => inspectSpreadsheetZip(new Uint8Array([80, 75]))).toThrow();
    await expect(
      importSpreadsheetFile("active.xlsm", new Uint8Array()),
    ).rejects.toThrow();
    await expect(
      importSpreadsheetFile("bad.csv", new TextEncoder().encode('"unclosed')),
    ).rejects.toThrow();
  });
});
