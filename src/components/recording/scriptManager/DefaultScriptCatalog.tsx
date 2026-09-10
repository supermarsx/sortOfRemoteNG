import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Search } from "lucide-react";
import {
  bundledScriptCatalog,
  BUNDLED_SCRIPT_CONTEXT_LABELS,
} from "../../../data/bundledScriptCatalog";
import { defaultScripts } from "../../../data/defaultScripts";
import { defaultScriptCatalog } from "../../../data/defaultScriptCatalog";
import {
  managedScriptsStore,
  buildManagedScriptsSnapshot,
  type PersistedManagedScripts,
} from "../../../utils/recording/managedScriptPersistence";
import { applyDefaultScriptSelection } from "../../../utils/recording/defaultScriptCatalog";
import { OS_TAG_LABELS, languageLabels, type OSTag } from "./shared";
import { ScriptMetadataIcon } from "./ScriptMetadataIcon";
import AutomationSourceBadge from "./AutomationSourceBadge";
import type {
  AutomationLibrarySnapshot,
  AutomationLibraryChange,
} from "../../../types/recording/automationLibrary";
import type { WebsiteUserScriptsLibraryBinding } from "../../../hooks/recording/useWebsiteUserScripts";

const PAGE_SIZE = 50;
const categories = [
  ...new Set(bundledScriptCatalog.map((entry) => entry.payload.category)),
].sort();
const originalIds = new Set(defaultScripts.map((entry) => entry.id));

/** Embedded browse surface. Bulk commands are deliberately preview/copy only. */
export function DefaultScriptCatalog({
  onApplied,
  onBusyChange,
  library,
}: {
  onApplied: (value: PersistedManagedScripts) => void;
  onBusyChange?: (busy: boolean) => void;
  library?: Pick<
    WebsiteUserScriptsLibraryBinding,
    "api" | "scope" | "accessKey" | "enabled"
  >;
}) {
  const [snapshot, setSnapshot] = useState<{
    value: PersistedManagedScripts | null;
  } | null>(null);
  const [scopedSnapshot, setScopedSnapshot] =
    useState<AutomationLibrarySnapshot<"terminal-script"> | null>(null);
  const latestLibrary = useRef(library);
  latestLibrary.current = library;
  const alive = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [context, setContext] = useState("");
  const [risk, setRisk] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewKey, setPreviewKey] = useState(bundledScriptCatalog[0].key);
  const [page, setPage] = useState(0);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    let live = true;
    alive.current = true;
    setSnapshot(null);
    setScopedSnapshot(null);
    setError(null);
    setOverwrite(false);
    setSelected(new Set());
    const read = async () => {
      if (library) {
        if (!library.enabled) throw new Error("Library access unavailable");
        const result = await library.api.read(library.scope, "terminal-script");
        if (
          live &&
          latestLibrary.current?.accessKey === library.accessKey &&
          latestLibrary.current.enabled
        ) {
          setScopedSnapshot(result);
          setSnapshot({ value: null });
        }
        return null;
      }
      return managedScriptsStore.load();
    };
    void read()
      .then((result) => {
        if (live && result) setSnapshot({ value: result.value });
      })
      .catch(() => {
        if (live)
          setError(
            "The saved library is unavailable. Browse and copy are still available; unlock storage and reload before importing. Nothing was reset.",
          );
      });
    return () => {
      live = false;
      alive.current = false;
    };
    // Binding ownership is identified by accessKey, not its render object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, library?.accessKey, library?.enabled]);
  const filtered = useMemo(
    () =>
      bundledScriptCatalog.filter(
        (entry) =>
          (!platform || entry.platforms.includes(platform as OSTag)) &&
          (!category || entry.payload.category === category) &&
          (!source || entry.source === source) &&
          (!context || entry.context === context) &&
          (!risk || entry.risk === risk) &&
          `${entry.payload.name} ${entry.payload.description} ${entry.payload.category} ${entry.platforms.map((tag) => OS_TAG_LABELS[tag]).join(" ")} ${entry.language}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [search, platform, category, source, context, risk],
  );
  const filterKey = JSON.stringify([
    search,
    platform,
    category,
    source,
    context,
    risk,
  ]);
  useEffect(() => setPage(0), [filterKey]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const displayed = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const preview = bundledScriptCatalog.find(
    (entry) => entry.key === previewKey,
  )!;
  const replacements = [...selected].filter((id) => {
    if (!library)
      return snapshot?.value?.modifiedDefaults.some((entry) => entry.id === id);
    const existing = scopedSnapshot?.entries.find(
      (entry) => entry.payload.id === id,
    );
    const shipped = bundledScriptCatalog.find(
      (entry) => entry.source === "managed" && entry.payload.id === id,
    )?.payload;
    return (
      existing && JSON.stringify(existing.payload) !== JSON.stringify(shipped)
    );
  });
  const toggle = (id: string) => {
    setOverwrite(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const reset = () => {
    setSearch("");
    setPlatform("");
    setCategory("");
    setSource("");
    setContext("");
    setRisk("");
  };
  const filter = (
    label: string,
    value: string,
    update: (value: string) => void,
    options: readonly (readonly [string, string])[],
  ) => (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-textMuted)]">
      {label}
      <select
        aria-label={`Browse script ${label.toLowerCase()}`}
        className="sor-form-input max-w-56"
        style={{ width: "auto" }}
        value={value}
        onChange={(event) => update(event.target.value)}
      >
        <option value="">
          All {label === "Category" ? "categories" : `${label.toLowerCase()}s`}
        </option>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section
      aria-label="Browse scripts"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            Browse scripts{" "}
            <span className="text-sm text-[var(--color-textMuted)]">
              · {bundledScriptCatalog.length} bundled entries
            </span>
          </h2>
          <span className="text-xs text-[var(--color-textMuted)]">
            Browsing and importing never run commands
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex max-w-full flex-col gap-1 text-xs text-[var(--color-textMuted)]">
            Search
            <span className="relative block w-64 max-w-full">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              />
              <input
                aria-label="Search bundled scripts"
                className="sor-form-input w-full !pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, platform or purpose"
              />
            </span>
          </label>
          {filter(
            "Category",
            category,
            setCategory,
            categories.map((value) => [value, value]),
          )}
          {filter(
            "Platform",
            platform,
            setPlatform,
            Object.entries(OS_TAG_LABELS),
          )}
          {filter("Source", source, setSource, [
            ["managed", "Script Manager templates"],
            ["bulk", "Bulk SSH command library"],
          ])}
          {filter(
            "Context",
            context,
            setContext,
            Object.entries(BUNDLED_SCRIPT_CONTEXT_LABELS),
          )}
          {filter("Risk", risk, setRisk, [
            ["changes-state", "Changes state / disruptive"],
            ["review", "Review required"],
          ])}
          {(search || platform || category || source || context || risk) && (
            <button
              className="sor-btn-secondary-sm"
              type="button"
              onClick={reset}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-[minmax(18rem,1fr)_minmax(20rem,1fr)] lg:overflow-hidden">
        <div className="flex min-h-64 flex-col border-b border-[var(--color-border)] lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-[var(--color-textMuted)]">
            <span>
              {filtered.length} matching · {selected.size} selected for import
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                className="sor-btn-secondary-sm"
                disabled={busy}
                onClick={() => {
                  setSelected(new Set());
                  setOverwrite(false);
                }}
              >
                Clear selection
              </button>
            )}
          </div>
          <div
            className="min-h-0 flex-1 space-y-1 overflow-auto px-3 pb-3"
            aria-label="Bundled script choices"
          >
            {!displayed.length && (
              <p className="p-4 text-sm">No scripts match these filters.</p>
            )}
            {displayed.map((entry) => (
              <div
                key={entry.key}
                data-catalog-key={entry.key}
                className={`flex items-start gap-2 rounded border p-2 ${previewKey === entry.key ? "border-primary bg-primary/10" : "border-[var(--color-border)]"}`}
              >
                {entry.source === "managed" && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Select ${entry.payload.name}`}
                    checked={selected.has(entry.payload.id)}
                    disabled={busy}
                    onChange={() => toggle(entry.payload.id)}
                  />
                )}
                <button
                  type="button"
                  aria-pressed={previewKey === entry.key}
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setPreviewKey(entry.key)}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <ScriptMetadataIcon language={entry.language} />
                    <span className="min-w-0 break-words">
                      {entry.payload.name}
                      <AutomationSourceBadge source="app-provided" />
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
                    {entry.payload.category} ·{" "}
                    {entry.source === "bulk"
                      ? "Bulk SSH · Preview / copy"
                      : originalIds.has(entry.payload.id)
                        ? "Bundled template"
                        : "Import custom copy"}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-textMuted)]">
                    {entry.platforms.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1"
                      >
                        <ScriptMetadataIcon platform={tag} size={12} />
                        {OS_TAG_LABELS[tag]}
                      </span>
                    ))}
                  </span>
                  {entry.risk === "changes-state" && (
                    <span className="mt-1 block text-xs text-warning">
                      Changes state / potentially disruptive
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous page
            </button>
            <span>
              Page {currentPage + 1} of {pages}
            </span>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next page
            </button>
          </div>
        </div>
        <aside
          className="min-w-0 space-y-3 overflow-auto p-4"
          aria-label="Script preview"
        >
          <h3 className="flex items-center gap-2 font-semibold">
            {preview.payload.name}
            <AutomationSourceBadge source="app-provided" />
          </h3>
          <p className="text-sm">{preview.payload.description}</p>
          <p className="text-xs text-[var(--color-textMuted)]">
            {BUNDLED_SCRIPT_CONTEXT_LABELS[preview.context]} ·{" "}
            {preview.language === "terminal-input"
              ? "Literal terminal input, not a Bash program"
              : languageLabels[preview.language]}
          </p>
          <p
            className={`rounded border border-[var(--color-border)] p-2 text-xs ${preview.risk === "changes-state" ? "text-warning" : "text-[var(--color-textMuted)]"}`}
          >
            {preview.risk === "changes-state"
              ? "These commands may change configuration, delete data or interrupt access. Review every command, placeholder and target before use."
              : "Review commands, permissions and target compatibility. No risk label proves a script is safe."}
          </p>
          {preview.source === "bulk" && (
            <p className="text-xs text-[var(--color-textMuted)]">
              Use the Bulk SSH Commander for its existing terminal workflow and
              execution confirmations. This entry cannot be imported as an
              interpreter script here.
            </p>
          )}
          <button
            type="button"
            className="sor-btn-secondary-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(preview.payload.script);
                setNotice("Commands copied as text. Nothing was executed.");
              } catch {
                setError(
                  "Clipboard access failed. You can select and copy the preview text manually.",
                );
              }
            }}
          >
            <Copy size={14} />
            Copy commands
          </button>
          <pre className="overflow-auto rounded bg-[var(--color-background)] p-3 text-xs whitespace-pre-wrap break-words">
            <code>{preview.payload.script}</code>
          </pre>
        </aside>
      </div>
      <div className="shrink-0 space-y-2 border-t border-[var(--color-border)] p-3">
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}{" "}
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={busy}
              onClick={() => setReload((value) => value + 1)}
            >
              Reload library
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="text-xs">
            {notice}
          </p>
        )}
        {replacements.length > 0 && (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            Replace the {replacements.length} selected saved default versions
            with shipped content. Custom scripts and other defaults are
            preserved.
          </label>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--color-textMuted)]">
            Only selected Script Manager templates are imported. Original
            catalog IDs are preserved. Nothing is added automatically.
          </span>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={
              !snapshot ||
              (library && !library.enabled) ||
              busy ||
              !selected.size ||
              (replacements.length > 0 && !overwrite)
            }
            onClick={async () => {
              if (!snapshot || busyRef.current) return;
              if (
                library &&
                (!library.enabled ||
                  !scopedSnapshot ||
                  latestLibrary.current?.accessKey !== library.accessKey ||
                  !latestLibrary.current.enabled)
              )
                return;
              busyRef.current = true;
              setBusy(true);
              setError(null);
              setNotice(null);
              try {
                let result: { value: PersistedManagedScripts };
                if (library && scopedSnapshot) {
                  if (replacements.length && !overwrite) return;
                  const changes: AutomationLibraryChange<"terminal-script">[] =
                    [];
                  for (const id of selected) {
                    const shipped = defaultScriptCatalog.find(
                      (entry) => entry.id === id,
                    );
                    if (!shipped) throw new Error("Invalid template selection");
                    const expected = scopedSnapshot.entries.find(
                      (entry) => entry.payload.id === id,
                    );
                    if (
                      expected &&
                      JSON.stringify(expected.payload) ===
                        JSON.stringify(shipped)
                    )
                      continue;
                    changes.push({
                      operation: "put",
                      entry: {
                        family: "terminal-script",
                        payload: shipped,
                        ...(expected?.provenance
                          ? { provenance: expected.provenance }
                          : {}),
                      },
                      ...(expected ? { expected } : {}),
                    });
                  }
                  const committed = changes.length
                    ? await library.api.apply(scopedSnapshot, changes)
                    : scopedSnapshot;
                  if (
                    !alive.current ||
                    latestLibrary.current?.accessKey !== library.accessKey ||
                    !latestLibrary.current.enabled
                  )
                    return;
                  setScopedSnapshot(committed);
                  result = {
                    value: buildManagedScriptsSnapshot(
                      committed.entries.map((entry) => entry.payload),
                      defaultScripts,
                    ),
                  };
                } else
                  result = await applyDefaultScriptSelection(
                    [...selected],
                    snapshot.value,
                    overwrite,
                  );
                if (!alive.current) return;
                setSnapshot({ value: result.value });
                setSelected(new Set());
                setOverwrite(false);
                onApplied(result.value);
                setNotice("Selected templates imported. Nothing was executed.");
              } catch {
                if (
                  !alive.current ||
                  (library &&
                    latestLibrary.current?.accessKey !== library.accessKey)
                )
                  return;
                setSnapshot(null);
                setError(
                  "Import was not confirmed. Reload the library and review your selection before retrying.",
                );
              } finally {
                busyRef.current = false;
                if (alive.current) setBusy(false);
              }
            }}
          >
            {busy ? "Importing…" : `Import / restore ${selected.size} selected`}
          </button>
        </div>
      </div>
    </section>
  );
}
