import { useEffect, useRef, useState } from "react";
import type { DatabaseDocument } from "../../types/documents/document";
import {
  createDocumentSearchBackend,
  type DocumentSearchBackend,
} from "../../utils/documents/documentSearchClient";

/**
 * Off-main-thread full-text matching for large libraries. Returns the ids that
 * matched the latest completed query, or null when the caller should scan inline
 * (small library, no query, no Worker, jsdom). Results never outlive the
 * document array they were computed from.
 */
export function useDocumentSearchMatches(
  documents: readonly DatabaseDocument[] | undefined,
  query: string,
  fullText: boolean,
): ReadonlySet<string> | null {
  const backend = useRef<{
    owner: readonly DatabaseDocument[];
    value: DocumentSearchBackend;
  } | null>(null);
  const [result, setResult] = useState<{
    owner: readonly DatabaseDocument[];
    ids: ReadonlySet<string>;
  } | null>(null);
  useEffect(
    () => () => {
      backend.current?.value.dispose();
      backend.current = null;
    },
    [],
  );
  useEffect(() => {
    const trimmed = query.trim();
    if (!documents || !fullText || !trimmed) {
      setResult(null);
      return;
    }
    if (backend.current?.owner !== documents) {
      backend.current?.value.dispose();
      backend.current = {
        owner: documents,
        value: createDocumentSearchBackend(documents),
      };
    }
    const active = backend.current.value;
    if (active.kind === "inline") {
      setResult(null);
      return;
    }
    let cancelled = false;
    void active.search(documents, trimmed, true).then((ids) => {
      if (!cancelled) setResult({ owner: documents, ids });
    });
    return () => {
      cancelled = true;
    };
  }, [documents, query, fullText]);
  return result && result.owner === documents ? result.ids : null;
}
