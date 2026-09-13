import type { DatabaseDocuments } from "../../types/documents/document";
import type {
  DatabaseDocumentType,
  DatabaseSettings,
} from "../../types/settings/databaseSettings";

export const DOCUMENT_TYPE_OPTIONS = [
  { type: "rich-text", label: "Rich text" },
  { type: "markdown", label: "Markdown" },
  { type: "note", label: "Notes" },
  { type: "spreadsheet", label: "Spreadsheets" },
  { type: "mermaid", label: "Diagrams" },
  { type: "wifi", label: "Wi-Fi credentials" },
  { type: "secret", label: "Secrets" },
  { type: "credential", label: "Login credentials" },
  { type: "email-account", label: "Email accounts" },
  { type: "identity", label: "Identity documents" },
  { type: "email", label: "Email addresses" },
  { type: "attachment", label: "Attachments" },
  { type: "reference", label: "References" },
  { type: "person", label: "People" },
  { type: "ticket", label: "Tickets" },
] as const satisfies ReadonlyArray<{
  type: DatabaseDocumentType;
  label: string;
}>;

const invalid = () =>
  new Error(
    "Database document-type settings are invalid. Reload or repair this database; no preferences were reset.",
  );
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
};

export function normalizeDatabaseSettings(value: unknown): DatabaseSettings {
  if (value === undefined)
    return { version: 1, documentTypes: { disabled: [] } };
  const source = record(value);
  if (
    source.version !== 1 ||
    Object.keys(source).some(
      (key) => !["version", "documentTypes"].includes(key),
    )
  )
    throw invalid();
  const types = record(source.documentTypes);
  if (
    Object.keys(types).some((key) => key !== "disabled") ||
    !Array.isArray(types.disabled) ||
    types.disabled.length > DOCUMENT_TYPE_OPTIONS.length
  )
    throw invalid();
  const disabled = new Set(types.disabled);
  if (
    disabled.size !== types.disabled.length ||
    types.disabled.some(
      (type) => !DOCUMENT_TYPE_OPTIONS.some((option) => option.type === type),
    )
  )
    throw invalid();
  return {
    version: 1,
    documentTypes: {
      disabled: DOCUMENT_TYPE_OPTIONS.filter((option) =>
        disabled.has(option.type),
      ).map((option) => option.type),
    },
  };
}

export function isDocumentTypeEnabled(
  settings: DatabaseSettings,
  type: DatabaseDocumentType,
): boolean {
  return !settings.documentTypes.disabled.includes(type);
}

/** Exact old record/block identity exempts existing content from creation limits. */
export function assertDocumentTypesAllowedForChange(
  settings: DatabaseSettings,
  current: DatabaseDocuments,
  replacement: DatabaseDocuments,
): void {
  const policy = normalizeDatabaseSettings(settings);
  const requireType = (type: DatabaseDocumentType) => {
    if (!isDocumentTypeEnabled(policy, type)) {
      const label = DOCUMENT_TYPE_OPTIONS.find(
        (option) => option.type === type,
      )!.label;
      throw new Error(
        `${label} are disabled for new content in this database. Enable the type in Settings → Current Database → Document types. Existing records remain editable.`,
      );
    }
  };
  const oldDocuments = new Map(
    current.documents.map((document) => [document.id, document]),
  );
  for (const document of replacement.documents) {
    if (
      !oldDocuments.has(document.id) &&
      document.blocks.length === 0 &&
      !DOCUMENT_TYPE_OPTIONS.some(
        (option) =>
          option.type !== "person" &&
          option.type !== "ticket" &&
          isDocumentTypeEnabled(policy, option.type),
      )
    )
      throw new Error(
        "All document types are disabled for new content in this database. Enable a type in Settings → Current Database before creating or importing a document.",
      );
    const blocks = new Map(
      oldDocuments
        .get(document.id)
        ?.blocks.map((block) => [block.id, block.type]),
    );
    for (const block of document.blocks)
      if (blocks.get(block.id) !== block.type) requireType(block.type);
  }
  for (const [type, oldRecords, newRecords] of [
    ["person", current.people, replacement.people],
    ["ticket", current.tickets, replacement.tickets],
    ["attachment", current.attachments, replacement.attachments],
  ] as const) {
    const ids = new Set(oldRecords.map((item) => item.id));
    if (newRecords.some((item) => !ids.has(item.id))) requireType(type);
  }
}
