import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedRecording } from "../../types/recording/macroTypes";
import type {
  AutomationEntry,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../types/recording/automationLibrary";
import * as macroService from "../../utils/recording/macroService";
import { automationLibraryDiagnostic } from "../../utils/recording/automationLibraryAccess";
import { normalizeAutomationEntry } from "../../utils/recording/automationLibraryValidation";
import { useAutomationLibraryApi } from "./useAutomationLibraryApi";

export type MacroFamily = "terminal-macro" | "website-macro";
export type MacroTab = "macros" | "website" | "browse" | "recordings";
export type MacroEntry = AutomationEntry<MacroFamily>;
type Snapshot = AutomationLibrarySnapshot<MacroFamily>;
type Draft = { entry: MacroEntry; base?: MacroEntry; key: string };
type Review = {
  id: string;
  key: string;
  title: string;
  message: string;
  destructive: boolean;
  confirmText?: string;
  action: () => void;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const familyFor = (tab: MacroTab): MacroFamily =>
  tab === "website" ? "website-macro" : "terminal-macro";

/** Explicit scoped macro CRUD. Session recordings load independently. */
export function useMacroManager(isOpen: boolean) {
  const bridge = useAutomationLibraryApi();
  const [scopeKind, setScopeKind] = useState<AutomationScope["kind"]>("app");
  const scope: AutomationScope =
    scopeKind === "app"
      ? { kind: "app" }
      : {
          kind: "database",
          databaseId: bridge.databaseScope?.databaseId ?? "",
        };
  const [activeTab, setTab] = useState<MacroTab>("macros");
  const family = familyFor(activeTab);
  const owner =
    scope.kind === "app"
      ? "app"
      : `database:${scope.databaseId}:${bridge.databaseScope?.databaseId === scope.databaseId ? bridge.databaseScope.generation : "unavailable"}`;
  const accessKey = `${owner}:${bridge.accessEpoch}:${bridge.settingsReady}:${bridge.ready}:${isOpen}`;
  const key = `${accessKey}:${family}`;
  const available = Boolean(
    isOpen &&
    bridge.settingsReady &&
    bridge.ready &&
    (scope.kind === "app" ||
      bridge.databaseScope?.databaseId === scope.databaseId),
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    snapshot: Snapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const reviewRef = useRef<Review | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState("");
  const [sort, setSort] = useState<"name" | "updated">("name");
  const [page, setPage] = useState(0);
  const latest = useRef({ key, accessKey, available });
  latest.current = { key, accessKey, available };
  const latestDatabase = useRef(bridge.databaseScope);
  latestDatabase.current = bridge.databaseScope;
  const live = useRef(false);
  const readSequence = useRef(0);
  const current = (captured = key) =>
    live.current && latest.current.available && latest.current.key === captured;
  const setDraft = (value: Draft | null) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const cancelReview = () => {
    reviewRef.current = null;
    setReview(null);
  };
  const dirty =
    draft?.key === key && (!draft.base || !same(draft.entry, draft.base));
  const snapshot = loaded?.key === key && available ? loaded.snapshot : null;
  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot]);
  const visibleDraft = draft?.key === key && available ? draft : null;

  async function refresh() {
    if (!current() || busyRef.current) return;
    const captured = key,
      request = ++readSequence.current;
    setLoading(true);
    try {
      const next = await bridge.api.read(scope, family);
      if (!current(captured) || request !== readSequence.current) return;
      setLoaded({ key: captured, snapshot: next });
      setError(null);
    } catch (failure) {
      if (current(captured) && request === readSequence.current)
        setError(automationLibraryDiagnostic(failure).message);
    } finally {
      if (current(captured) && request === readSequence.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    setDraft(null);
    cancelReview();
    setLoaded(null);
    setError(null);
    setPage(0);
    setLoading(false);
    if (available) void refresh();
    const invalidate = () => {
      live.current = false;
      readSequence.current++;
    };
    return invalidate;
    // Scope/generation, not unrelated renders, owns the private draft lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, available]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && available && loaded?.key !== key && !error)
      void refresh();
    wasBusy.current = busy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  useEffect(() => {
    setPage(0);
  }, [searchQuery, category, platform, sort]);
  const previousDatabaseRevision = useRef(bridge.databaseRevision);
  useEffect(() => {
    if (previousDatabaseRevision.current === bridge.databaseRevision) return;
    previousDatabaseRevision.current = bridge.databaseRevision;
    if (scope.kind === "database" && available) void refresh();
    // Content refresh does not replace a reviewed draft/base or its owner key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge.databaseRevision]);

  function ask(
    title: string,
    message: string,
    action: () => void,
    destructive = false,
    confirmText?: string,
  ) {
    if (busyRef.current || !current()) return;
    const next = {
      id: crypto.randomUUID(),
      key,
      title,
      message,
      action,
      destructive,
      confirmText,
    };
    reviewRef.current = next;
    setReview(next);
  }
  function confirmReview() {
    if (
      !review ||
      reviewRef.current?.id !== review.id ||
      !current(review.key) ||
      busyRef.current
    )
      return;
    cancelReview();
    review.action();
  }
  function leave(action: () => void) {
    if (busyRef.current) return;
    if (dirty)
      ask(
        "Discard unsaved macro changes?",
        "Only this unsaved draft will be discarded. Saved macros are unchanged.",
        () => {
          setDraft(null);
          action();
        },
      );
    else {
      setDraft(null);
      action();
    }
  }
  function setActiveTab(tab: MacroTab) {
    leave(() => {
      setTab(tab);
      cancelReview();
    });
  }
  function changeScope(next: AutomationScope) {
    leave(() => {
      setScopeKind(next.kind);
      cancelReview();
    });
  }
  function selectEntry(entry: MacroEntry) {
    if (
      !snapshot ||
      entry.family !== family ||
      !entries.some((item) => same(item, entry))
    )
      return;
    leave(() =>
      setDraft({
        entry: structuredClone(entry),
        base: structuredClone(entry),
        key,
      }),
    );
  }
  function editEntry(entry: MacroEntry) {
    const previous = draftRef.current;
    if (
      !current() ||
      busyRef.current ||
      previous?.key !== key ||
      previous.entry.payload.id !== entry.payload.id ||
      previous.entry.family !== entry.family
    )
      return;
    setDraft({ ...previous, entry });
  }
  function handleNewMacro() {
    if (!snapshot || busyRef.current) return;
    const now = new Date().toISOString();
    const common = {
      id: crypto.randomUUID(),
      name: "New Macro",
      description: "",
      createdAt: now,
      updatedAt: now,
    };
    const entry: MacroEntry =
      family === "terminal-macro"
        ? {
            family,
            payload: {
              ...common,
              steps: [{ command: "", delayMs: 200, sendNewline: true }],
            },
          }
        : {
            family,
            payload: {
              ...common,
              kind: "macro",
              steps: [
                {
                  kind: "click",
                  selector: "html > body > button:nth-of-type(1)",
                },
              ],
            },
          };
    leave(() => setDraft({ entry, key }));
  }
  async function saveEntry(entry: MacroEntry) {
    const captured = draftRef.current;
    if (
      !current() ||
      busyRef.current ||
      !captured ||
      captured.key !== key ||
      !same(captured.entry, entry)
    )
      return false;
    busyRef.current = true;
    readSequence.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    try {
      const checked = normalizeAutomationEntry({
        ...entry,
        payload: { ...entry.payload, updatedAt: new Date().toISOString() },
      }) as MacroEntry;
      const next = await bridge.api.read(scope, family);
      if (!current(captured.key) || draftRef.current !== captured) return false;
      const existing = next.entries.find(
        (item) => item.payload.id === entry.payload.id,
      );
      if (!same(existing, captured.base))
        throw new Error(
          "The edited macro changed. Close the draft and review the latest saved item before applying changes.",
        );
      const committed = await bridge.api.apply(next, [
        {
          operation: "put",
          entry: checked,
          ...(existing ? { expected: existing } : {}),
        },
      ]);
      if (!current(captured.key) || draftRef.current !== captured) return false;
      setLoaded({ key: captured.key, snapshot: committed });
      setDraft(null);
      return true;
    } catch (failure) {
      if (current(captured.key))
        setError(
          `${automationLibraryDiagnostic(failure).message} The draft was retained. Review the saved item before retrying an uncertain write.`,
        );
      return false;
    } finally {
      busyRef.current = false;
      if (live.current) setBusy(false);
    }
  }
  function deleteEntry(entry: MacroEntry) {
    if (!snapshot || !entries.some((item) => same(item, entry))) return;
    ask(
      "Delete saved macro?",
      `Delete “${entry.payload.name}” from ${scope.kind === "app" ? "the app-wide library" : "this database"}? This cannot be undone.`,
      () => {
        const captured = key;
        busyRef.current = true;
        readSequence.current++;
        setLoading(false);
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const next = await bridge.api.read(scope, family);
            if (!current(captured)) return;
            const existing = next.entries.find(
              (item) => item.payload.id === entry.payload.id,
            );
            if (!same(existing, entry))
              throw new Error(
                "The reviewed macro changed. Reload before deleting.",
              );
            const committed = await bridge.api.apply(next, [
              { operation: "delete", expected: entry },
            ]);
            if (!current(captured)) return;
            setLoaded({ key: captured, snapshot: committed });
            if (draftRef.current?.entry.payload.id === entry.payload.id)
              setDraft(null);
          } catch (failure) {
            if (current(captured))
              setError(automationLibraryDiagnostic(failure).message);
          } finally {
            busyRef.current = false;
            if (live.current) setBusy(false);
          }
        })();
      },
      true,
    );
  }
  function copyToScope(entry: MacroEntry) {
    const expected = snapshot?.entries.find((item) => same(item, entry));
    const target: AutomationScope | null =
      scope.kind === "database"
        ? { kind: "app" }
        : bridge.databaseScope
          ? { kind: "database", databaseId: bridge.databaseScope.databaseId }
          : null;
    if (!expected || !target || dirty || !current()) return;
    const targetDatabase = bridge.databaseScope;
    const targetCurrent = () =>
      target.kind === "app" ||
      (latestDatabase.current?.databaseId === targetDatabase?.databaseId &&
        latestDatabase.current?.generation === targetDatabase?.generation);
    ask(
      "Copy macro to scope?",
      `Copy “${expected.payload.name}” to ${target.kind === "app" ? "App-wide" : "the current database"} as a new entry? The original and existing destination entries will be kept.`,
      () => {
        if (!targetCurrent()) return;
        const captured = key;
        busyRef.current = true;
        setBusy(true);
        readSequence.current++;
        setLoading(false);
        setError(null);
        void (async () => {
          try {
            const destination = await bridge.api.read(target, family);
            if (!current(captured) || !targetCurrent()) return;
            const source = await bridge.api.read(scope, family);
            if (!current(captured) || !targetCurrent()) return;
            if (
              !same(
                source.entries.find(
                  (item) => item.payload.id === expected.payload.id,
                ),
                expected,
              )
            )
              throw new Error(
                "The reviewed macro changed. Reload before copying.",
              );
            const copy = structuredClone(expected);
            const now = new Date().toISOString();
            copy.payload = {
              ...copy.payload,
              id: crypto.randomUUID(),
              createdAt: now,
              updatedAt: now,
            };
            await bridge.api.apply(destination, [
              { operation: "put", entry: copy },
            ]);
          } catch (failure) {
            if (current(captured))
              setError(automationLibraryDiagnostic(failure).message);
          } finally {
            busyRef.current = false;
            if (live.current) setBusy(false);
          }
        })();
      },
      false,
      "Copy",
    );
  }
  function duplicateEntry(entry: MacroEntry) {
    if (!current() || busyRef.current) return;
    const now = new Date().toISOString(),
      copy = structuredClone(entry);
    copy.payload = {
      ...copy.payload,
      id: crypto.randomUUID(),
      name: `${copy.payload.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    leave(() => setDraft({ entry: copy, key }));
  }
  function useTemplate(entry: MacroEntry) {
    if (!current() || busyRef.current || dirty || entry.family !== family)
      return;
    const now = new Date().toISOString(),
      copy = structuredClone(entry);
    copy.payload = {
      ...copy.payload,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setTab(copy.family === "terminal-macro" ? "macros" : "website");
    setDraft({ entry: copy, key });
  }
  const filteredEntries = useMemo(
    () =>
      entries
        .filter((entry) => {
          const p = entry.payload;
          const tags =
            entry.family === "terminal-macro"
              ? (entry.payload.tags ?? [])
              : (entry.provenance?.tags ?? []);
          const entryCategory =
            entry.family === "terminal-macro"
              ? (entry.payload.category ?? "")
              : "Website interactions";
          return (
            (!category || category === entryCategory) &&
            (!platform || entry.provenance?.platforms?.includes(platform)) &&
            [
              p.name,
              p.description,
              entryCategory,
              ...tags,
              ...(entry.provenance?.platforms ?? []),
            ]
              .join(" ")
              .toLowerCase()
              .includes(searchQuery.trim().toLowerCase())
          );
        })
        .sort((a, b) =>
          sort === "name"
            ? a.payload.name.localeCompare(b.payload.name)
            : b.payload.updatedAt.localeCompare(a.payload.updatedAt),
        ),
    [entries, category, platform, searchQuery, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / 50));
  const currentPage = Math.min(page, pageCount - 1);

  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [editingRecording, setEditingRecording] =
    useState<SavedRecording | null>(null);
  const recordingSequence = useRef(0);
  async function refreshRecordings() {
    if (!isOpen) return;
    const request = ++recordingSequence.current;
    try {
      const result = await macroService.loadRecordings();
      if (request !== recordingSequence.current || !live.current) return;
      setRecordings(result);
      setRecordingError(null);
    } catch {
      if (request === recordingSequence.current && live.current)
        setRecordingError(
          "Session recordings could not be loaded. Macro libraries are separate and remain available.",
        );
    }
  }
  useEffect(() => {
    if (isOpen) void refreshRecordings();
    const invalidate = () => {
      recordingSequence.current++;
    };
    return invalidate;
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredRecordings = recordings.filter((r) =>
    [r.name, r.description, r.recording.metadata.host, ...(r.tags ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  );
  function handleDeleteRecording(id: string) {
    ask(
      "Delete recording?",
      "Permanently delete this saved session recording?",
      () => {
        void macroService
          .deleteRecording(id)
          .then(() => {
            setEditingRecording(null);
            return refreshRecordings();
          })
          .catch(() =>
            setRecordingError(
              "Recording deletion could not be confirmed. Reload before retrying.",
            ),
          );
      },
      true,
    );
  }
  async function handleRenameRecording(rec: SavedRecording, name: string) {
    try {
      await macroService.saveRecording({ ...rec, name });
      await refreshRecordings();
      return true;
    } catch {
      setRecordingError(
        "The recording name could not be saved. Reload before retrying.",
      );
      return false;
    }
  }
  async function handleExportRecording(
    rec: SavedRecording,
    format: "json" | "asciicast" | "script",
  ) {
    try {
      const data = await macroService.exportRecording(rec.recording, format);
      const ext =
        format === "asciicast" ? "cast" : format === "script" ? "txt" : "json";
      const url = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${rec.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.${ext}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setRecordingError("The recording could not be exported.");
    }
  }
  return {
    ...bridge,
    scope,
    changeScope,
    accessKey,
    activeTab,
    setActiveTab,
    family,
    available,
    snapshot,
    entries,
    loading,
    error,
    busy,
    ready: !!snapshot,
    refresh,
    draft: visibleDraft?.entry ?? null,
    dirty: !!dirty,
    editEntry,
    selectEntry,
    saveEntry,
    deleteEntry,
    duplicateEntry,
    copyToScope,
    handleNewMacro,
    useTemplate,
    closeDraft: () => leave(() => {}),
    requestLeave: leave,
    review: review?.key === key ? review : null,
    confirmReview,
    cancelReview,
    searchQuery,
    setSearchQuery,
    category,
    setCategory,
    platform,
    setPlatform,
    sort,
    setSort,
    filteredEntries,
    pagedEntries: filteredEntries.slice(
      currentPage * 50,
      currentPage * 50 + 50,
    ),
    page: currentPage,
    pageCount,
    setPage,
    recordings,
    filteredRecordings,
    recordingError,
    refreshRecordings,
    editingRecording,
    setEditingRecording,
    handleDeleteRecording,
    handleRenameRecording,
    handleExportRecording,
  };
}
