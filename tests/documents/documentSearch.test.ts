import { describe, expect, it } from "vitest";
import type {
  DatabaseDocument,
  DocumentBlock,
} from "../../src/types/documents/document";
import { documentMatchesSearch } from "../../src/utils/documents/documentSearch";
import { createEmptyDocument } from "../../src/utils/documents/documentService";

const document = (blocks: DocumentBlock[] = []): DatabaseDocument => ({
  ...createEmptyDocument("Network handover"),
  blocks,
});

describe("documentMatchesSearch", () => {
  it("matches trimmed, case-insensitive names and does not access blocks by default", () => {
    const value = document();
    Object.defineProperty(value, "blocks", {
      get() {
        throw Error("Body was accessed");
      },
    });
    expect(documentMatchesSearch(value, "  HANDOVER  ")).toBe(true);
    expect(documentMatchesSearch(value, "ordinary body")).toBe(false);
    expect(documentMatchesSearch(value, "  ")).toBe(true);
  });
  it.each(["note", "markdown", "mermaid"] as const)(
    "searches %s only after opting in",
    (type) => {
      const value = document([{ id: "text", type, text: "ordinary body" }]);
      expect(documentMatchesSearch(value, "ordinary body")).toBe(false);
      expect(documentMatchesSearch(value, "ordinary body", true)).toBe(true);
      expect(documentMatchesSearch(value, "ordinary body", false)).toBe(false);
    },
  );
  it("joins rich-text inline marks, without indexing reference IDs or link targets", () => {
    const value = document([
      {
        id: "rich",
        type: "rich-text",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Router ", marks: [{ type: "bold" }] },
                {
                  type: "text",
                  text: "handover",
                  marks: [
                    { type: "link", href: "https://hidden-target.example" },
                  ],
                },
                {
                  type: "reference",
                  reference: {
                    kind: "document",
                    databaseId: "private-owner",
                    id: "private-target",
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(documentMatchesSearch(value, "router handover", true)).toBe(true);
    for (const query of ["hidden-target", "private-owner", "private-target"])
      expect(documentMatchesSearch(value, query, true)).toBe(false);
  });
  it("searches sheet names, literal values, notes and formula text without executing anything", () => {
    const value = document([
      {
        id: "sheet",
        type: "spreadsheet",
        workbook: {
          version: 1,
          styles: {},
          validations: {},
          sheets: [
            {
              id: "private-sheet-id",
              name: "Inventory",
              rows: 2,
              columns: 3,
              merges: [],
              rowMetadata: {},
              columnMetadata: {},
              cells: {
                A1: { value: "Router" },
                B1: { value: 1729 },
                C1: { value: true },
                A2: {
                  value: null,
                  formula: "=SUM(B1:B2)",
                  note: "Budget note",
                },
              },
            },
          ],
        },
      },
    ]);
    for (const query of [
      "inventory",
      "router",
      "1729",
      "true",
      "sum(b1:b2)",
      "budget note",
    ])
      expect(documentMatchesSearch(value, query, true)).toBe(true);
    expect(documentMatchesSearch(value, "private-sheet-id", true)).toBe(false);
    expect(documentMatchesSearch(value, "1729", false)).toBe(false);
  });
  it("allows labels and captions while excluding all structured private fields", () => {
    const privateValue = "never-index-this";
    const value = document([
      {
        id: "secret",
        type: "secret",
        label: "Recovery label",
        value: privateValue,
      },
      {
        id: "credential",
        type: "credential",
        label: "Login label",
        username: privateValue,
        password: privateValue,
        url: privateValue,
        notes: privateValue,
      },
      {
        id: "wifi",
        type: "wifi",
        ssid: "Office network",
        password: privateValue,
        authentication: "WPA",
        hidden: false,
      },
      {
        id: "account",
        type: "email-account",
        address: privateValue,
        username: privateValue,
        password: privateValue,
        imapHost: privateValue,
        smtpHost: privateValue,
        tls: true,
      },
      {
        id: "identity",
        type: "identity",
        documentType: privateValue,
        holderName: privateValue,
        idNumber: privateValue,
        country: privateValue,
        issueDate: privateValue,
        expiryDate: privateValue,
        attachmentIds: [privateValue],
      },
      {
        id: "email",
        type: "email",
        label: "Contact label",
        address: privateValue,
      },
      {
        id: "attachment",
        type: "attachment",
        caption: "Rack photo",
        attachmentId: privateValue,
      },
      {
        id: "reference",
        type: "reference",
        label: "Runbook link",
        reference: {
          kind: "document",
          databaseId: privateValue,
          id: privateValue,
        },
      },
    ]);
    expect(documentMatchesSearch(value, privateValue, true)).toBe(false);
    expect(documentMatchesSearch(value, "redacted", true)).toBe(false);
    for (const query of [
      "recovery label",
      "login label",
      "office network",
      "contact label",
      "rack photo",
      "runbook link",
    ])
      expect(documentMatchesSearch(value, query, true)).toBe(true);
  });
  it("preserves literal redaction text in names and prose without joining surrounding words", () => {
    const named = { ...document(), name: "before[REDACTED]after" };
    expect(documentMatchesSearch(named, "[redacted]")).toBe(true);
    expect(documentMatchesSearch(named, "beforeafter")).toBe(false);
    const prose = document([
      { id: "note", type: "note", text: "before[REDACTED]after" },
    ]);
    expect(documentMatchesSearch(prose, "[redacted]")).toBe(false);
    expect(documentMatchesSearch(prose, "[redacted]", true)).toBe(true);
    expect(documentMatchesSearch(prose, "beforeafter", true)).toBe(false);
  });
  it("searches literal secret labels without ever reading secret values", () => {
    const block: DocumentBlock = {
      id: "s",
      type: "secret",
      label: "[REDACTED]",
      value: "",
    };
    Object.defineProperty(block, "value", {
      get() {
        throw Error("Secret was accessed");
      },
    });
    expect(documentMatchesSearch(document([block]), "redacted", true)).toBe(
      true,
    );
    expect(documentMatchesSearch(document([block]), "unrelated", true)).toBe(
      false,
    );
  });
});
