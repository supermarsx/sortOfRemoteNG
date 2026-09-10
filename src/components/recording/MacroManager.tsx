import { lazy, Suspense, useState } from "react";
import {
  BookOpen,
  Copy,
  Disc,
  Download,
  Globe,
  Plus,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  useMacroManager,
  type MacroFamily,
  type MacroTab,
} from "../../hooks/recording/useMacroManager";
import { MacroEditor } from "./MacroEditor";
import { WebsiteMacroEditor } from "./WebsiteMacroEditor";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { OS_TAG_LABELS, type OSTag } from "./scriptManager/shared";
import { ScriptMetadataIcon } from "./scriptManager/ScriptMetadataIcon";
import { bundledMacroCatalog } from "../../data/bundledMacroCatalog";
import { formatDuration } from "../../utils/core/formatters";

const RepositoryCatalogPanel = lazy(
  () => import("./scriptManager/RepositoryCatalogPanel"),
);
type Mgr = ReturnType<typeof useMacroManager>;

function MacroLibrary({ mgr }: { mgr: Mgr }) {
  const entry = mgr.draft;
  const categories = [
    ...new Set(
      mgr.entries.map((item) =>
        item.family === "terminal-macro"
          ? (item.payload.category ?? "")
          : "Website interactions",
      ),
    ),
  ]
    .filter(Boolean)
    .sort();
  const platforms = [
    ...new Set(mgr.entries.flatMap((item) => item.provenance?.platforms ?? [])),
  ].sort();
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <label className="flex min-w-48 max-w-sm flex-1 items-center gap-2 rounded border border-[var(--color-border)] px-3 py-1.5">
          <Search size={15} aria-hidden="true" />
          <input
            aria-label="Search macros"
            value={mgr.searchQuery}
            onChange={(event) => mgr.setSearchQuery(event.target.value)}
            placeholder="Search name, tags or platform"
            className="sor-search-inline min-w-0 w-full"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          Category
          <select
            className="sor-form-input w-auto max-w-48"
            style={{ width: "auto" }}
            value={mgr.category}
            onChange={(event) => mgr.setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          Platform
          <select
            className="sor-form-input w-auto max-w-48"
            style={{ width: "auto" }}
            value={mgr.platform}
            onChange={(event) => mgr.setPlatform(event.target.value)}
          >
            <option value="">All platforms</option>
            {platforms.map((value) => (
              <option key={value} value={value}>
                {OS_TAG_LABELS[value as OSTag] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          Sort
          <select
            className="sor-form-input w-auto"
            style={{ width: "auto" }}
            value={mgr.sort}
            onChange={(event) =>
              mgr.setSort(event.target.value as "name" | "updated")
            }
          >
            <option value="name">Name</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
        {(mgr.searchQuery || mgr.category || mgr.platform) && (
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={() => {
              mgr.setSearchQuery("");
              mgr.setCategory("");
              mgr.setPlatform("");
            }}
          >
            Clear filters
          </button>
        )}
        <button
          type="button"
          disabled={!mgr.ready || mgr.busy}
          onClick={mgr.handleNewMacro}
          className="sor-btn sor-btn-primary ml-auto"
        >
          <Plus size={14} />
          New macro
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(120px,35%)_1fr] overflow-hidden md:grid-cols-[minmax(220px,32%)_1fr] md:grid-rows-1">
        <section
          aria-label="Saved macros"
          className="flex min-h-0 flex-col border-b border-[var(--color-border)] md:border-b-0 md:border-r"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!mgr.ready ? (
              <p className="p-4 text-sm">
                {mgr.loading
                  ? "Loading macro library…"
                  : "Library unavailable. Existing macros have not been reset."}
              </p>
            ) : mgr.pagedEntries.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-textSecondary)]">
                {mgr.entries.length
                  ? "No macros match these filters."
                  : "No macros in this scope. Create one or browse templates."}
              </p>
            ) : (
              mgr.pagedEntries.map((item) => (
                <button
                  type="button"
                  key={item.payload.id}
                  onClick={() => mgr.selectEntry(item)}
                  disabled={mgr.busy}
                  aria-pressed={entry?.payload.id === item.payload.id}
                  className={`flex w-full flex-col gap-1 border-b border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surfaceHover)] ${entry?.payload.id === item.payload.id ? "border-l-2 border-l-primary bg-primary/10" : ""}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {item.family === "terminal-macro" ? (
                      <Terminal size={16} />
                    ) : (
                      <Globe size={16} />
                    )}
                    <span className="truncate">{item.payload.name}</span>
                  </span>
                  <span className="text-xs text-[var(--color-textSecondary)]">
                    {item.payload.steps.length} steps ·{" "}
                    {item.family === "terminal-macro"
                      ? item.payload.category || "Uncategorized"
                      : "Website interactions"}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {item.provenance?.platforms?.map((value) => (
                      <span
                        key={value}
                        className="flex items-center gap-1 text-xs"
                      >
                        {value in OS_TAG_LABELS && (
                          <ScriptMetadataIcon
                            platform={value as OSTag}
                            size={12}
                          />
                        )}{" "}
                        {OS_TAG_LABELS[value as OSTag] ?? value}
                      </span>
                    ))}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-3 py-2 text-xs">
            <span>
              {mgr.filteredEntries.length} of {mgr.entries.length} macros
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={mgr.page === 0}
                onClick={() => mgr.setPage(mgr.page - 1)}
              >
                Previous
              </button>
              <span>
                {mgr.page + 1}/{mgr.pageCount}
              </span>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={mgr.page + 1 >= mgr.pageCount}
                onClick={() => mgr.setPage(mgr.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
        <section
          aria-label="Macro details"
          className="min-h-0 min-w-0 overflow-y-auto p-4"
        >
          {entry ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--color-textSecondary)]">
                  {mgr.dirty ? "Unsaved draft" : "Saved macro"} ·{" "}
                  {mgr.scope.kind === "app" ? "App-wide" : "Database"}
                </span>
                <button
                  type="button"
                  disabled={mgr.busy}
                  className="sor-btn sor-btn-secondary"
                  onClick={mgr.closeDraft}
                >
                  Close draft
                </button>
              </div>
              <fieldset disabled={mgr.busy} className="mb-4 space-y-2">
                <legend className="mb-2 text-xs font-medium">
                  Platform tags
                </legend>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  User-assigned metadata, not a compatibility or execution
                  guarantee.
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(OS_TAG_LABELS).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={
                        entry.provenance?.platforms?.includes(value) ?? false
                      }
                      className={`sor-btn sor-btn-secondary text-xs ${entry.provenance?.platforms?.includes(value) ? "border-primary bg-primary/15" : ""}`}
                      onClick={() => {
                        const previous = entry.provenance?.platforms ?? [];
                        mgr.editEntry({
                          ...entry,
                          provenance: {
                            ...entry.provenance,
                            platforms: previous.includes(value)
                              ? previous.filter((item) => item !== value)
                              : [...previous, value],
                          },
                        });
                      }}
                    >
                      <ScriptMetadataIcon platform={value as OSTag} size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {entry.family === "terminal-macro" ? (
                <MacroEditor
                  key={entry.payload.id}
                  macro={entry.payload}
                  disabled={mgr.busy}
                  saved={mgr.entries.some(
                    (item) => item.payload.id === entry.payload.id,
                  )}
                  onChange={(payload) => mgr.editEntry({ ...entry, payload })}
                  onSave={() => void mgr.saveEntry(entry)}
                  onDelete={() => {
                    const saved = mgr.entries.find(
                      (item) => item.payload.id === entry.payload.id,
                    );
                    if (saved) mgr.deleteEntry(saved);
                  }}
                  onDuplicate={() => mgr.duplicateEntry(entry)}
                />
              ) : (
                <WebsiteMacroEditor
                  macro={entry.payload}
                  disabled={mgr.busy}
                  saved={mgr.entries.some(
                    (item) => item.payload.id === entry.payload.id,
                  )}
                  onChange={(payload) => mgr.editEntry({ ...entry, payload })}
                  onSave={() => void mgr.saveEntry(entry)}
                  onDelete={() => {
                    const saved = mgr.entries.find(
                      (item) => item.payload.id === entry.payload.id,
                    );
                    if (saved) mgr.deleteEntry(saved);
                  }}
                  onDuplicate={() => mgr.duplicateEntry(entry)}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--color-textSecondary)]">
              Select a macro to review its ordered steps, or create a new draft.
              No commands or website actions run from this manager.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function BrowseMacros({
  mgr,
  onBusyChange,
  blocked,
}: {
  mgr: Mgr;
  onBusyChange: (busy: boolean) => void;
  blocked: boolean;
}) {
  const [family, setFamily] = useState<MacroFamily>("terminal-macro");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
      <label className="flex items-center gap-2 text-sm">
        Macro kind
        <select
          className="sor-form-input w-auto"
          style={{ width: "auto" }}
          value={family}
          disabled={blocked}
          onChange={(event) => setFamily(event.target.value as MacroFamily)}
        >
          <option value="terminal-macro">Terminal sequences</option>
          <option value="website-macro">Website interactions</option>
        </select>
      </label>
      {family === "terminal-macro" ? (
        <section aria-label="App-shipped macro templates">
          <h2 className="text-sm font-medium">
            App-shipped diagnostic sequences
          </h2>
          <p className="my-2 text-xs text-[var(--color-textSecondary)]">
            Original macro steps, not converted scripts. Use a copy to review
            and save to the selected scope. Nothing runs automatically.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {bundledMacroCatalog.map((entry) => (
              <article
                key={entry.payload.id}
                className="rounded border border-[var(--color-border)] p-3"
              >
                <h3 className="text-sm font-medium">{entry.payload.name}</h3>
                <p className="my-2 text-xs text-[var(--color-textSecondary)]">
                  {entry.provenance?.platforms
                    ?.map((p) => OS_TAG_LABELS[p as OSTag] ?? p)
                    .join(" · ")}
                </p>
                <ol className="my-2 space-y-1 font-mono text-xs">
                  {entry.payload.steps.map((step, index) => (
                    <li key={index}>
                      {index + 1}. {step.command}{" "}
                      <span className="font-sans text-[var(--color-textSecondary)]">
                        · {step.delayMs} ms · Enter
                      </span>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={!mgr.ready || mgr.busy}
                  onClick={() => mgr.useTemplate(entry)}
                >
                  <Copy size={14} />
                  Use copy as draft
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Create website interaction macros in the Website macros tab, record
          them in an explicitly enabled HTTP(S) session, or review a compatible
          catalog below. Input values are not stored.
        </p>
      )}
      <Suspense fallback={<p role="status">Loading repository browser…</p>}>
        <RepositoryCatalogPanel
          key={`${mgr.accessKey}:${family}`}
          api={mgr.api}
          scope={mgr.scope}
          family={family}
          accessKey={mgr.accessKey}
          enabled={mgr.available && mgr.ready}
          onApplied={() => void mgr.refresh()}
          onBusyChange={onBusyChange}
        />
      </Suspense>
    </div>
  );
}

function Recordings({ mgr }: { mgr: Mgr }) {
  const [rename, setRename] = useState<{ id: string; value: string } | null>(
    null,
  );
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-3 text-xs text-[var(--color-textSecondary)]">
        Session recordings are a separate app-wide library, not macros and not
        changed by the macro scope selector.
      </p>
      <label className="mb-4 flex max-w-sm items-center gap-2 rounded border border-[var(--color-border)] px-3 py-2">
        <Search size={14} />
        <input
          aria-label="Search recordings"
          value={mgr.searchQuery}
          onChange={(event) => mgr.setSearchQuery(event.target.value)}
          placeholder="Search recordings or hosts"
          className="sor-search-inline min-w-0 w-full"
        />
      </label>
      {mgr.recordingError && (
        <p role="alert" className="mb-3 text-sm text-warning">
          {mgr.recordingError}{" "}
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={() => void mgr.refreshRecordings()}
          >
            Retry recordings
          </button>
        </p>
      )}
      {!mgr.filteredRecordings.length && (
        <p className="text-sm text-[var(--color-textSecondary)]">
          No matching saved recordings.
        </p>
      )}
      <div className="space-y-3">
        {[...mgr.filteredRecordings]
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((rec) => (
            <article
              key={rec.id}
              className="rounded border border-[var(--color-border)] p-3"
            >
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Disc size={15} />
                {rec.name}
              </h3>
              <p className="my-2 text-xs text-[var(--color-textSecondary)]">
                {rec.recording.metadata.host} ·{" "}
                {formatDuration(rec.recording.metadata.duration_ms)} ·{" "}
                {rec.recording.metadata.entry_count} entries ·{" "}
                {new Date(rec.savedAt).toLocaleDateString()}
              </p>
              <div className="flex flex-wrap gap-2">
                {rename?.id === rec.id ? (
                  <>
                    <input
                      aria-label="Recording name"
                      value={rename.value}
                      onChange={(event) =>
                        setRename({ ...rename, value: event.target.value })
                      }
                      className="sor-form-input"
                    />
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary"
                      onClick={async () => {
                        if (await mgr.handleRenameRecording(rec, rename.value))
                          setRename(null);
                      }}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary"
                      onClick={() => setRename(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    onClick={() => setRename({ id: rec.id, value: rec.name })}
                  >
                    Rename
                  </button>
                )}
                {(["asciicast", "script", "json"] as const).map((format) => (
                  <button
                    type="button"
                    key={format}
                    className="sor-btn sor-btn-secondary"
                    onClick={() => void mgr.handleExportRecording(rec, format)}
                  >
                    <Download size={14} />
                    {format === "script" ? "Text" : format}
                  </button>
                ))}
                <button
                  type="button"
                  className="sor-btn sor-btn-danger ml-auto"
                  onClick={() => mgr.handleDeleteRecording(rec.id)}
                >
                  <Trash2 size={14} />
                  Delete recording
                </button>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}

export function MacroManager({
  isOpen,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const mgr = useMacroManager(isOpen);
  const [catalogBusy, setCatalogBusy] = useState(false);
  if (!isOpen) return null;
  const tabs = [
    { id: "macros", label: "Terminal macros", icon: Terminal },
    { id: "website", label: "Website macros", icon: Globe },
    { id: "browse", label: "Browse macros", icon: BookOpen },
    { id: "recordings", label: "Recordings", icon: Disc },
  ] as const;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-surface)]">
      <div
        role="tablist"
        aria-label="Macro Manager sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--color-border)] px-3 pt-2"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mgr.activeTab === id}
            disabled={mgr.busy || catalogBusy}
            className={`sor-tab-trigger ${mgr.activeTab === id ? "sor-tab-trigger-active" : ""}`}
            onClick={() => mgr.setActiveTab(id as MacroTab)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {mgr.activeTab !== "recordings" && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs">
          <label className="flex items-center gap-2">
            Library scope
            <select
              aria-label="Macro library scope"
              className="sor-form-input w-auto max-w-xs"
              style={{ width: "auto" }}
              disabled={mgr.busy || catalogBusy}
              value={mgr.scope.kind === "app" ? "app" : mgr.scope.databaseId}
              onChange={(event) =>
                mgr.changeScope(
                  event.target.value === "app"
                    ? { kind: "app" }
                    : { kind: "database", databaseId: event.target.value },
                )
              }
            >
              <option value="app">App-wide</option>
              {mgr.databaseScope && (
                <option value={mgr.databaseScope.databaseId}>
                  Current database
                </option>
              )}
              {mgr.scope.kind === "database" &&
                mgr.databaseScope?.databaseId !== mgr.scope.databaseId && (
                  <option value={mgr.scope.databaseId}>
                    Owning database (unavailable)
                  </option>
                )}
            </select>
          </label>
          <span
            className="min-w-0 break-all text-[var(--color-textSecondary)]"
            title={
              mgr.scope.kind === "database" ? mgr.scope.databaseId : undefined
            }
          >
            {mgr.scope.kind === "app"
              ? "Shared across connections; protected by app storage settings."
              : `Database: ${mgr.scope.databaseId}. No app-wide fallback.`}
          </span>
          <button
            type="button"
            disabled={mgr.busy || catalogBusy || mgr.loading || !mgr.available}
            className="sor-btn sor-btn-secondary ml-auto"
            onClick={() => void mgr.refresh()}
          >
            Reload library
          </button>
        </div>
      )}
      {mgr.activeTab !== "recordings" && (!mgr.available || mgr.error) && (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--color-border)] px-4 py-3 text-sm text-warning"
        >
          {mgr.error ??
            mgr.diagnostic?.message ??
            (!mgr.settingsReady
              ? "Waiting for app settings to initialize."
              : mgr.scope.kind === "database"
                ? "Open and unlock the selected library's owning database, or explicitly select App-wide."
                : "Checking the desktop library access listener. This app-wide library does not require an open database.")}
          {mgr.diagnostic?.retryable && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary ml-2"
              onClick={mgr.retry}
            >
              Retry library access
            </button>
          )}
        </div>
      )}
      {mgr.busy && (
        <p role="status" className="px-4 py-2 text-xs">
          Saving reviewed changes…
        </p>
      )}
      {mgr.activeTab === "browse" ? (
        <BrowseMacros
          mgr={mgr}
          onBusyChange={setCatalogBusy}
          blocked={catalogBusy}
        />
      ) : mgr.activeTab === "recordings" ? (
        <Recordings mgr={mgr} />
      ) : (
        <MacroLibrary mgr={mgr} />
      )}
      <ConfirmDialog
        isOpen={!!mgr.review}
        title={mgr.review?.title}
        message={mgr.review?.message ?? ""}
        variant={mgr.review?.destructive ? "danger" : "warning"}
        confirmText={mgr.review?.destructive ? "Delete" : "Discard changes"}
        confirmOnEnter={false}
        onConfirm={mgr.confirmReview}
        onCancel={mgr.cancelReview}
      />
    </div>
  );
}
export default MacroManager;
