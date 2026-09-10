import { useEffect, useMemo, useRef, useState } from "react";
import { detectLanguage } from "../../utils/recording/scriptSyntax";
import { SCRIPT_CATEGORY_SUGGESTIONS } from "../../data/defaultScriptCatalog";
import type {
  ManagedScript,
  ScriptLanguage,
  OSTag,
} from "../../components/recording/scriptManager/shared";
import type {
  AutomationEntry,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../types/recording/automationLibrary";
import { normalizeAutomationEntry } from "../../utils/recording/automationLibraryValidation";
import { automationLibraryDiagnostic } from "../../utils/recording/automationLibraryAccess";
import { useAutomationLibraryApi } from "./useAutomationLibraryApi";

type Entry = AutomationEntry<"terminal-script">;
type Snapshot = AutomationLibrarySnapshot<"terminal-script">;
type Draft = { key: string; id: string; base?: Entry };
type Review = {
  id: string;
  key: string;
  title: string;
  message: string;
  destructive: boolean;
  action: () => void;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A selected scope never falls back to another store or treats a read failure as empty. */
export function useScriptManager(onClose: () => void, enabled = true) {
  const bridge = useAutomationLibraryApi();
  const [scope, setScope] = useState<AutomationScope>({ kind: "app" });
  const owner =
    scope.kind === "app"
      ? "app"
      : `database:${scope.databaseId}:${bridge.databaseScope?.databaseId === scope.databaseId ? bridge.databaseScope.generation : "unavailable"}`;
  const accessKey = `${owner}:${bridge.accessEpoch}:${bridge.settingsReady}:${bridge.ready}:${enabled}`;
  const available = Boolean(
    enabled &&
    bridge.ready &&
    bridge.settingsReady &&
    (scope.kind === "app" ||
      bridge.databaseScope?.databaseId === scope.databaseId),
  );
  const [loaded, setLoaded] = useState<{ key: string; value: Snapshot } | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const reviewRef = useRef<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const live = useRef(false),
    readSequence = useRef(0);
  const latest = useRef({ accessKey, available });
  latest.current = { accessKey, available };
  const current = (key = accessKey) =>
    live.current &&
    latest.current.available &&
    latest.current.accessKey === key;
  const [storageError, setStorageError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState<ScriptLanguage | "">("");
  const [osTagFilter, setOsTagFilter] = useState<OSTag | "">("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editScript, setEditScript] = useState("");
  const [editLanguage, setEditLanguage] = useState<ScriptLanguage>("auto");
  const [editCategory, setEditCategory] = useState("Custom");
  const [editOsTags, setEditOsTags] = useState<OSTag[]>(["agnostic"]);
  const snapshot = available && loaded?.key === accessKey ? loaded.value : null;
  const scripts = useMemo(
    () => snapshot?.entries.map((entry) => entry.payload) ?? [],
    [snapshot],
  );
  const visibleDraft = draft?.key === accessKey && available ? draft : null;
  const selectedScript =
    visibleDraft?.base?.payload ??
    (selectedId
      ? (scripts.find((script) => script.id === selectedId) ?? null)
      : null);
  const setDraft = (value: Draft | null) => {
    draftRef.current = value;
    setDraftState(value);
  };
  function discardEdit() {
    setDraft(null);
    setSelectedId(null);
  }
  function cancelReview() {
    reviewRef.current = null;
    setReview(null);
  }
  async function refresh() {
    if (!current() || busyRef.current) return false;
    const key = accessKey,
      generation = ++readSequence.current;
    setLoading(true);
    try {
      const value = await bridge.api.read(scope, "terminal-script");
      if (!current(key) || generation !== readSequence.current) return false;
      setLoaded({ key, value });
      setStorageError(null);
      return true;
    } catch (error) {
      if (current(key) && generation === readSequence.current)
        setStorageError(automationLibraryDiagnostic(error).message);
      return false;
    } finally {
      if (current(key) && generation === readSequence.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    discardEdit();
    cancelReview();
    setLoaded(null);
    setStorageError(null);
    setCopiedId(null);
    setEditName("");
    setEditDescription("");
    setEditScript("");
    setEditOsTags(["agnostic"]);
    setLoading(false);
    if (available) void refresh();
    const invalidate = () => {
      live.current = false;
      readSequence.current++;
    };
    return invalidate;
    // Private drafts are bound to access, not ordinary content refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessKey, available]);
  useEffect(() => {
    if (scope.kind === "database" && available) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge.databaseRevision]);
  function ask(
    title: string,
    message: string,
    action: () => void,
    destructive = false,
  ) {
    if (!current() || busyRef.current) return;
    const next = {
      id: crypto.randomUUID(),
      key: accessKey,
      title,
      message,
      action,
      destructive,
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
    if (visibleDraft)
      ask(
        "Discard script draft?",
        "This unsaved draft will be discarded. Saved scripts will not change.",
        () => {
          discardEdit();
          action();
        },
      );
    else action();
  }
  function changeScope(next: AutomationScope) {
    if (!busyRef.current) {
      discardEdit();
      cancelReview();
      setScope(next);
    }
  }
  function startDraft(script?: ManagedScript, duplicate = false) {
    if (!current() || !snapshot || busyRef.current) return;
    const base =
      script && !duplicate
        ? snapshot.entries.find(
            (entry) =>
              entry.payload.id === script.id && same(entry.payload, script),
          )
        : undefined;
    if (script && !duplicate && !base) return;
    leave(() => {
      setSelectedId(base?.payload.id ?? null);
      setDraft({
        key: accessKey,
        id: base?.payload.id ?? crypto.randomUUID(),
        ...(base ? { base: structuredClone(base) } : {}),
      });
      setEditName(script ? script.name + (duplicate ? " (Copy)" : "") : "");
      setEditDescription(script?.description ?? "");
      setEditScript(script?.script ?? "");
      setEditLanguage(script?.language ?? "auto");
      setEditCategory(script?.category ?? "Custom");
      setEditOsTags(script?.osTags ?? ["agnostic"]);
    });
  }
  async function handleSaveScript() {
    const captured = draftRef.current;
    if (
      !current() ||
      busyRef.current ||
      captured?.key !== accessKey ||
      !editName.trim() ||
      !editScript.trim()
    )
      return false;
    const key = accessKey;
    busyRef.current = true;
    setBusy(true);
    readSequence.current++;
    setLoading(false);
    setStorageError(null);
    try {
      const now = new Date().toISOString();
      const entry = normalizeAutomationEntry({
        family: "terminal-script",
        payload: {
          id: captured.id,
          name: editName.trim(),
          description: editDescription.trim(),
          script: editScript,
          language:
            editLanguage === "auto" ? detectLanguage(editScript) : editLanguage,
          category: editCategory,
          osTags: editOsTags,
          createdAt: captured.base?.payload.createdAt ?? now,
          updatedAt: now,
        },
        ...(captured.base?.provenance
          ? { provenance: captured.base.provenance }
          : {}),
      }) as Entry;
      const reviewed = await bridge.api.read(scope, "terminal-script");
      if (!current(key) || draftRef.current !== captured) return false;
      const existing = reviewed.entries.find(
        (item) => item.payload.id === captured.id,
      );
      if (!same(existing, captured.base))
        throw new Error(
          "Script changed in another window. Review the saved entry before replacing it.",
        );
      const committed = await bridge.api.apply(reviewed, [
        {
          operation: "put",
          entry,
          ...(existing ? { expected: existing } : {}),
        },
      ]);
      if (!current(key) || draftRef.current !== captured) return false;
      setLoaded({ key, value: committed });
      discardEdit();
      return true;
    } catch (error) {
      if (current(key))
        setStorageError(
          `${automationLibraryDiagnostic(error).message} Your unsaved draft was retained.`,
        );
      return false;
    } finally {
      busyRef.current = false;
      if (live.current) setBusy(false);
    }
  }
  function handleDeleteScript(id: string) {
    const expected = snapshot?.entries.find((entry) => entry.payload.id === id);
    if (!expected || !current()) return;
    ask(
      "Delete script?",
      `Delete “${expected.payload.name}” from ${scope.kind === "app" ? "the app-wide library" : "this database"}? No other scope will change.`,
      () => {
        const key = accessKey;
        busyRef.current = true;
        setBusy(true);
        readSequence.current++;
        setLoading(false);
        void (async () => {
          try {
            const reviewed = await bridge.api.read(scope, "terminal-script");
            if (!current(key)) return;
            if (
              !same(
                reviewed.entries.find((entry) => entry.payload.id === id),
                expected,
              )
            )
              throw new Error(
                "The reviewed script changed. Reload before deleting.",
              );
            const committed = await bridge.api.apply(reviewed, [
              { operation: "delete", expected },
            ]);
            if (!current(key)) return;
            setLoaded({ key, value: committed });
            discardEdit();
            setStorageError(null);
          } catch (error) {
            if (current(key))
              setStorageError(automationLibraryDiagnostic(error).message);
          } finally {
            busyRef.current = false;
            if (live.current) setBusy(false);
          }
        })();
      },
      true,
    );
  }
  async function handleCopyScript(script: ManagedScript) {
    if (
      !current() ||
      !snapshot?.entries.some((entry) => same(entry.payload, script))
    )
      return;
    const key = accessKey;
    try {
      await navigator.clipboard.writeText(script.script);
      if (current(key)) setCopiedId(script.id);
    } catch {
      if (current(key))
        setStorageError("The script could not be copied to the clipboard.");
    }
  }
  const categories = useMemo(
    () =>
      [
        ...new Set([
          ...SCRIPT_CATEGORY_SUGGESTIONS,
          ...scripts.map((script) => script.category),
        ]),
      ].sort(),
    [scripts],
  );
  const filteredScripts = useMemo(
    () =>
      scripts.filter(
        (script) =>
          `${script.name} ${script.description} ${script.script}`
            .toLowerCase()
            .includes(searchFilter.toLowerCase()) &&
          (!categoryFilter || script.category === categoryFilter) &&
          (!languageFilter || script.language === languageFilter) &&
          (!osTagFilter || script.osTags.includes(osTagFilter)),
      ),
    [scripts, searchFilter, categoryFilter, languageFilter, osTagFilter],
  );
  const edit =
    <T>(setter: (value: T) => void) =>
    (value: T) => {
      if (current() && !busyRef.current && draftRef.current?.key === accessKey)
        setter(value);
    };
  return {
    ...bridge,
    api: bridge.api,
    scope,
    changeScope,
    accessKey,
    available,
    ready: !!snapshot,
    loading,
    busy,
    refresh,
    snapshot,
    scripts,
    selectedScript,
    isEditing: !!visibleDraft,
    searchFilter,
    categoryFilter,
    languageFilter,
    osTagFilter,
    copiedId,
    storageError,
    editName: visibleDraft ? editName : "",
    editDescription: visibleDraft ? editDescription : "",
    editScript: visibleDraft ? editScript : "",
    editLanguage,
    editCategory,
    editOsTags: visibleDraft ? editOsTags : [],
    categories,
    filteredScripts,
    setSearchFilter,
    setCategoryFilter,
    setLanguageFilter,
    setOsTagFilter,
    setEditName: edit(setEditName),
    setEditDescription: edit(setEditDescription),
    setEditScript: edit(setEditScript),
    setEditLanguage: edit(setEditLanguage),
    setEditCategory: edit(setEditCategory),
    handleNewScript: () => startDraft(),
    handleEditScript: (script: ManagedScript) => startDraft(script),
    handleDuplicateScript: (script: ManagedScript) => startDraft(script, true),
    handleSaveScript,
    handleDeleteScript,
    handleCopyScript,
    handleCancelEdit: () => leave(discardEdit),
    discardEdit,
    handleSelectScript: (script: ManagedScript) => {
      if (current() && scripts.some((item) => same(item, script)))
        leave(() => {
          discardEdit();
          setSelectedId(script.id);
        });
    },
    toggleOsTag: (tag: OSTag) =>
      edit(setEditOsTags)(
        editOsTags.includes(tag)
          ? editOsTags.filter((value) => value !== tag)
          : [...editOsTags, tag],
      ),
    onClose: () => leave(onClose),
    handleCatalogApplied: () => {
      void refresh();
    },
    review: review?.key === accessKey ? review : null,
    confirmReview,
    cancelReview,
  };
}
export type ScriptManagerMgr = ReturnType<typeof useScriptManager>;
