import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useConnections } from "../../contexts/useConnections";
import { ToastContext } from "../../contexts/ToastContext";
import type {
  DatabaseDocuments,
  DocumentScope,
} from "../../types/documents/document";
import {
  createDocumentService,
  type DocumentReview,
} from "../../utils/documents/documentService";
import { normalizeDatabaseDocuments } from "../../utils/documents/validation";

/** Private drafts live only in this mounted, database-owned workspace. */
export function useDocumentsWorkspace(
  databaseId: string,
  hasPendingEditorChanges = false,
) {
  const { documents: store, databaseAvailability } = useConnections();
  const toast = useContext(ToastContext)?.toast;
  const storeRef = useRef(store);
  storeRef.current = store;
  const service = useMemo(
    () => createDocumentService(() => storeRef.current),
    [],
  );
  const scope = store?.scope;
  const accessKey =
    scope &&
    scope.databaseId === databaseId &&
    databaseAvailability?.status === "ready"
      ? `${scope.databaseId}:${scope.generation}`
      : "";
  const accessRef = useRef(accessKey);
  accessRef.current = accessKey;
  const mounted = useRef(false);
  const operation = useRef(0);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  // Editors can hold a private, not-yet-accepted review which is deliberately
  // absent from the serializable draft. It still must prevent background reload.
  const pendingEditorRef = useRef(hasPendingEditorChanges);
  pendingEditorRef.current = hasPendingEditorChanges;
  const reviewRef = useRef<DocumentReview | null>(null);
  const [draft, setDraft] = useState<DatabaseDocuments | null>(null);
  const [draftOwner, setDraftOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const scopeRef = useRef<DocumentScope | null>(null);
  scopeRef.current = scope && accessKey ? scope : null;

  const current = useCallback(
    (key: string, token: number) =>
      mounted.current &&
      !!key &&
      key === accessRef.current &&
      token === operation.current,
    [],
  );

  const reload = useCallback(async () => {
    const captured = scopeRef.current;
    const key = accessRef.current;
    if (!captured || !key || busyRef.current) return;
    const token = ++operation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      service.clear();
      const next = await service.read(captured);
      if (!current(key, token)) return;
      reviewRef.current = next;
      setDraft(structuredClone(next.data));
      setDraftOwner(key);
      dirtyRef.current = false;
      setDirty(false);
      setStale(false);
    } catch (cause) {
      if (current(key, token))
        setError(
          cause instanceof Error
            ? cause.message
            : "The document library could not be read. Reopen its protected database and retry.",
        );
    } finally {
      if (current(key, token)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [current, service]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // This is an operation counter, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++operation.current;
      service.clear();
      reviewRef.current = null;
    };
  }, [service]);

  useEffect(() => {
    ++operation.current;
    service.clear();
    reviewRef.current = null;
    busyRef.current = false;
    dirtyRef.current = false;
    setDraft(null);
    setDraftOwner("");
    setDirty(false);
    setBusy(false);
    setStale(false);
    setError("");
    if (accessKey) void reload();
  }, [accessKey, reload, service]);

  const lastRevision = useRef(store?.changeRevision);
  useEffect(() => {
    if (lastRevision.current === store?.changeRevision) return;
    lastRevision.current = store?.changeRevision;
    if (busyRef.current) return;
    if (dirtyRef.current || pendingEditorRef.current) setStale(true);
    else void reload();
  }, [store?.changeRevision, reload]);

  const update = useCallback(
    (change: (data: DatabaseDocuments) => DatabaseDocuments) => {
      if (!accessRef.current || busyRef.current || !reviewRef.current) return;
      dirtyRef.current = true;
      setDirty(true);
      setDraft((previous) =>
        previous ? change(structuredClone(previous)) : previous,
      );
    },
    [],
  );

  const save = async () => {
    const review = reviewRef.current;
    const key = accessRef.current;
    if (
      !review ||
      !draft ||
      draftOwner !== key ||
      !key ||
      busyRef.current ||
      pendingEditorRef.current ||
      !dirtyRef.current
    )
      return false;
    const token = ++operation.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const notification = toast?.loading("Saving protected documents…");
    try {
      const replacement = normalizeDatabaseDocuments({
        ...draft,
        revision: review.data.revision + 1,
      });
      await service.apply(review, replacement);
      if (!current(key, token)) return false;
      const verified = await service.read(review.scope);
      if (!current(key, token)) return false;
      reviewRef.current = verified;
      setDraft(structuredClone(verified.data));
      dirtyRef.current = false;
      setDirty(false);
      setStale(false);
      if (notification)
        toast?.update(notification, {
          type: "success",
          message: "Documents saved to the protected database.",
          duration: 4000,
        });
      return true;
    } catch (cause) {
      if (current(key, token)) {
        setStale(true);
        setError(
          `${cause instanceof Error ? cause.message : "Saving could not be verified."} Your draft is retained. Review or export it before reloading.`,
        );
        if (notification)
          toast?.update(notification, {
            type: "error",
            message:
              "Document save could not be verified. Your draft was retained.",
            duration: 6000,
          });
      }
      return false;
    } finally {
      if (current(key, token)) {
        busyRef.current = false;
        setBusy(false);
      } else if (notification) toast?.remove(notification);
    }
  };

  useEffect(() => {
    if ((!dirty && !hasPendingEditorChanges) || !accessKey) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, hasPendingEditorChanges, accessKey]);

  return {
    data: accessKey && draftOwner === accessKey ? draft : null,
    accessKey,
    scope: accessKey ? scopeRef.current : null,
    busy,
    dirty,
    stale,
    error,
    update,
    save,
    reload,
  };
}
