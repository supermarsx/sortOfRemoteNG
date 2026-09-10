import type { DocumentWorkbook } from "../../types/documents/document";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
  validateDocumentFormula,
} from "./validation";

/** Reuses the persistence allowlist; engine/import adapters cannot widen the contract. */
export function normalizeDocumentWorkbook(value: unknown): DocumentWorkbook {
  const data = normalizeDatabaseDocuments({
    ...emptyDatabaseDocuments(),
    documents: [
      {
        id: "sheet-check",
        parentFolderId: null,
        name: "Sheet",
        icon: "file-text",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        blocks: [{ id: "sheet", type: "spreadsheet", workbook: value }],
      },
    ],
  });
  const block = data.documents[0].blocks[0];
  if (block.type !== "spreadsheet") throw Error("Invalid workbook.");
  return block.workbook;
}
export function spreadsheetAddress(row: number, column: number): string {
  let letters = "",
    index = column + 1;
  while (index > 0) {
    index--;
    letters = String.fromCharCode(65 + (index % 26)) + letters;
    index = Math.floor(index / 26);
  }
  return `${letters}${row + 1}`;
}
/** Used before engine commands, not merely before saving. No private values in errors. */
export function assertSafeSpreadsheetCommand(value: unknown): void {
  let visited = 0;
  const inspect = (item: unknown, depth: number, field = "") => {
    if (++visited > 300000 || depth > 40)
      throw Error("Spreadsheet operation exceeds safe editing limits.");
    if (typeof item === "string") {
      // Cell editor text is an incomplete draft, never a calculation input.
      // Its eventual sheet f/v mutation is still checked before evaluation.
      if (field !== "dataStream" && item.startsWith("="))
        validateDocumentFormula(item);
      return;
    }
    if (!item || typeof item !== "object") return;
    if (
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "custom" &&
      "formula1" in item
    )
      throw Error("Custom formula validation is not supported.");
    if (Array.isArray(item)) {
      item.forEach((entry) => inspect(entry, depth + 1));
      return;
    }
    for (const [key, entry] of Object.entries(item)) {
      if (
        ["drawings", "images", "externalLinks"].includes(key) &&
        entry &&
        (typeof entry !== "object" || Object.keys(entry).length > 0)
      )
        throw Error(
          "Remote images and external spreadsheet links are disabled.",
        );
      inspect(entry, depth + 1, key);
    }
  };
  inspect(value, 0);
}
