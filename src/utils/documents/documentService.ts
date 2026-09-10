import type {
  DatabaseDocument,
  DatabaseDocuments,
  DatabaseDocumentStore,
  DocumentScope,
} from "../../types/documents/document";
import { generateId } from "../core/id";
import { normalizeDatabaseDocuments } from "./validation";

export function createEmptyDocument(
  name = "Untitled document",
  parentFolderId: string | null = null,
): DatabaseDocument {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    parentFolderId,
    name,
    icon: "file-text",
    createdAt: now,
    updatedAt: now,
    blocks: [],
  };
}
export function documentMetadata(data: DatabaseDocuments) {
  return data.documents.map(
    ({ id, parentFolderId, name, icon, createdAt, updatedAt }) => ({
      id,
      parentFolderId,
      name,
      icon,
      createdAt,
      updatedAt,
    }),
  );
}
export interface DocumentReview {
  scope: DocumentScope;
  receipt: string;
  data: DatabaseDocuments;
}
/** Receipt-bound UI service over the provider's durable, shared save queue. */
export function createDocumentService(
  getStore: () => DatabaseDocumentStore | undefined,
) {
  let generation = 0;
  const reviews = new Map<
    string,
    { scope: DocumentScope; expected: DatabaseDocuments }
  >();
  const current = (scope: DocumentScope) => {
    const store = getStore();
    if (
      !store?.scope ||
      store.scope.databaseId !== scope.databaseId ||
      store.scope.generation !== scope.generation
    )
      throw new Error(
        "The owning document database is unavailable. Reopen its protected database and review again.",
      );
    return store;
  };
  return {
    clear() {
      generation += 1;
      reviews.clear();
    },
    async read(scope: DocumentScope): Promise<DocumentReview> {
      const request = ++generation;
      const captured = { ...scope };
      const data = normalizeDatabaseDocuments(
        await current(captured).read(captured),
      );
      current(captured);
      if (request !== generation)
        throw new Error("Document review expired. Reload before continuing.");
      const receipt = generateId();
      // A UI instance keeps one private baseline, not many attachment-sized copies.
      reviews.clear();
      reviews.set(receipt, {
        scope: captured,
        expected: normalizeDatabaseDocuments(data),
      });
      return { scope: captured, receipt, data };
    },
    async apply(
      review: DocumentReview,
      replacement: DatabaseDocuments,
    ): Promise<void> {
      const saved = reviews.get(review.receipt);
      if (
        !saved ||
        saved.scope.databaseId !== review.scope.databaseId ||
        saved.scope.generation !== review.scope.generation ||
        JSON.stringify(saved.expected) !== JSON.stringify(review.data)
      )
        throw new Error(
          "Document review expired or changed. Reload before saving.",
        );
      const next = normalizeDatabaseDocuments(replacement);
      if (next.revision !== saved.expected.revision + 1)
        throw new Error("Invalid document revision.");
      // Single use even on failure: no silent retries against an uncertain write.
      reviews.delete(review.receipt);
      await current(saved.scope).compareAndSwap(
        saved.scope,
        saved.expected,
        next,
      );
      current(saved.scope);
    },
  };
}
