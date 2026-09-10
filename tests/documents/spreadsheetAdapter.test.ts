import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import {
  toUniverWorkbook,
  fromUniverWorkbook,
} from "../../src/utils/documents/spreadsheetUniverAdapter";
import {
  assertSafeSpreadsheetCommand,
  normalizeDocumentWorkbook,
} from "../../src/utils/documents/spreadsheetModel";
const workbook = () => {
  const block = fixture().documents[0].blocks.find(
    (item) => item.type === "spreadsheet",
  );
  if (block?.type !== "spreadsheet") throw Error("fixture");
  return block.workbook;
};
describe("offline spreadsheet adapter", () => {
  it("accepts safe engine-generated nanoid sheet keys without relaxing document ownership IDs", () => {
    const value = workbook();
    value.sheets[0].id = "_new-sheet";
    value.sheets[0].cells.A2 = {
      value: "Cell",
      reference: {
        databaseId: "db-a",
        kind: "cell",
        id: "doc",
        blockId: "sheet",
        sheetId: "_new-sheet",
        address: "A1",
      },
    };
    expect(normalizeDocumentWorkbook(value).sheets[0].id).toBe("_new-sheet");
    value.sheets[0].id = "../unsafe";
    expect(() => normalizeDocumentWorkbook(value)).toThrow();
  });
  it("roundtrips cell contents, formulas, formats, merges, freeze, dimensions, typed references and notes", () => {
    const original = workbook();
    original.sheets[0].cells.A1.note = "Cell note";
    original.sheets[0].cells.C1 = { value: "Yes", validationId: "yesno" };
    original.sheets[0].filter = {
      range: { startRow: 0, endRow: 20, startColumn: 0, endColumn: 2 },
      columns: [{ column: 2, values: ["Yes"], includeBlank: true }],
    };
    const converted = fromUniverWorkbook(toUniverWorkbook(original));
    expect(converted.warnings).toEqual([]);
    const sheet = converted.workbook.sheets[0];
    expect(sheet.cells.A1.reference).toEqual(
      original.sheets[0].cells.A1.reference,
    );
    expect(sheet.cells.A1.note).toBe("Cell note");
    expect(sheet.cells.B3.formula).toBe("=SUM(B1:B2)");
    expect(converted.workbook.styles[sheet.cells.A1.styleId!]).toEqual(
      original.styles.heading,
    );
    expect(
      converted.workbook.validations[sheet.cells.C1.validationId!],
    ).toEqual(original.validations.yesno);
    expect(sheet.merges).toEqual(original.sheets[0].merges);
    expect(sheet.freeze).toEqual(original.sheets[0].freeze);
    expect(sheet.rowMetadata).toEqual(original.sheets[0].rowMetadata);
    expect(sheet.columnMetadata).toEqual(original.sheets[0].columnMetadata);
    expect(sheet.filter).toEqual(original.sheets[0].filter);
  });
  it("reports unsupported styling rather than silently pretending to retain it", () => {
    const raw = toUniverWorkbook(workbook());
    raw.styles.heading = { ...raw.styles.heading, tr: { a: 45 } };
    expect(fromUniverWorkbook(raw).warnings).toContain(
      "Some advanced text decorations or rotations are not saved.",
    );
  });
  it.each([
    '=WEBSERVICE("https://host.invalid")',
    '=HYPERLINK("file:///secret")',
    "='[other.xlsx]Sheet'!A1",
    "=cmd|' /C command'!A1",
    "=IMPORTXML(A1)",
  ])("refuses unsafe formula before engine command: %s", (formula) => {
    expect(() =>
      assertSafeSpreadsheetCommand({ cellValue: { 0: { 0: { f: formula } } } }),
    ).toThrow();
  });
  it("allows local formulas but refuses executable validation and invalid filter bounds", () => {
    expect(() =>
      assertSafeSpreadsheetCommand({ value: "=SUM(B1:B3)" }),
    ).not.toThrow();
    expect(() =>
      assertSafeSpreadsheetCommand({ type: "custom", formula1: "=SUM(A1)" }),
    ).toThrow();
    const value = workbook();
    value.sheets[0].filter = {
      range: { startRow: 0, endRow: 100000, startColumn: 0, endColumn: 1 },
      columns: [],
    };
    expect(() => normalizeDocumentWorkbook(value)).toThrow();
  });
  it("refuses unsafe formulas arriving in imported snapshots before unit construction", () => {
    const value = workbook();
    value.sheets[0].cells.A1.formula = '=WEBSERVICE("https://example.invalid")';
    expect(() => toUniverWorkbook(value)).toThrow();
  });
});
