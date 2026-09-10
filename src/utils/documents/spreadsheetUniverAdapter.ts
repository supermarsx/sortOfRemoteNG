import type {
  IWorkbookData,
  IStyleData,
  ICellData,
  ISheetDataValidationRule,
  LocaleType,
  DataValidationOperator,
} from "@univerjs/core";
import type {
  DocumentWorkbook,
  DocumentCellStyle,
  DocumentCellValidation,
  DocumentSpreadsheetCell,
} from "../../types/documents/document";
import { documentCellCoordinates } from "./validation";
import {
  normalizeDocumentWorkbook,
  spreadsheetAddress,
} from "./spreadsheetModel";

const borders = {
  thin: 1,
  medium: 8,
  thick: 13,
  dashed: 4,
  dotted: 3,
} as const;
const horizontal = { left: 1, center: 2, right: 3 } as const;
const vertical = { top: 1, middle: 2, bottom: 3 } as const;
const operators = {
  between: "between",
  equal: "equal",
  greater: "greaterThan",
  less: "lessThan",
} as const;
function toStyle(style: DocumentCellStyle): IStyleData {
  return {
    ...(style.fontFamily && { ff: style.fontFamily }),
    ...(style.fontSize && { fs: style.fontSize }),
    ...(style.bold !== undefined && { bl: style.bold ? 1 : 0 }),
    ...(style.italic !== undefined && { it: style.italic ? 1 : 0 }),
    ...(style.underline !== undefined && {
      ul: { s: style.underline ? 1 : 0 },
    }),
    ...(style.strike !== undefined && { st: { s: style.strike ? 1 : 0 } }),
    ...(style.color && { cl: { rgb: style.color } }),
    ...(style.background && { bg: { rgb: style.background } }),
    ...(style.horizontal && { ht: horizontal[style.horizontal] }),
    ...(style.vertical && { vt: vertical[style.vertical] }),
    ...(style.wrap !== undefined && { tb: style.wrap ? 3 : 2 }),
    ...(style.numberFormat && { n: { pattern: style.numberFormat } }),
    ...(style.border && {
      bd: Object.fromEntries(
        ["t", "r", "b", "l"].map((side) => [
          side,
          { s: borders[style.border!.style], cl: { rgb: style.border!.color } },
        ]),
      ),
    }),
  };
}
function fromStyle(
  style: IStyleData,
  warnings: Set<string>,
): DocumentCellStyle {
  const result: DocumentCellStyle = {};
  const supported = new Set([
    "ff",
    "fs",
    "bl",
    "it",
    "ul",
    "st",
    "cl",
    "bg",
    "ht",
    "vt",
    "tb",
    "n",
    "bd",
  ]);
  if (Object.keys(style).some((key) => !supported.has(key)))
    warnings.add("Some advanced text decorations or rotations are not saved.");
  if (style.ff) {
    if (["sans-serif", "serif", "monospace"].includes(style.ff))
      result.fontFamily = style.ff as DocumentCellStyle["fontFamily"];
    else warnings.add("Custom fonts are replaced by the local default font.");
  }
  if (style.fs !== undefined) result.fontSize = style.fs;
  if (style.bl !== undefined) result.bold = style.bl === 1;
  if (style.it !== undefined) result.italic = style.it === 1;
  if (style.ul) result.underline = style.ul.s === 1;
  if (style.st) result.strike = style.st.s === 1;
  for (const [key, color] of [
    ["color", style.cl],
    ["background", style.bg],
  ] as const) {
    if (color?.rgb && /^#[\da-f]{6}$/i.test(color.rgb)) result[key] = color.rgb;
    else if (color) warnings.add("Theme or non-RGB colors are not saved.");
  }
  if (style.ht && style.ht <= 3)
    result.horizontal = (["left", "center", "right"] as const)[style.ht - 1];
  if (style.vt && style.vt <= 3)
    result.vertical = (["top", "middle", "bottom"] as const)[style.vt - 1];
  if (style.tb) result.wrap = style.tb === 3;
  if (style.n?.pattern) result.numberFormat = style.n.pattern;
  if (style.bd) {
    const sides = [style.bd.t, style.bd.r, style.bd.b, style.bd.l];
    const first = sides.find(Boolean);
    const border = Object.entries(borders).find(
      ([, number]) => number === first?.s,
    )?.[0] as keyof typeof borders | undefined;
    if (
      first?.cl.rgb &&
      /^#[\da-f]{6}$/i.test(first.cl.rgb) &&
      border &&
      sides.every((side) => JSON.stringify(side) === JSON.stringify(first))
    )
      result.border = { color: first.cl.rgb, style: border };
    else
      warnings.add(
        "Only uniform four-sided borders are saved; mixed borders are omitted.",
      );
  }
  return result;
}
export function toUniverWorkbook(
  value: DocumentWorkbook,
  id = "document-workbook",
): IWorkbookData {
  const book = normalizeDocumentWorkbook(value);
  const validations: Record<string, ISheetDataValidationRule[]> = {};
  const filters: Record<string, unknown> = {};
  const result: IWorkbookData = {
    id,
    name: "Document spreadsheet",
    appVersion: "0.25.1",
    locale: "enUS" as LocaleType,
    styles: Object.fromEntries(
      Object.entries(book.styles).map(([key, style]) => [key, toStyle(style)]),
    ),
    sheetOrder: book.sheets.map((sheet) => sheet.id),
    sheets: {},
  };
  for (const sheet of book.sheets) {
    const cellData: Record<number, Record<number, ICellData>> = {};
    const validationMap = new Map<string, ISheetDataValidationRule>();
    validations[sheet.id] = [];
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const { row, column } = documentCellCoordinates(address);
      (cellData[row] ??= {})[column] = {
        v: cell.value,
        ...(!cell.formula &&
          typeof cell.value === "string" && { t: 1 as const }),
        ...(cell.formula && { f: cell.formula }),
        ...(cell.styleId && { s: cell.styleId }),
        ...((cell.reference || cell.note !== undefined) && {
          custom: {
            ...(cell.reference && { documentReference: cell.reference }),
            ...(cell.note !== undefined && { documentNote: cell.note }),
          },
        }),
      };
      if (cell.validationId) {
        const existing = validationMap.get(cell.validationId);
        if (existing) {
          existing.ranges.push({
            startRow: row,
            endRow: row,
            startColumn: column,
            endColumn: column,
          });
          continue;
        }
        const rule = book.validations[cell.validationId];
        if (
          rule.type === "list" &&
          rule.values.some((entry) => String(entry).includes(","))
        )
          throw Error(
            "List validation values containing commas cannot be represented by this spreadsheet engine.",
          );
        validations[sheet.id].push({
          uid: `${cell.validationId}-${address}`,
          type: {
            list: "list",
            number: "decimal",
            date: "date",
            "text-length": "textLength",
          }[rule.type],
          allowBlank: rule.allowBlank,
          operator: rule.operator
            ? (operators[rule.operator] as DataValidationOperator)
            : undefined,
          formula1:
            rule.type === "list"
              ? rule.values.join(",")
              : String(rule.values[0] ?? ""),
          formula2:
            rule.values[1] === undefined ? undefined : String(rule.values[1]),
          ranges: [
            {
              startRow: row,
              endRow: row,
              startColumn: column,
              endColumn: column,
            },
          ],
          showDropDown: true,
        });
        validationMap.set(
          cell.validationId,
          validations[sheet.id][validations[sheet.id].length - 1],
        );
      }
    }
    if (sheet.filter)
      filters[sheet.id] = {
        ref: sheet.filter.range,
        filterColumns: sheet.filter.columns.map((column) => ({
          colId: column.column,
          ...(column.values && {
            filters: {
              filters: column.values,
              ...(column.includeBlank && { blank: true }),
            },
          }),
          ...(column.conditions && {
            customFilters: {
              ...(column.matchAll && { and: 1 }),
              customFilters: column.conditions.map((condition) => ({
                operator: condition.operator,
                val: condition.value,
              })),
            },
          }),
        })),
      };
    result.sheets[sheet.id] = {
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.rows,
      columnCount: sheet.columns,
      cellData,
      mergeData: sheet.merges,
      rowData: Object.fromEntries(
        Object.entries(sheet.rowMetadata).map(([key, meta]) => [
          key,
          {
            ...(meta.size && { h: meta.size }),
            ...(meta.hidden !== undefined && { hd: meta.hidden ? 1 : 0 }),
          },
        ]),
      ),
      columnData: Object.fromEntries(
        Object.entries(sheet.columnMetadata).map(([key, meta]) => [
          key,
          {
            ...(meta.size && { w: meta.size }),
            ...(meta.hidden !== undefined && { hd: meta.hidden ? 1 : 0 }),
          },
        ]),
      ),
      ...(sheet.freeze && {
        freeze: {
          xSplit: sheet.freeze.columns,
          ySplit: sheet.freeze.rows,
          startRow: sheet.freeze.rows ? sheet.freeze.rows : -1,
          startColumn: sheet.freeze.columns ? sheet.freeze.columns : -1,
        },
      }),
    };
  }
  result.resources = [
    { name: "SHEET_DATA_VALIDATION_PLUGIN", data: JSON.stringify(validations) },
    { name: "SHEET_FILTER_PLUGIN", data: JSON.stringify(filters) },
  ];
  return result;
}
export function fromUniverWorkbook(value: IWorkbookData): {
  workbook: DocumentWorkbook;
  warnings: string[];
} {
  const warnings = new Set<string>();
  const styles: DocumentWorkbook["styles"] = {};
  let styleSequence = 0;
  const styleMap = new Map<string, string>();
  const getStyle = (style: IStyleData | string | null | undefined) => {
    if (!style) return undefined;
    const resolved = typeof style === "string" ? value.styles[style] : style;
    if (!resolved) return undefined;
    const converted = fromStyle(resolved, warnings),
      serialized = JSON.stringify(converted);
    if (!styleMap.has(serialized)) {
      const id = `style-${++styleSequence}`;
      styleMap.set(serialized, id);
      styles[id] = converted;
    }
    return styleMap.get(serialized);
  };
  const resources = (name: string): Record<string, unknown> => {
    const resource = value.resources?.find((entry) => entry.name === name);
    return resource?.data ? JSON.parse(resource.data) : {};
  };
  const rules = resources("SHEET_DATA_VALIDATION_PLUGIN"),
    filters = resources("SHEET_FILTER_PLUGIN");
  const workbook: DocumentWorkbook = {
    version: 1,
    styles,
    validations: {},
    sheets: [],
  };
  for (const sheetId of value.sheetOrder) {
    const sheet = value.sheets[sheetId];
    if (!sheet) throw Error("Invalid spreadsheet sheet reference.");
    const cells: Record<string, DocumentSpreadsheetCell> = {};
    for (const [row, columns] of Object.entries(sheet.cellData ?? {}))
      for (const [column, cell] of Object.entries(columns ?? {}) as Array<
        [string, ICellData | null]
      >) {
        if (!cell) continue;
        if (cell.p)
          warnings.add(
            "Rich text inside spreadsheet cells is saved as plain text.",
          );
        const richText = cell.p?.body?.dataStream?.replace(/\r?\n$/, "");
        const styleId = getStyle(cell.s || undefined);
        cells[spreadsheetAddress(Number(row), Number(column))] = {
          value: richText ?? cell.v ?? null,
          ...(cell.f && { formula: cell.f }),
          ...(styleId && { styleId }),
          ...(cell.custom?.documentReference && {
            reference: cell.custom.documentReference,
          }),
          ...(cell.custom?.documentNote !== undefined && {
            note: cell.custom.documentNote,
          }),
        };
      }
    const rulesForSheet = rules[sheetId] as
      ISheetDataValidationRule[] | undefined;
    let validationCells = 0;
    for (const rule of rulesForSheet ?? []) {
      const type = (
        {
          list: "list",
          decimal: "number",
          date: "date",
          textLength: "text-length",
        } as const
      )[rule.type as "list"];
      const operator = Object.entries(operators).find(
        ([, name]) => name === rule.operator,
      )?.[0] as DocumentCellValidation["operator"];
      if (
        !type ||
        (rule.operator && !operator) ||
        rule.formula1?.startsWith("=") ||
        rule.formula2?.startsWith("=")
      )
        throw Error(
          "Unsupported spreadsheet validation. Use literal list, number, date or text-length rules.",
        );
      const id = `validation-${Object.keys(workbook.validations).length + 1}`;
      workbook.validations[id] = {
        type,
        allowBlank: rule.allowBlank ?? true,
        ...(operator && { operator }),
        values:
          type === "list"
            ? (rule.formula1 ?? "").split(",")
            : [rule.formula1, rule.formula2]
                .filter((entry): entry is string => entry !== undefined)
                .map((entry) =>
                  type === "number" || type === "text-length"
                    ? Number(entry)
                    : entry,
                ),
      };
      for (const range of rule.ranges ?? [])
        for (let row = range.startRow; row <= range.endRow; row++)
          for (
            let column = range.startColumn;
            column <= range.endColumn;
            column++
          ) {
            if (++validationCells > 50000)
              throw Error(
                "Spreadsheet validation range exceeds supported cell limits.",
              );
            (cells[spreadsheetAddress(row, column)] ??= {
              value: null,
            }).validationId = id;
          }
    }
    const filter = filters[sheetId] as
      | {
          ref: NonNullable<
            DocumentWorkbook["sheets"][number]["filter"]
          >["range"];
          filterColumns?: Array<{
            colId: number;
            filters?: { filters?: string[]; blank?: boolean };
            colorFilters?: unknown;
            customFilters?: {
              and?: number;
              customFilters: Array<{
                operator?: "equal";
                val: string | number;
              }>;
            };
          }>;
        }
      | undefined;
    if (filter?.filterColumns?.some((column) => column.colorFilters))
      warnings.add(
        "Color-based filters are not saved; value and condition filters are retained.",
      );
    workbook.sheets.push({
      id: sheetId,
      name: sheet.name ?? "Sheet",
      rows: sheet.rowCount ?? 100,
      columns: sheet.columnCount ?? 26,
      cells,
      merges: (sheet.mergeData ?? []).map(
        ({ startRow, startColumn, endRow, endColumn }) => ({
          startRow,
          startColumn,
          endRow,
          endColumn,
        }),
      ),
      rowMetadata: Object.fromEntries(
        Object.entries(sheet.rowData ?? {}).map(([key, meta]) => [
          key,
          {
            ...(meta.h !== undefined && { size: Math.round(meta.h) }),
            ...(meta.hd !== undefined && { hidden: meta.hd === 1 }),
          },
        ]),
      ),
      columnMetadata: Object.fromEntries(
        Object.entries(sheet.columnData ?? {}).map(([key, meta]) => [
          key,
          {
            ...(meta.w !== undefined && { size: Math.round(meta.w) }),
            ...(meta.hd !== undefined && { hidden: meta.hd === 1 }),
          },
        ]),
      ),
      ...(sheet.freeze && {
        freeze: {
          rows: Math.max(0, sheet.freeze.ySplit),
          columns: Math.max(0, sheet.freeze.xSplit),
        },
      }),
      ...(filter && {
        filter: {
          range: filter.ref,
          columns: (filter.filterColumns ?? []).map((column) => ({
            column: column.colId,
            ...(column.filters && {
              values: column.filters.filters ?? [],
              includeBlank: column.filters.blank ?? false,
            }),
            ...(column.customFilters && {
              matchAll: column.customFilters.and === 1,
              conditions: column.customFilters.customFilters.map(
                (condition) => ({
                  operator: condition.operator ?? "equal",
                  value: condition.val,
                }),
              ),
            }),
          })),
        },
      }),
    });
  }
  const hasContent = (data: unknown): boolean =>
    data !== null &&
    data !== undefined &&
    (typeof data === "object"
      ? Object.values(data).some(hasContent)
      : data !== "");
  if (
    value.resources?.some((resource) => {
      // This is the engine's transient local permission service, not document data.
      if (
        [
          "SHEET_DATA_VALIDATION_PLUGIN",
          "SHEET_FILTER_PLUGIN",
          "SHEET_AuthzIoMockService_PLUGIN",
        ].includes(resource.name)
      )
        return false;
      return !!resource.data && hasContent(JSON.parse(resource.data));
    })
  )
    warnings.add("Unsupported plugin metadata is not saved.");
  return {
    workbook: normalizeDocumentWorkbook(workbook),
    warnings: [...warnings],
  };
}
