import { useEffect, useMemo, useReducer, useRef } from "react";
import type {
  DatabaseDocument,
  DocumentAttachment,
} from "../../types/documents/document";
import {
  createDocumentEditHistory,
  documentEditSnapshot,
  type DocumentEditSnapshot,
} from "../../utils/documents/documentEditHistory";

export function useDocumentEditHistory(options: {
  ownerKey: string;
  document?: DatabaseDocument;
  attachments?: DocumentAttachment[];
  dirty: boolean;
  disabled: boolean;
  stale: boolean;
  apply: (snapshot: DocumentEditSnapshot) => boolean;
}) {
  const session = useMemo(
    () => ({
      ownerKey: options.ownerKey,
      history: createDocumentEditHistory(),
    }),
    [options.ownerKey],
  );
  const { history } = session;
  const latest = useRef(options);
  latest.current = options;
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => () => history.clear(), [history]);
  useEffect(() => {
    if (!options.document || !options.ownerKey || options.stale)
      history.clear();
    else
      history.observe(
        documentEditSnapshot(options.document, options.attachments ?? []),
        options.dirty,
      );
    refresh();
  }, [
    history,
    options.document,
    options.attachments,
    options.dirty,
    options.ownerKey,
    options.stale,
  ]);
  const step = (direction: "undo" | "redo", count = 1) => {
    const current = latest.current;
    if (
      current.ownerKey !== options.ownerKey ||
      current.disabled ||
      current.stale ||
      !current.document
    )
      return;
    // Reconcile the most recent render before using any reviewed step.
    history.observe(
      documentEditSnapshot(current.document, current.attachments ?? []),
      current.dirty,
    );
    if (history.restore(direction, count, current.apply)) refresh();
  };
  return { ...history.view, step };
}
