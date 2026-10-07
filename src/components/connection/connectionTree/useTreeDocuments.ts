import { useEffect, useRef, useState } from "react";
import { useConnections } from "../../../contexts/useConnections";
import type {
  DatabaseDocumentStore,
  DocumentScope,
} from "../../../types/documents/document";
import { documentMatchesSearch } from "../../../utils/documents/documentSearch";
import type { TreeDocumentMetadata } from "./documentTreeModel";

type MetadataStore = DatabaseDocumentStore & {
  readMetadata?: (scope: DocumentScope) => Promise<TreeDocumentMetadata[]>;
};
const EMPTY: TreeDocumentMetadata[] = [];
const sameOwner = (
  scope: DocumentScope | null | undefined,
  owner: DocumentScope,
) =>
  !!scope &&
  (scope.kind ?? "database") === "database" &&
  scope.databaseId === owner.databaseId &&
  scope.generation === owner.generation;

/** Read only the owning database. Drop stale responses and never retain document bodies. */
export function useTreeDocuments(
  enabled: boolean,
  query: string,
  fullText: boolean,
) {
  const { documents, databaseAvailability } = useConnections();
  const store = documents as MetadataStore | undefined;
  const revision = store?.changeRevision;
  const owner =
    databaseAvailability?.status === "ready" && databaseAvailability.databaseId
      ? {
          databaseId: databaseAvailability.databaseId,
          generation: databaseAvailability.generation,
        }
      : null;
  const key =
    enabled && owner && sameOwner(store?.scope, owner)
      ? JSON.stringify([
          owner.databaseId,
          owner.generation,
          store?.changeRevision,
        ])
      : "";
  const search = query.trim();
  const contentKey =
    key && fullText && search ? JSON.stringify([key, search]) : "";
  const latest = useRef({ key, contentKey, store });
  latest.current = { key, contentKey, store };
  const [metadata, setMetadata] = useState<{
    key: string;
    entries: TreeDocumentMetadata[];
    error: string;
  }>({ key: "", entries: EMPTY, error: "" });
  const [content, setContent] = useState<{
    key: string;
    matches: Set<string>;
    error: string;
  }>({ key: "", matches: new Set(), error: "" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!key || !owner) {
      setMetadata({ key: "", entries: EMPTY, error: "" });
      return;
    }
    let cancelled = false;
    const captured = { ...owner };
    const current = () =>
      !cancelled &&
      latest.current.key === key &&
      latest.current.store?.changeRevision === revision &&
      sameOwner(latest.current.store?.scope, captured);
    void (async () => {
      try {
        if (!store?.readMetadata) throw Error("Document metadata unavailable");
        const result = await store.readMetadata(captured);
        if (!current()) return;
        // Explicit projection protects the tree even if a provider returns extra fields.
        const entries = result.map(
          ({ id, name, icon, parentFolderId, blockTypes }) => ({
            id,
            name,
            icon,
            parentFolderId,
            blockTypes: [...blockTypes],
          }),
        );
        setMetadata({ key, entries, error: "" });
      } catch {
        if (current())
          setMetadata({
            key,
            entries: EMPTY,
            error:
              "Documents could not be loaded. Unlock the owning database and retry.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
    // The key binds the owner and its change revision; wrapper identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);

  useEffect(() => {
    if (!contentKey || !owner || !store) {
      setContent({ key: "", matches: new Set(), error: "" });
      return;
    }
    let cancelled = false;
    const captured = { ...owner };
    const current = () =>
      !cancelled &&
      latest.current.contentKey === contentKey &&
      latest.current.store?.changeRevision === revision &&
      sameOwner(latest.current.store?.scope, captured);
    const timer = setTimeout(() => {
      if (!current()) return;
      void store
        .read(captured)
        .then((data) => {
          if (!current()) return;
          const matches = new Set(
            data.documents
              .filter((document) =>
                documentMatchesSearch(document, search, true),
              )
              .map((document) => document.id),
          );
          setContent({ key: contentKey, matches, error: "" });
        })
        .catch(() => {
          if (current())
            setContent({
              key: contentKey,
              matches: new Set(),
              error:
                "Document content search is unavailable. Name matches are still shown.",
            });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, retry]);

  return {
    entries: key && metadata.key === key ? metadata.entries : EMPTY,
    scope: key ? owner : null,
    revision: key && metadata.key === key ? revision : undefined,
    contentMatches:
      contentKey && content.key === contentKey ? content.matches : undefined,
    loading: !!key && metadata.key !== key,
    searching: !!contentKey && content.key !== contentKey,
    error:
      key && metadata.key === key
        ? metadata.error || (content.key === contentKey ? content.error : "")
        : "",
    retry: () => setRetry((value) => value + 1),
  };
}
