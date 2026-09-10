import type {
  DatabaseDocuments,
  DocumentReference,
} from "../../types/documents/document";

export const DOCUMENT_LIMITS = {
  documents: 1000,
  blocksPerDocument: 256,
  attachments: 256,
  attachmentBytes: 4 * 1024 * 1024,
  totalAttachmentBytes: 16 * 1024 * 1024,
  libraryBytes: 32 * 1024 * 1024,
  sheets: 16,
  rows: 10000,
  columns: 256,
  cells: 50000,
  entities: 2000,
} as const;
const invalid = (category = "document data") =>
  new Error(`Invalid or oversized ${category}. No document data was changed.`);
function record(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalid();
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(item, key))
  )
    throw invalid();
  return item;
}
function text(
  value: unknown,
  max = 4096,
  empty = true,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    value.includes("\0")
  )
    throw invalid();
}
function id(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    throw invalid("document identifier");
}
function sheetId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    throw invalid("spreadsheet sheet identifier");
}
function integer(
  value: unknown,
  min: number,
  max: number,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw invalid();
}
function bool(value: unknown): void {
  if (typeof value !== "boolean") throw invalid();
}
function choice(value: unknown, choices: readonly unknown[]): void {
  if (!choices.includes(value)) throw invalid();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function unique<T>(items: T[], key: (item: T) => unknown): void {
  if (new Set(items.map(key)).size !== items.length)
    throw invalid("duplicate document identifiers");
}
function dictionary(value: unknown, max: number): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length > max) throw invalid();
  return result;
}
export function validateDocumentReference(
  value: unknown,
): asserts value is DocumentReference {
  const ref = record(
    value,
    ["databaseId", "kind", "id", "blockId", "sheetId", "address"],
    ["databaseId", "kind", "id"],
  );
  id(ref.databaseId);
  id(ref.id);
  choice(ref.kind, ["document", "connection", "person", "ticket", "cell"]);
  if (ref.kind === "cell") {
    id(ref.blockId);
    sheetId(ref.sheetId);
    address(ref.address);
  } else if (["blockId", "sheetId", "address"].some((key) => key in ref))
    throw invalid();
}
export function documentCellCoordinates(value: string) {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,4})$/.exec(value);
  if (!match) throw invalid("cell address");
  const column =
    [...match[1]].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) -
    1;
  const row = Number(match[2]) - 1;
  if (column >= DOCUMENT_LIMITS.columns || row >= DOCUMENT_LIMITS.rows)
    throw invalid("cell address");
  return { row, column };
}
function address(value: unknown): asserts value is string {
  text(value, 10, false);
  documentCellCoordinates(value);
}
function safeLink(value: unknown): void {
  text(value, 2048, false);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid("document link");
  }
  if (
    !["https:", "http:", "mailto:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw invalid("document link");
}
function optionalHost(value: unknown): void {
  if (value === undefined || value === "") return;
  text(value, 253, false);
  try {
    const url = new URL(`https://${value}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.port ||
      /[\s\\/@?#]/.test(value)
    )
      throw invalid();
  } catch {
    throw invalid("mail server hostname");
  }
}
function calendarDate(value: unknown): void {
  text(value, 10);
  if (value === "") return;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw invalid("identity date");
}
const FUNCTIONS = new Set([
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "COUNTIF",
  "COUNTIFS",
  "SUMIF",
  "SUMIFS",
  "IF",
  "IFS",
  "IFERROR",
  "AND",
  "OR",
  "NOT",
  "TRUE",
  "FALSE",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "ABS",
  "MOD",
  "POWER",
  "SQRT",
  "INT",
  "CEILING",
  "FLOOR",
  "CONCAT",
  "CONCATENATE",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "LOWER",
  "UPPER",
  "TRIM",
  "SUBSTITUTE",
  "TEXT",
  "VALUE",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "TODAY",
  "NOW",
  "VLOOKUP",
  "HLOOKUP",
  "INDEX",
  "MATCH",
]);
/** Persist only local formulas; the renderer must still disable external engines/plugins. */
export function validateDocumentFormula(value: unknown): void {
  text(value, 4096, false);
  if (
    !value.startsWith("=") ||
    /[\[\]|\\]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    /(?:https?:|file:|data:|javascript:)/i.test(value)
  )
    throw invalid("local spreadsheet formula");
  for (const match of value.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g))
    if (!FUNCTIONS.has(match[1].toUpperCase()))
      throw invalid("unsupported spreadsheet formula");
}
function richText(
  value: unknown,
  depth: number,
  budget: { count: number },
): void {
  if (depth > 32 || ++budget.count > 20000) throw invalid("rich text");
  const node = record(
    value,
    ["type", "text", "marks", "content", "level", "reference"],
    ["type"],
  );
  choice(node.type, [
    "doc",
    "paragraph",
    "heading",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "codeBlock",
    "hardBreak",
    "horizontalRule",
    "reference",
  ]);
  if (node.type === "text") text(node.text, 128 * 1024);
  else if (node.text !== undefined) throw invalid();
  if (node.level !== undefined) {
    if (node.type !== "heading") throw invalid();
    integer(node.level, 1, 6);
  }
  if (node.type === "reference") validateDocumentReference(node.reference);
  else if (node.reference !== undefined) throw invalid();
  if (node.marks !== undefined)
    for (const item of list(node.marks, 6)) {
      const mark = record(item, ["type", "href"], ["type"]);
      choice(mark.type, [
        "bold",
        "italic",
        "underline",
        "strike",
        "code",
        "link",
      ]);
      if (mark.type === "link") safeLink(mark.href);
      else if (mark.href !== undefined) throw invalid();
    }
  if (node.content !== undefined)
    for (const child of list(node.content, 20000))
      richText(child, depth + 1, budget);
}
function workbook(value: unknown, cellBudget: { count: number }): void {
  const book = record(value, ["version", "sheets", "styles", "validations"]);
  if (book.version !== 1) throw invalid("spreadsheet version");
  const styles = dictionary(book.styles, 2048),
    validations = dictionary(book.validations, 2048);
  for (const [key, value] of Object.entries(styles)) {
    id(key);
    const style = record(
      value,
      [
        "fontFamily",
        "fontSize",
        "bold",
        "italic",
        "underline",
        "strike",
        "color",
        "background",
        "horizontal",
        "vertical",
        "wrap",
        "numberFormat",
        "border",
      ],
      [],
    );
    if (style.fontFamily !== undefined)
      choice(style.fontFamily, ["sans-serif", "serif", "monospace"]);
    if (style.fontSize !== undefined) integer(style.fontSize, 4, 72);
    for (const key of ["bold", "italic", "underline", "strike", "wrap"])
      if (style[key] !== undefined) bool(style[key]);
    for (const key of ["color", "background"])
      if (
        style[key] !== undefined &&
        (typeof style[key] !== "string" ||
          !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(style[key] as string))
      )
        throw invalid("cell color");
    if (style.horizontal !== undefined)
      choice(style.horizontal, ["left", "center", "right"]);
    if (style.vertical !== undefined)
      choice(style.vertical, ["top", "middle", "bottom"]);
    if (style.numberFormat !== undefined) text(style.numberFormat, 128);
    if (style.border !== undefined) {
      const border = record(style.border, ["color", "style"]);
      if (
        typeof border.color !== "string" ||
        !/^#[a-fA-F0-9]{6}$/.test(border.color)
      )
        throw invalid();
      choice(border.style, ["thin", "medium", "thick", "dashed", "dotted"]);
    }
  }
  for (const [key, value] of Object.entries(validations)) {
    id(key);
    const rule = record(
      value,
      ["type", "operator", "values", "allowBlank"],
      ["type", "values", "allowBlank"],
    );
    choice(rule.type, ["list", "number", "date", "text-length"]);
    bool(rule.allowBlank);
    if (rule.operator !== undefined)
      choice(rule.operator, ["between", "equal", "greater", "less"]);
    for (const item of list(rule.values, 1000)) {
      if (typeof item === "number") {
        if (!Number.isFinite(item)) throw invalid();
      } else text(item, 4096);
    }
  }
  const sheets = list(book.sheets, DOCUMENT_LIMITS.sheets);
  if (!sheets.length) throw invalid("empty workbook");
  unique(sheets, (sheet) => (sheet as Record<string, unknown>)?.id);
  for (const value of sheets) {
    const sheet = record(
      value,
      [
        "id",
        "name",
        "rows",
        "columns",
        "cells",
        "merges",
        "rowMetadata",
        "columnMetadata",
        "freeze",
        "filter",
      ],
      [
        "id",
        "name",
        "rows",
        "columns",
        "cells",
        "merges",
        "rowMetadata",
        "columnMetadata",
      ],
    );
    sheetId(sheet.id);
    text(sheet.name, 64, false);
    integer(sheet.rows, 1, DOCUMENT_LIMITS.rows);
    integer(sheet.columns, 1, DOCUMENT_LIMITS.columns);
    if (sheet.filter !== undefined) {
      const filter = record(sheet.filter, ["range", "columns"]);
      const range = record(filter.range, [
        "startRow",
        "startColumn",
        "endRow",
        "endColumn",
      ]);
      integer(range.startRow, 0, sheet.rows - 1);
      integer(range.endRow, range.startRow, sheet.rows - 1);
      integer(range.startColumn, 0, sheet.columns - 1);
      integer(range.endColumn, range.startColumn, sheet.columns - 1);
      const columns = list(filter.columns, sheet.columns);
      unique(columns, (item) => (item as Record<string, unknown>)?.column);
      for (const entry of columns) {
        const column = record(
          entry,
          ["column", "values", "includeBlank", "conditions", "matchAll"],
          ["column"],
        );
        integer(column.column, range.startColumn, range.endColumn);
        if (column.values !== undefined)
          for (const value of list(column.values, 1000)) text(value, 4096);
        if (column.includeBlank !== undefined) bool(column.includeBlank);
        if (column.matchAll !== undefined) bool(column.matchAll);
        if (column.conditions !== undefined)
          for (const item of list(column.conditions, 2)) {
            const condition = record(item, ["operator", "value"]);
            choice(condition.operator, [
              "equal",
              "notEqual",
              "greaterThan",
              "greaterThanOrEqual",
              "lessThan",
              "lessThanOrEqual",
            ]);
            if (typeof condition.value === "number") {
              if (!Number.isFinite(condition.value)) throw invalid();
            } else text(condition.value, 4096);
          }
      }
    }
    for (const [key, value] of Object.entries(
      dictionary(sheet.cells, DOCUMENT_LIMITS.cells),
    )) {
      if (++cellBudget.count > DOCUMENT_LIMITS.cells)
        throw invalid("spreadsheet cell count");
      const pos = documentCellCoordinates(key);
      if (pos.row >= sheet.rows || pos.column >= sheet.columns)
        throw invalid("out-of-range cell");
      const cell = record(
        value,
        ["value", "formula", "styleId", "validationId", "reference", "note"],
        ["value"],
      );
      if (typeof cell.value === "number") {
        if (!Number.isFinite(cell.value)) throw invalid();
      } else if (typeof cell.value !== "boolean" && cell.value !== null)
        text(cell.value, 32768);
      if (cell.formula !== undefined) validateDocumentFormula(cell.formula);
      if (cell.styleId !== undefined) {
        id(cell.styleId);
        if (!Object.prototype.hasOwnProperty.call(styles, cell.styleId))
          throw invalid("missing cell style");
      }
      if (cell.validationId !== undefined) {
        id(cell.validationId);
        if (
          !Object.prototype.hasOwnProperty.call(validations, cell.validationId)
        )
          throw invalid("missing cell validation");
      }
      if (cell.reference !== undefined)
        validateDocumentReference(cell.reference);
      if (cell.note !== undefined) text(cell.note, 4096);
    }
    for (const value of list(sheet.merges, 2048)) {
      const merge = record(value, [
        "startRow",
        "startColumn",
        "endRow",
        "endColumn",
      ]);
      integer(merge.startRow, 0, sheet.rows - 1);
      integer(merge.endRow, merge.startRow, sheet.rows - 1);
      integer(merge.startColumn, 0, sheet.columns - 1);
      integer(merge.endColumn, merge.startColumn, sheet.columns - 1);
    }
    for (const [axis, max] of [
      ["rowMetadata", sheet.rows],
      ["columnMetadata", sheet.columns],
    ] as const)
      for (const [key, value] of Object.entries(dictionary(sheet[axis], max))) {
        if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= max)
          throw invalid();
        const meta = record(value, ["size", "hidden"], []);
        if (meta.size !== undefined) integer(meta.size, 1, 4096);
        if (meta.hidden !== undefined) bool(meta.hidden);
      }
    if (sheet.freeze !== undefined) {
      const freeze = record(sheet.freeze, ["rows", "columns"]);
      integer(freeze.rows, 0, sheet.rows);
      integer(freeze.columns, 0, sheet.columns);
    }
  }
}
export function emptyDatabaseDocuments(): DatabaseDocuments {
  return {
    version: 1,
    revision: 0,
    documents: [],
    attachments: [],
    people: [],
    tickets: [],
  };
}
export function normalizeDatabaseDocuments(value: unknown): DatabaseDocuments {
  if (value === undefined) return emptyDatabaseDocuments();
  const data = record(value, [
    "version",
    "revision",
    "documents",
    "attachments",
    "people",
    "tickets",
  ]);
  if (data.version !== 1) throw invalid("document version");
  integer(data.revision, 0, Number.MAX_SAFE_INTEGER);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw invalid();
  }
  if (
    new TextEncoder().encode(encoded).byteLength > DOCUMENT_LIMITS.libraryBytes
  )
    throw invalid("document library size");
  const attachments = list(data.attachments, DOCUMENT_LIMITS.attachments);
  unique(attachments, (value) => (value as Record<string, unknown>)?.id);
  let attachmentBytes = 0;
  for (const value of attachments) {
    const item = record(value, [
      "id",
      "name",
      "mimeType",
      "size",
      "sha256",
      "dataBase64",
    ]);
    id(item.id);
    text(item.name, 256, false);
    choice(item.mimeType, [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/markdown",
    ]);
    integer(item.size, 0, DOCUMENT_LIMITS.attachmentBytes);
    attachmentBytes += item.size;
    if (
      attachmentBytes > DOCUMENT_LIMITS.totalAttachmentBytes ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      typeof item.dataBase64 !== "string" ||
      item.dataBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(item.dataBase64)
    )
      throw invalid("attachment");
    const decodedSize =
      (item.dataBase64.length / 4) * 3 -
      (item.dataBase64.endsWith("==")
        ? 2
        : item.dataBase64.endsWith("=")
          ? 1
          : 0);
    if (decodedSize !== item.size) throw invalid("attachment size");
  }
  const attachmentIds = new Set(
    attachments.map((item) => (item as Record<string, unknown>).id),
  );
  const documents = list(data.documents, DOCUMENT_LIMITS.documents);
  unique(documents, (value) => (value as Record<string, unknown>)?.id);
  const textBudget = { count: 0 },
    cellBudget = { count: 0 };
  for (const value of documents) {
    const doc = record(value, [
      "id",
      "parentFolderId",
      "name",
      "icon",
      "createdAt",
      "updatedAt",
      "blocks",
    ]);
    id(doc.id);
    if (doc.parentFolderId !== null) id(doc.parentFolderId);
    text(doc.name, 256, false);
    id(doc.icon);
    for (const key of ["createdAt", "updatedAt"]) {
      text(doc[key], 32, false);
      if (
        !/^\d{4}-\d\d-\d\dT/.test(doc[key] as string) ||
        !Number.isFinite(Date.parse(doc[key] as string))
      )
        throw invalid("document timestamp");
    }
    const blocks = list(doc.blocks, DOCUMENT_LIMITS.blocksPerDocument);
    unique(blocks, (value) => (value as Record<string, unknown>)?.id);
    for (const value of blocks) {
      const base = record(
        value,
        [
          "id",
          "type",
          "content",
          "text",
          "ssid",
          "password",
          "authentication",
          "hidden",
          "label",
          "value",
          "address",
          "attachmentId",
          "caption",
          "reference",
          "workbook",
          "username",
          "url",
          "notes",
          "imapHost",
          "imapPort",
          "smtpHost",
          "smtpPort",
          "tls",
          "documentType",
          "holderName",
          "idNumber",
          "country",
          "issueDate",
          "expiryDate",
          "attachmentIds",
        ],
        ["id", "type"],
      );
      id(base.id);
      const fields: Record<string, string[]> = {
        "rich-text": ["content"],
        markdown: ["text"],
        mermaid: ["text"],
        note: ["text"],
        wifi: ["ssid", "password", "authentication", "hidden"],
        secret: ["label", "value"],
        credential: ["label", "username", "password", "url", "notes"],
        "email-account": [
          "address",
          "username",
          "password",
          "imapHost",
          "imapPort",
          "smtpHost",
          "smtpPort",
          "tls",
        ],
        identity: [
          "documentType",
          "holderName",
          "idNumber",
          "country",
          "issueDate",
          "expiryDate",
          "attachmentIds",
        ],
        email: ["address", "label"],
        attachment: ["attachmentId", "caption"],
        reference: ["reference", "label"],
        spreadsheet: ["workbook"],
      };
      if (
        typeof base.type !== "string" ||
        !Object.prototype.hasOwnProperty.call(fields, base.type)
      )
        throw invalid("document block type");
      const keys = ["id", "type", ...fields[base.type]];
      const block = record(
        value,
        keys,
        base.type === "email-account"
          ? keys.filter(
              (key) =>
                !["imapHost", "imapPort", "smtpHost", "smtpPort"].includes(key),
            )
          : keys,
      );
      switch (block.type) {
        case "rich-text":
          richText(block.content, 0, textBudget);
          break;
        case "markdown":
        case "mermaid":
        case "note":
          text(block.text, 128 * 1024);
          break;
        case "wifi":
          text(block.ssid, 128);
          text(block.password, 4096);
          choice(block.authentication, ["WPA", "WEP", "nopass"]);
          bool(block.hidden);
          break;
        case "secret":
          text(block.label, 256);
          text(block.value, 32768);
          break;
        case "credential":
          text(block.label, 256);
          text(block.username, 1024);
          text(block.password, 32768);
          text(block.notes, 32768);
          text(block.url, 2048);
          if (block.url) {
            safeLink(block.url);
            if (!/^https?:/i.test(block.url)) throw invalid("credential URL");
          }
          break;
        case "email-account":
          text(block.address, 320, false);
          if (!/^[^\s@]+@[^\s@]+$/.test(block.address))
            throw invalid("email address");
          text(block.username, 1024);
          text(block.password, 32768);
          bool(block.tls);
          optionalHost(block.imapHost);
          optionalHost(block.smtpHost);
          if (block.imapPort !== undefined) integer(block.imapPort, 1, 65535);
          if (block.smtpPort !== undefined) integer(block.smtpPort, 1, 65535);
          break;
        case "identity":
          text(block.documentType, 128);
          text(block.holderName, 256);
          text(block.idNumber, 256);
          text(block.country, 2);
          if (block.country && !/^[A-Z]{2}$/.test(block.country))
            throw invalid("country code");
          calendarDate(block.issueDate);
          calendarDate(block.expiryDate);
          for (const ref of list(block.attachmentIds, 16)) {
            id(ref);
            if (!attachmentIds.has(ref))
              throw invalid("missing identity attachment");
          }
          break;
        case "email":
          text(block.address, 320);
          text(block.label, 256);
          break;
        case "attachment":
          id(block.attachmentId);
          if (!attachmentIds.has(block.attachmentId))
            throw invalid("missing attachment");
          text(block.caption, 4096);
          break;
        case "reference":
          validateDocumentReference(block.reference);
          text(block.label, 256);
          break;
        case "spreadsheet":
          workbook(block.workbook, cellBudget);
          break;
      }
    }
  }
  for (const category of ["people", "tickets"] as const) {
    const entries = list(data[category], DOCUMENT_LIMITS.entities);
    unique(entries, (value) => (value as Record<string, unknown>)?.id);
    for (const value of entries) {
      const item =
        category === "people"
          ? record(value, [
              "id",
              "name",
              "email",
              "phone",
              "organization",
              "notes",
              "references",
            ])
          : record(value, [
              "id",
              "title",
              "status",
              "priority",
              "description",
              "references",
            ]);
      id(item.id);
      if (category === "people") {
        text(item.name, 256, false);
        text(item.email, 320);
        text(item.phone, 64);
        text(item.organization, 256);
        text(item.notes, 32768);
      } else {
        text(item.title, 256, false);
        choice(item.status, ["open", "in-progress", "resolved", "closed"]);
        choice(item.priority, ["low", "normal", "high", "urgent"]);
        text(item.description, 32768);
      }
      for (const ref of list(item.references, 128))
        validateDocumentReference(ref);
    }
  }
  return JSON.parse(encoded) as DatabaseDocuments;
}
