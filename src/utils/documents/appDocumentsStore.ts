import type {
  DatabaseDocuments,
  DatabaseDocumentStore,
  DocumentScope,
} from "../../types/documents/document";
import {
  AppDataJsonStore,
  sanitizeWithRecordMetadata,
} from "../storage/appDataJsonStore";
import {
  assertMacroLibraryReadAccess,
  readAppDataWhenReady,
  type MacroLibraryReadAccess,
} from "../storage/macroLibraryReadRecovery";
import type { RecordLedger } from "../storage/recordLedger";
import { getInvoke } from "../tauri/invoke";
import { verifyDocumentAttachments } from "./documentAttachments";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "./validation";

export const APP_DOCUMENTS_OWNER_ID = "app-wide-documents";
export const APP_DOCUMENTS_STORE_KEY = "documents.app-wide.v1";

function sanitizeDocuments(value: unknown) {
  const data = normalizeDatabaseDocuments(value);
  if (data.documents.some((document) => document.parentFolderId !== null))
    throw new Error("App-wide documents cannot belong to connection folders.");
  return {
    value: data,
    changed: JSON.stringify(value) !== JSON.stringify(data),
  };
}

/** The standard store validates/preserves the ledger outside the domain schema. */
function domainSnapshot(value: unknown): DatabaseDocuments {
  const snapshot = sanitizeWithRecordMetadata(value, sanitizeDocuments)
    .value as DatabaseDocuments & { recordMetadata?: RecordLedger };
  const { recordMetadata: _metadata, ...data } = snapshot;
  return data;
}

// Generic app-data follows the existing app storage policy. This is not an
// independently encrypted database, and there is no legacy migration source.
export const appDocumentsStore = new AppDataJsonStore<DatabaseDocuments>({
  key: APP_DOCUMENTS_STORE_KEY,
  backend: "app-data",
  requireNative: true,
  trackRecords: true,
  sanitize: sanitizeDocuments,
});

export interface AppDocumentsAccess extends MacroLibraryReadAccess {
  generation: number;
}

/** Bind one desktop/settings access epoch; its caller revokes it on lock/cleanup. */
export function createAppDocumentsStore(
  access: AppDocumentsAccess,
): DatabaseDocumentStore {
  if (!Number.isSafeInteger(access.generation) || access.generation < 0)
    throw new Error("Invalid app-wide document access epoch.");
  const owner: DocumentScope = Object.freeze({
    kind: "app",
    databaseId: APP_DOCUMENTS_OWNER_ID,
    generation: access.generation,
  });
  const assertScope = (requested: DocumentScope) => {
    assertMacroLibraryReadAccess(access);
    if (
      requested.kind !== "app" ||
      requested.databaseId !== owner.databaseId ||
      requested.generation !== owner.generation
    )
      throw new Error(
        "App-wide document access changed. Reload before continuing.",
      );
  };
  let changeRevision = 0;
  return {
    get scope() {
      try {
        assertScope(owner);
        return { ...owner };
      } catch {
        return null;
      }
    },
    get changeRevision() {
      return changeRevision;
    },
    async read(requested) {
      const captured = { ...requested };
      assertScope(captured);
      const invoke = await getInvoke();
      assertScope(captured);
      if (!invoke)
        throw new Error("App-wide documents require the native desktop app.");
      // load() performs durable normalization/ledger migration. Reviews must
      // never write, including when this library is absent or predates a ledger.
      const raw = await readAppDataWhenReady(
        invoke,
        APP_DOCUMENTS_STORE_KEY,
        access,
      );
      assertScope(captured);
      let parsed: unknown;
      if (raw !== null) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error(
            "Invalid app-wide document storage. Existing data was retained.",
          );
        }
      }
      const data =
        raw === null ? emptyDatabaseDocuments() : domainSnapshot(parsed);
      await verifyDocumentAttachments(data);
      assertScope(captured);
      return data;
    },
    async compareAndSwap(requested, expected, replacement) {
      const captured = { ...requested };
      assertScope(captured);
      // Clone and validate before awaiting so caller edits cannot change the CAS.
      const reviewed = sanitizeDocuments(expected).value;
      const proposed = sanitizeDocuments(replacement).value;
      if (proposed.revision !== reviewed.revision + 1)
        throw new Error("Invalid document revision.");
      await verifyDocumentAttachments(proposed);
      assertScope(captured);
      let attempted = false;
      await appDocumentsStore.update((current) => {
        assertScope(captured);
        if (attempted)
          throw new Error(
            "Documents changed since this review. Reload before saving.",
          );
        attempted = true;
        const data =
          current === null ? emptyDatabaseDocuments() : domainSnapshot(current);
        if (JSON.stringify(data) !== JSON.stringify(reviewed))
          throw new Error(
            "Documents changed since this review. Reload before saving.",
          );
        // update() retains the current ledger, uses native CAS and verifies the
        // committed bytes. A refused CAS must never rebase a reviewed snapshot.
        return proposed;
      }, access);
      assertScope(captured);
      changeRevision += 1;
    },
  };
}
