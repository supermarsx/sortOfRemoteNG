import { describe, expect, it } from "vitest";
import type {
  DatabaseDocuments,
  DocumentBlock,
} from "../../src/types/documents/document";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { createEmptyDocument } from "../../src/utils/documents/documentService";
import {
  assertDocumentTypesAllowedForChange,
  DOCUMENT_TYPE_OPTIONS,
  normalizeDatabaseSettings,
} from "../../src/utils/documents/documentTypePolicy";
import { fixture } from "./fixtures";

describe("portable database document-type preferences", () => {
  it("defaults missing old-file preferences to all enabled without mutating the file", () => {
    expect(normalizeDatabaseSettings(undefined)).toEqual({
      version: 1,
      documentTypes: { disabled: [] },
    });
    expect(DOCUMENT_TYPE_OPTIONS).toHaveLength(15);
    expect(() =>
      assertDocumentTypesAllowedForChange(
        normalizeDatabaseSettings(undefined),
        emptyDatabaseDocuments(),
        fixture(),
      ),
    ).not.toThrow();
  });
  it.each([
    null,
    {},
    { version: 2, documentTypes: { disabled: [] } },
    { version: 1, documentTypes: { disabled: ["unknown"] } },
    { version: 1, documentTypes: { disabled: ["note", "note"] } },
    { version: 1, documentTypes: { disabled: "note" } },
    { version: 1, documentTypes: { disabled: [], global: true } },
    { version: 1, documentTypes: { disabled: [] }, trust: true },
  ])("rejects malformed policy instead of resetting defaults: %j", (input) => {
    expect(() => normalizeDatabaseSettings(input)).toThrow(
      /invalid.*no preferences were reset/,
    );
  });
  it.each(DOCUMENT_TYPE_OPTIONS)(
    "refuses new $type records or blocks",
    ({ type }) => {
      const settings = normalizeDatabaseSettings({
        version: 1,
        documentTypes: { disabled: [type] },
      });
      const replacement = emptyDatabaseDocuments();
      if (type === "person")
        replacement.people.push({
          id: "new-person",
        } as DatabaseDocuments["people"][number]);
      else if (type === "ticket")
        replacement.tickets.push({
          id: "new-ticket",
        } as DatabaseDocuments["tickets"][number]);
      else
        replacement.documents.push({
          ...createEmptyDocument(),
          blocks: [{ id: "new-block", type } as DocumentBlock],
        });
      expect(() =>
        assertDocumentTypesAllowedForChange(
          settings,
          emptyDatabaseDocuments(),
          replacement,
        ),
      ).toThrow(/disabled for new content/);
      // Editing data at the same record+block identity is still permitted.
      expect(() =>
        assertDocumentTypesAllowedForChange(
          settings,
          replacement,
          structuredClone(replacement),
        ),
      ).not.toThrow();
    },
  );
  it("allows edits, deletions and export of existing disabled data without rewriting its content", () => {
    const original = fixture(),
      edited = structuredClone(original);
    edited.documents[0].name = "Edited disabled document";
    const settings = normalizeDatabaseSettings({
      version: 1,
      documentTypes: {
        disabled: DOCUMENT_TYPE_OPTIONS.map(({ type }) => type),
      },
    });
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, original, edited),
    ).not.toThrow();
    expect(() =>
      assertDocumentTypesAllowedForChange(
        settings,
        original,
        emptyDatabaseDocuments(),
      ),
    ).not.toThrow();
    expect(original).toEqual(fixture());
    const imported = structuredClone(original);
    imported.documents[0].id = "new-imported-id";
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, original, imported),
    ).toThrow(/disabled/);
    const added = structuredClone(original);
    added.documents[0].blocks.push({
      id: "new-note",
      type: "note",
      text: "Note",
    });
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, original, added),
    ).toThrow(/disabled/);
  });
  it("blocks newly stored attachments even when an existing identity block references them", () => {
    const current = emptyDatabaseDocuments(),
      next = emptyDatabaseDocuments();
    next.attachments.push({
      id: "new-file",
    } as DatabaseDocuments["attachments"][number]);
    expect(() =>
      assertDocumentTypesAllowedForChange(
        { version: 1, documentTypes: { disabled: ["attachment"] } },
        current,
        next,
      ),
    ).toThrow(/Attachments/);
  });
  it("blocks new empty documents when all block types are off, not existing empties or independent people/tickets", () => {
    const current = emptyDatabaseDocuments(),
      next = emptyDatabaseDocuments();
    next.documents.push(createEmptyDocument());
    const settings = normalizeDatabaseSettings({
      version: 1,
      documentTypes: {
        disabled: DOCUMENT_TYPE_OPTIONS.filter(
          ({ type }) => type !== "person" && type !== "ticket",
        ).map(({ type }) => type),
      },
    });
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, current, next),
    ).toThrow(/All document types/);
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, next, next),
    ).not.toThrow();
    settings.documentTypes.disabled = settings.documentTypes.disabled.filter(
      (type) => type !== "attachment",
    );
    expect(() =>
      assertDocumentTypesAllowedForChange(settings, current, next),
    ).not.toThrow();
  });
});
