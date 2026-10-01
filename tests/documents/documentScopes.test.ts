import { describe, expect, it } from "vitest";
import type {
  DocumentReference,
  DocumentRichTextNode,
} from "../../src/types/documents/document";
import { rebindDatabaseDocuments } from "../../src/utils/documents/documentRefs";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
  validateDocumentReference,
} from "../../src/utils/documents/validation";
import {
  appendDocumentArchive,
  exportDocumentArchive,
  importDocumentArchive,
} from "../../src/utils/documents/documentArchive";
import {
  fromEditorContent,
  toEditorContent,
} from "../../src/components/documents/richTextAdapter";
import {
  fromUniverWorkbook,
  toUniverWorkbook,
} from "../../src/utils/documents/spreadsheetUniverAdapter";
import {
  hasPendingDocumentDraft,
  registerDocumentDraft,
} from "../../src/utils/documents/documentDrafts";
import { fixture } from "./fixtures";

const owner = "app-wide-documents";
const appRef: DocumentReference = {
  scope: "app",
  databaseId: owner,
  kind: "document",
  id: "doc",
};
function scopedFixture() {
  const data = fixture();
  data.documents[0].parentFolderId = null;
  data.documents[0].blocks.push({
    id: "app-link",
    type: "reference",
    label: "App",
    reference: appRef,
  });
  const rich = data.documents[0].blocks.find(
    (block) => block.type === "rich-text",
  )!;
  rich.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "reference", reference: appRef }],
      },
    ],
  };
  const sheet = data.documents[0].blocks.find(
    (block) => block.type === "spreadsheet",
  )!;
  sheet.workbook.sheets[0].cells.A1.reference = {
    scope: "app",
    databaseId: owner,
    kind: "cell",
    id: "doc",
    blockId: "sheet",
    sheetId: "main",
    address: "A1",
  };
  data.people.push({
    id: "person",
    name: "App person",
    email: "",
    phone: "",
    organization: "",
    notes: "",
    references: [appRef],
    tags: [],
  });
  data.tickets.push({
    id: "ticket",
    title: "App ticket",
    status: "open",
    priority: "normal",
    description: "",
    references: [appRef],
    tags: [],
  });
  return data;
}

describe("document scope ownership", () => {
  it("preserves app reference scope in rich text, cells, people, tickets, and whole-database copies", () => {
    const data = scopedFixture();
    expect(normalizeDatabaseDocuments(data)).toEqual(data);
    expect(rebindDatabaseDocuments(data, owner, "new-database")).toEqual(data);
    const rich = data.documents[0].blocks.find(
      (block) => block.type === "rich-text",
    )!;
    expect(fromEditorContent(toEditorContent(rich.content))).toEqual(
      rich.content,
    );
    const sheet = data.documents[0].blocks.find(
      (block) => block.type === "spreadsheet",
    )!;
    expect(
      fromUniverWorkbook(toUniverWorkbook(sheet.workbook)).workbook.sheets[0]
        .cells.A1.reference,
    ).toEqual(sheet.workbook.sheets[0].cells.A1.reference);
  });

  it.each(["database", "other", null, 1])(
    "rejects invalid reference scope %j",
    (scope) => {
      expect(() => validateDocumentReference({ ...appRef, scope })).toThrow();
    },
  );

  it("roundtrips explicit app archive ownership and all reference forms", async () => {
    const data = scopedFixture();
    const password = "synthetic-scope-password";
    const payload = await exportDocumentArchive(data, owner, password, "app");
    const archive = await importDocumentArchive(payload, password);
    expect(archive).toMatchObject({ scope: "app", databaseId: owner, data });
    // A same-ID database reference remains foreign to the app archive.
    archive.data.people[0].references.push({
      databaseId: owner,
      kind: "document",
      id: "doc",
    });
    const result = appendDocumentArchive(
      emptyDatabaseDocuments(),
      archive,
      "db-b",
      "folder",
    );
    const document = result.documents[0];
    const expected = { databaseId: "db-b", kind: "document", id: document.id };
    expect(result.people[0].references).toEqual([
      expected,
      { databaseId: owner, kind: "document", id: "doc" },
    ]);
    expect(result.tickets[0].references).toEqual([expected]);
    expect(
      document.blocks.find((block) => block.type === "reference")!.reference,
    ).toEqual(expected);
    const rich: DocumentRichTextNode = document.blocks.find(
      (block) => block.type === "rich-text",
    )!.content;
    expect(rich.content?.[0].content?.[0].reference).toEqual(expected);
    const sheet = document.blocks.find(
      (block) => block.type === "spreadsheet",
    )!;
    expect(sheet.workbook.sheets[0].cells.A1.reference).toEqual({
      databaseId: "db-b",
      kind: "cell",
      id: document.id,
      blockId: "sheet",
      sheetId: "main",
      address: "A1",
    });
    expect(document.parentFolderId).toBe("folder");
    expect(data).toEqual(scopedFixture());
  });

  it("explicit database archive import adds app scope only to its own included records", () => {
    const data = scopedFixture();
    data.people[0].references.push({
      databaseId: owner,
      kind: "document",
      id: "doc",
    });
    const result = appendDocumentArchive(
      emptyDatabaseDocuments(),
      {
        format: "sorng-documents",
        version: 1,
        databaseId: owner,
        data,
      },
      owner,
      "not-an-app-folder",
      "app",
    );
    expect(result.documents[0].parentFolderId).toBeNull();
    expect(result.people[0].references).toEqual([
      appRef,
      {
        scope: "app",
        databaseId: owner,
        kind: "document",
        id: result.documents[0].id,
      },
    ]);
  });

  it("database draft checks ignore app drafts with a colliding owner ID", () => {
    const unregister = registerDocumentDraft("scope-test", () => ({
      databaseId: owner,
      scope: "app",
      dirty: true,
      busy: false,
      revision: 1,
    }));
    try {
      expect(hasPendingDocumentDraft(owner)).toBe(false);
      expect(hasPendingDocumentDraft(owner, "app")).toBe(true);
    } finally {
      unregister();
    }
  });
});
