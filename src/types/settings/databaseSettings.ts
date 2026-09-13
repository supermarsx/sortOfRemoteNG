import type { DocumentBlock } from "../documents/document";

/** Workspace content preferences, not encryption or trust policy. */
export type DatabaseDocumentType = DocumentBlock["type"] | "person" | "ticket";

/** Portable inside this database only; absent in old files means all enabled. */
export interface DatabaseSettings {
  version: 1;
  documentTypes: { disabled: DatabaseDocumentType[] };
}

export interface DatabaseSettingsScope {
  databaseId: string;
  generation: number;
}

export interface DatabaseSettingsApi {
  /** Same Provider owner epoch used by the document store. */
  scope: DatabaseSettingsScope | null;
  changeRevision: number;
  read(scope: DatabaseSettingsScope): Promise<DatabaseSettings>;
  compareAndSwap(
    scope: DatabaseSettingsScope,
    expected: DatabaseSettings,
    replacement: DatabaseSettings,
  ): Promise<void>;
}
