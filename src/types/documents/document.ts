/** Database-owned data only. These records are never executable HTML or code. */
export type DocumentReference =
  | {
      databaseId: string;
      kind: "document" | "connection" | "person" | "ticket";
      id: string;
    }
  | {
      databaseId: string;
      kind: "cell";
      id: string;
      blockId: string;
      sheetId: string;
      address: string;
    };

export interface DocumentTextMark {
  type: "bold" | "italic" | "underline" | "strike" | "code" | "link";
  /** Links allow only http(s)/mailto; no target, event handlers or raw HTML. */
  href?: string;
}
export interface DocumentRichTextNode {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "text"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "blockquote"
    | "codeBlock"
    | "hardBreak"
    | "horizontalRule"
    | "reference";
  text?: string;
  marks?: DocumentTextMark[];
  content?: DocumentRichTextNode[];
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  reference?: DocumentReference;
}
export interface DocumentCellStyle {
  fontFamily?: "sans-serif" | "serif" | "monospace";
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "middle" | "bottom";
  wrap?: boolean;
  numberFormat?: string;
  border?: {
    color: string;
    style: "thin" | "medium" | "thick" | "dashed" | "dotted";
  };
}
export interface DocumentCellValidation {
  type: "list" | "number" | "date" | "text-length";
  operator?: "between" | "equal" | "greater" | "less";
  values: Array<string | number>;
  allowBlank: boolean;
}
export interface DocumentSpreadsheetCell {
  value: string | number | boolean | null;
  /** Local allowlisted formulas only; never DDE, URLs, scripts or external data. */
  formula?: string;
  styleId?: string;
  validationId?: string;
  reference?: DocumentReference;
  note?: string;
}
export interface DocumentSpreadsheetSheet {
  id: string;
  name: string;
  rows: number;
  columns: number;
  filter?: {
    range: {
      startRow: number;
      startColumn: number;
      endRow: number;
      endColumn: number;
    };
    columns: Array<{
      column: number;
      values?: string[];
      includeBlank?: boolean;
      conditions?: Array<{
        operator:
          | "equal"
          | "notEqual"
          | "greaterThan"
          | "greaterThanOrEqual"
          | "lessThan"
          | "lessThanOrEqual";
        value: string | number;
      }>;
      matchAll?: boolean;
    }>;
  };
  cells: Record<string, DocumentSpreadsheetCell>;
  merges: Array<{
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
  }>;
  rowMetadata: Record<string, { size?: number; hidden?: boolean }>;
  columnMetadata: Record<string, { size?: number; hidden?: boolean }>;
  freeze?: { rows: number; columns: number };
}
export interface DocumentWorkbook {
  version: 1;
  sheets: DocumentSpreadsheetSheet[];
  styles: Record<string, DocumentCellStyle>;
  validations: Record<string, DocumentCellValidation>;
}
export type DocumentBlock = { id: string } & (
  | { type: "rich-text"; content: DocumentRichTextNode }
  | { type: "markdown" | "mermaid" | "note"; text: string }
  | {
      type: "wifi";
      ssid: string;
      password: string;
      authentication: "WPA" | "WEP" | "nopass";
      hidden: boolean;
    }
  | { type: "secret"; label: string; value: string }
  | {
      type: "credential";
      label: string;
      username: string;
      password: string;
      url: string;
      notes: string;
    }
  | {
      type: "email-account";
      address: string;
      username: string;
      password: string;
      imapHost?: string;
      imapPort?: number;
      smtpHost?: string;
      smtpPort?: number;
      tls: boolean;
    }
  | {
      type: "identity";
      documentType: string;
      holderName: string;
      idNumber: string;
      country: string;
      issueDate: string;
      expiryDate: string;
      attachmentIds: string[];
    }
  | { type: "email"; address: string; label: string }
  | { type: "attachment"; attachmentId: string; caption: string }
  | { type: "reference"; reference: DocumentReference; label: string }
  | { type: "spreadsheet"; workbook: DocumentWorkbook }
);
export interface DatabaseDocument {
  id: string;
  /** Existing connection folder ID; null places the document at database root. */
  parentFolderId: string | null;
  name: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
  blocks: DocumentBlock[];
}
export interface DocumentAttachment {
  id: string;
  name: string;
  mimeType:
    | "image/png"
    | "image/jpeg"
    | "image/webp"
    | "application/pdf"
    | "text/plain"
    | "text/markdown";
  size: number;
  sha256: string;
  /** Protected inside the same database envelope; no plaintext sidecar path. */
  dataBase64: string;
}
export interface DocumentPerson {
  id: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  notes: string;
  references: DocumentReference[];
}
export interface DocumentTicket {
  id: string;
  title: string;
  status: "open" | "in-progress" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  description: string;
  references: DocumentReference[];
}
export interface DatabaseDocuments {
  version: 1;
  revision: number;
  documents: DatabaseDocument[];
  attachments: DocumentAttachment[];
  people: DocumentPerson[];
  tickets: DocumentTicket[];
}
export interface DocumentScope {
  databaseId: string;
  generation: number;
}
/** Provider-owned, native managed-database persistence; never browser fallback. */
export interface DatabaseDocumentStore {
  scope: DocumentScope | null;
  changeRevision: number;
  read(scope: DocumentScope): Promise<DatabaseDocuments>;
  compareAndSwap(
    scope: DocumentScope,
    expected: DatabaseDocuments,
    replacement: DatabaseDocuments,
  ): Promise<void>;
}
