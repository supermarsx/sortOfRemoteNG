import type {
  DocumentWorkbook,
  DocumentCellStyle,
} from "../../types/documents/document";
import { DOCUMENT_LIMITS, documentCellCoordinates } from "./validation";
import {
  normalizeDocumentWorkbook,
  spreadsheetAddress,
} from "./spreadsheetModel";

const FILE_LIMIT = 8 * 1024 * 1024,
  EXPANDED_LIMIT = 24 * 1024 * 1024;
const unsafe = () =>
  Error(
    "Unsupported or unsafe spreadsheet file. Use bounded XLSX or UTF-8 CSV without macros, external links or embedded objects.",
  );
interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  expanded: number;
  offset: number;
}
/** Reads the central directory before asking any ZIP engine to decompress. ZIP64/encryption are refused. */
export function inspectSpreadsheetZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length > FILE_LIMIT || bytes.length < 22) throw unsafe();
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let index = bytes.length - 22;
    index >= Math.max(0, bytes.length - 65557);
    index--
  )
    if (data.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  if (
    end < 0 ||
    data.getUint16(end + 4, true) ||
    data.getUint16(end + 6, true) ||
    end + 22 + data.getUint16(end + 20, true) !== bytes.length
  )
    throw unsafe();
  const count = data.getUint16(end + 10, true),
    centralSize = data.getUint32(end + 12, true),
    central = data.getUint32(end + 16, true);
  if (
    !count ||
    count > 2048 ||
    count !== data.getUint16(end + 8, true) ||
    central + centralSize !== end
  )
    throw unsafe();
  const entries: ZipEntry[] = [],
    names = new Set<string>();
  let offset = central,
    expanded = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.getUint32(offset, true) !== 0x02014b50)
      throw unsafe();
    const flags = data.getUint16(offset + 8, true),
      method = data.getUint16(offset + 10, true),
      compressed = data.getUint32(offset + 20, true),
      size = data.getUint32(offset + 24, true),
      nameSize = data.getUint16(offset + 28, true),
      extra = data.getUint16(offset + 30, true),
      comment = data.getUint16(offset + 32, true),
      local = data.getUint32(offset + 42, true);
    if (
      offset + 46 + nameSize + extra + comment > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      local === 0xffffffff
    )
      throw unsafe();
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameSize),
    );
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..") ||
      /\0/.test(name) ||
      names.has(name.toLowerCase()) ||
      /vba|externalLinks|embeddings|activeX|connections\.xml|queryTables|customUI/i.test(
        name,
      )
    )
      throw unsafe();
    names.add(name.toLowerCase());
    expanded += size;
    if (
      expanded > EXPANDED_LIMIT ||
      size > 12 * 1024 * 1024 ||
      (size > 1024 * 1024 && size > Math.max(1, compressed) * 200) ||
      local + 30 > central ||
      data.getUint32(local, true) !== 0x04034b50
    )
      throw unsafe();
    const localNameSize = data.getUint16(local + 26, true),
      start = local + 30 + localNameSize + data.getUint16(local + 28, true);
    const localName = new TextDecoder().decode(
      bytes.subarray(local + 30, local + 30 + localNameSize),
    );
    if (
      localName !== name ||
      data.getUint16(local + 8, true) !== method ||
      data.getUint16(local + 6, true) & 1 ||
      start + compressed > central
    )
      throw unsafe();
    entries.push({ name, method, compressed, expanded: size, offset: start });
    offset += 46 + nameSize + extra + comment;
  }
  if (
    offset !== end ||
    !names.has("xl/workbook.xml") ||
    !names.has("[content_types].xml")
  )
    throw unsafe();
  return entries;
}
async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const compressed = new Uint8Array(
    bytes.subarray(entry.offset, entry.offset + entry.compressed),
  );
  if (entry.method === 0) {
    if (compressed.length !== entry.expanded) throw unsafe();
    return compressed;
  }
  const reader = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  })
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > entry.expanded || length > EXPANDED_LIMIT) throw unsafe();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (length !== entry.expanded) throw unsafe();
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function checkArchive(bytes: Uint8Array): Promise<void> {
  const entries = inspectSpreadsheetZip(bytes);
  // Inflate every entry under the declared and actual aggregate cap, before ExcelJS sees it.
  for (const entry of entries) {
    const decoded = await readZipEntry(bytes, entry);
    if (!/\.(xml|rels)$/i.test(entry.name)) continue;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw unsafe();
    if (/\.rels$/i.test(entry.name)) {
      const document = new DOMParser().parseFromString(text, "application/xml");
      if (document.querySelector("parsererror")) throw unsafe();
      for (const relation of document.getElementsByTagName("Relationship")) {
        const target = relation.getAttribute("Target") ?? "";
        if (
          relation.getAttribute("TargetMode")?.toLowerCase() === "external" ||
          /^[a-z][a-z\d+.-]*:|^\/\//i.test(target)
        )
          throw unsafe();
      }
    }
  }
}
function emptyWorkbook(): DocumentWorkbook {
  return { version: 1, sheets: [], styles: {}, validations: {} };
}
function importCsv(bytes: Uint8Array): DocumentWorkbook {
  if (bytes.length > FILE_LIMIT) throw unsafe();
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw unsafe();
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
    if (
      rows.length > DOCUMENT_LIMITS.rows ||
      row.length >= DOCUMENT_LIMITS.columns ||
      cell.length > 32768
    )
      throw unsafe();
  }
  if (quoted) throw unsafe();
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const workbook = emptyWorkbook(),
    cells: DocumentWorkbook["sheets"][number]["cells"] = {};
  let count = 0;
  rows.forEach((values, row) =>
    values.forEach((value, column) => {
      if (++count > DOCUMENT_LIMITS.cells) throw unsafe();
      cells[spreadsheetAddress(row, column)] = { value };
    }),
  );
  workbook.sheets.push({
    id: "sheet-1",
    name: "CSV",
    rows: Math.max(100, rows.length),
    columns: Math.max(26, ...rows.map((row) => row.length)),
    cells,
    merges: [],
    rowMetadata: {},
    columnMetadata: {},
  });
  return normalizeDocumentWorkbook(workbook);
}
export async function importSpreadsheetFile(
  name: string,
  bytes: Uint8Array,
): Promise<{ workbook: DocumentWorkbook; warnings: string[] }> {
  if (/\.csv$/i.test(name))
    return {
      workbook: importCsv(bytes),
      warnings: [
        "CSV contains values only. Formula-looking text is imported as literal text; formatting, sheets and links are not present.",
      ],
    };
  if (!/\.xlsx$/i.test(name)) throw unsafe();
  await checkArchive(bytes);
  const { Workbook } = await import("exceljs");
  const source = new Workbook();
  await source.xlsx.load(new Uint8Array(bytes).buffer);
  if (source.worksheets.length > DOCUMENT_LIMITS.sheets) throw unsafe();
  const workbook = emptyWorkbook(),
    warnings = new Set<string>();
  let cellCount = 0;
  for (const sourceSheet of source.worksheets) {
    if (
      sourceSheet.rowCount > DOCUMENT_LIMITS.rows ||
      sourceSheet.columnCount > DOCUMENT_LIMITS.columns
    )
      throw unsafe();
    const sheet: DocumentWorkbook["sheets"][number] = {
      id: `sheet-${sourceSheet.id}`,
      name: sourceSheet.name,
      rows: Math.max(100, sourceSheet.rowCount),
      columns: Math.max(26, sourceSheet.columnCount),
      cells: {},
      merges: [],
      rowMetadata: {},
      columnMetadata: {},
    };
    sourceSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (row.height || row.hidden)
        sheet.rowMetadata[String(rowNumber - 1)] = {
          ...(row.height && { size: Math.round((row.height * 96) / 72) }),
          ...(row.hidden && { hidden: true }),
        };
      row.eachCell({ includeEmpty: false }, (cell, column) => {
        if (++cellCount > DOCUMENT_LIMITS.cells) throw unsafe();
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const entry: DocumentWorkbook["sheets"][number]["cells"][string] = {
          value: null,
        };
        const raw = cell.value;
        if (
          typeof raw === "string" ||
          typeof raw === "number" ||
          typeof raw === "boolean" ||
          raw === null
        )
          entry.value = raw;
        else if (raw instanceof Date) {
          entry.value = raw.toISOString();
          warnings.add(
            "Excel dates are imported as ISO text to avoid timezone ambiguity.",
          );
        } else if (raw && ("formula" in raw || "sharedFormula" in raw)) {
          entry.formula = `=${cell.formula}`;
          entry.value =
            typeof cell.result === "number" ||
            typeof cell.result === "string" ||
            typeof cell.result === "boolean"
              ? cell.result
              : null;
        } else if (raw && "richText" in raw) {
          entry.value = raw.richText.map((run) => run.text).join("");
          warnings.add("Rich-text cells are imported as plain text.");
        } else throw unsafe();
        const style: DocumentCellStyle = {};
        if (cell.font) {
          if (cell.font.bold !== undefined) style.bold = cell.font.bold;
          if (cell.font.italic !== undefined) style.italic = cell.font.italic;
          if (cell.font.size) style.fontSize = Math.round(cell.font.size);
          if (cell.font.strike !== undefined) style.strike = cell.font.strike;
          if (cell.font.underline) style.underline = true;
          if (cell.font.color?.argb)
            style.color = `#${cell.font.color.argb.slice(-6)}`;
        }
        if (cell.fill?.type === "pattern" && cell.fill.fgColor?.argb)
          style.background = `#${cell.fill.fgColor.argb.slice(-6)}`;
        if (cell.numFmt) style.numberFormat = cell.numFmt;
        if (
          cell.alignment?.horizontal &&
          ["left", "center", "right"].includes(cell.alignment.horizontal)
        )
          style.horizontal = cell.alignment
            .horizontal as DocumentCellStyle["horizontal"];
        if (
          cell.alignment?.vertical &&
          ["top", "middle", "bottom"].includes(cell.alignment.vertical)
        )
          style.vertical = cell.alignment
            .vertical as DocumentCellStyle["vertical"];
        if (cell.alignment?.wrapText !== undefined)
          style.wrap = cell.alignment.wrapText;
        if (Object.keys(style).length) {
          const id = `style-${Object.keys(workbook.styles).length + 1}`;
          workbook.styles[id] = style;
          entry.styleId = id;
        }
        if (cell.note)
          entry.note =
            typeof cell.note === "string"
              ? cell.note
              : (cell.note.texts ?? []).map((run) => run.text).join("");
        if (cell.dataValidation?.type)
          warnings.add(
            "XLSX validation rules are not imported; review and add validation in the editor.",
          );
        if (cell.border && Object.keys(cell.border).length)
          warnings.add("XLSX borders are not imported in this version.");
        sheet.cells[spreadsheetAddress(rowNumber - 1, column - 1)] = entry;
      });
    });
    sourceSheet.columns.forEach((column, index) => {
      if (column.width || column.hidden)
        sheet.columnMetadata[String(index)] = {
          ...(column.width && { size: Math.round(column.width * 7) }),
          ...(column.hidden && { hidden: true }),
        };
    });
    for (const range of sourceSheet.model.merges ?? []) {
      const [start, end = start] = range.split(":");
      const a = documentCellCoordinates(start),
        b = documentCellCoordinates(end);
      sheet.merges.push({
        startRow: a.row,
        startColumn: a.column,
        endRow: b.row,
        endColumn: b.column,
      });
    }
    const view = sourceSheet.views?.find((view) => view.state === "frozen");
    if (view?.state === "frozen")
      sheet.freeze = { rows: view.ySplit ?? 0, columns: view.xSplit ?? 0 };
    if (sourceSheet.autoFilter)
      warnings.add(
        "XLSX filter criteria are not imported; reapply filters in the editor.",
      );
    workbook.sheets.push(sheet);
  }
  warnings.add(
    "XLSX import supports values, local formulas, basic formatting, merges, dimensions, freezes and notes. Charts, print layout and advanced formatting are not retained.",
  );
  return {
    workbook: normalizeDocumentWorkbook(workbook),
    warnings: [...warnings],
  };
}
export async function exportSpreadsheetFile(
  value: DocumentWorkbook,
  format: "xlsx" | "csv",
): Promise<{ name: string; mimeType: string; bytes: Uint8Array }> {
  const workbook = normalizeDocumentWorkbook(value);
  if (format === "csv") {
    const sheet = workbook.sheets[0];
    let maxRow = 0,
      maxColumn = 0;
    for (const key of Object.keys(sheet.cells)) {
      const pos = documentCellCoordinates(key);
      maxRow = Math.max(maxRow, pos.row);
      maxColumn = Math.max(maxColumn, pos.column);
    }
    const rows: string[] = [];
    for (let row = 0; row <= maxRow; row++) {
      const values: string[] = [];
      for (let column = 0; column <= maxColumn; column++) {
        const cell = sheet.cells[spreadsheetAddress(row, column)];
        let value = String(cell?.value ?? "");
        if (/^[\s]*[=+@-]/.test(value) || /^[\t\r]/.test(value))
          value = `'${value}`;
        values.push(`"${value.replace(/"/g, '""')}"`);
      }
      rows.push(values.join(","));
    }
    return {
      name: "spreadsheet.csv",
      mimeType: "text/csv;charset=utf-8",
      bytes: new TextEncoder().encode(rows.join("\r\n")),
    };
  }
  const { Workbook } = await import("exceljs");
  const target = new Workbook();
  for (const sheet of workbook.sheets) {
    const out = target.addWorksheet(sheet.name);
    for (const [address, item] of Object.entries(sheet.cells)) {
      const cell = out.getCell(address);
      cell.value = item.formula
        ? { formula: item.formula.slice(1), result: item.value ?? undefined }
        : item.value;
      const style = item.styleId ? workbook.styles[item.styleId] : undefined;
      if (style) {
        cell.font = {
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          strike: style.strike,
          size: style.fontSize,
          ...(style.color && { color: { argb: `FF${style.color.slice(1)}` } }),
        };
        if (style.background)
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: `FF${style.background.slice(1)}` },
          };
        if (style.numberFormat) cell.numFmt = style.numberFormat;
        cell.alignment = {
          horizontal: style.horizontal,
          vertical: style.vertical,
          wrapText: style.wrap,
        };
        if (style.border)
          cell.border = Object.fromEntries(
            ["top", "right", "bottom", "left"].map((side) => [
              side,
              {
                style: style.border!.style,
                color: { argb: `FF${style.border!.color.slice(1)}` },
              },
            ]),
          );
      }
      if (item.note) cell.note = item.note;
      // Owner-qualified application references are intentionally not exported as active hyperlinks.
    }
    for (const merge of sheet.merges)
      out.mergeCells(
        merge.startRow + 1,
        merge.startColumn + 1,
        merge.endRow + 1,
        merge.endColumn + 1,
      );
    for (const [row, meta] of Object.entries(sheet.rowMetadata)) {
      const targetRow = out.getRow(Number(row) + 1);
      if (meta.size) targetRow.height = (meta.size * 72) / 96;
      targetRow.hidden = meta.hidden ?? false;
    }
    for (const [column, meta] of Object.entries(sheet.columnMetadata)) {
      const targetColumn = out.getColumn(Number(column) + 1);
      if (meta.size) targetColumn.width = meta.size / 7;
      targetColumn.hidden = meta.hidden ?? false;
    }
    if (sheet.freeze)
      out.views = [
        {
          state: "frozen",
          xSplit: sheet.freeze.columns,
          ySplit: sheet.freeze.rows,
        },
      ];
  }
  const bytes = new Uint8Array(await target.xlsx.writeBuffer());
  if (bytes.length > FILE_LIMIT)
    throw Error("Export exceeds the supported 8 MiB spreadsheet file limit.");
  return {
    name: "spreadsheet.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
  };
}
