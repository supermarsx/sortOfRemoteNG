import { useEffect, useMemo, useState } from "react";
import { Download, FileJson, RefreshCw, Upload } from "lucide-react";
import type {
  AutomationFamily,
  AutomationLibraryApi,
  AutomationScope,
} from "../../../types/recording/automationLibrary";
import type {
  AutomationCatalogItem,
  AutomationCatalogResolution,
} from "../../../types/recording/automationCatalog";
import { useAutomationCatalog } from "../../../hooks/recording/useAutomationCatalog";
import ScriptCodeEditor from "../../ui/editor/ScriptCodeEditor";
import { detectLanguage } from "../../../utils/recording/scriptSyntax";
import AutomationSourceBadge from "./AutomationSourceBadge";
import { Select } from "../../ui/forms";

export interface RepositoryCatalogPanelProps {
  api: AutomationLibraryApi;
  scope: AutomationScope;
  family: AutomationFamily;
  enabled: boolean;
  accessKey: string | number;
  onApplied?: () => void;
  onBusyChange?: (busy: boolean) => void;
}
const AUTOMATION_FAMILY_LABELS: Record<AutomationFamily, string> = {
  "terminal-script": "Terminal scripts",
  "terminal-macro": "Terminal macros",
  "website-script": "Website scripts",
  "website-macro": "Website macros",
};
function SourcePreview({ item }: { item: AutomationCatalogItem }) {
  if (item.kind === "terminal-script" || item.kind === "website-script") {
    const code =
      item.kind === "terminal-script" ? item.payload.script : item.payload.code;
    const language =
      item.kind === "website-script"
        ? (item.payload.language ?? "javascript")
        : item.payload.language === "auto"
          ? detectLanguage(code)
          : item.payload.language;
    return (
      <ScriptCodeEditor
        code={code}
        language={language === "auto" ? "bash" : language}
        onChange={() => {}}
        readOnly
        ariaLabel="Catalog script source"
        documentKey={`${item.kind}:${item.id}`}
        minHeight={220}
      />
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-textMuted)]">
        Native macro steps · {item.payload.steps.length} steps. These are not
        converted into a script.
      </p>
      <pre
        aria-label="Catalog macro steps"
        className="max-h-64 overflow-auto rounded bg-[var(--color-background)] p-3 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        {JSON.stringify(item.payload.steps, null, 2)}
      </pre>
    </div>
  );
}

/** Manual external catalog browser. It never executes or enables automation. */
export default function RepositoryCatalogPanel(
  props: RepositoryCatalogPanelProps,
) {
  const mgr = useAutomationCatalog(props);
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  // Key UI choices without retaining private source bodies in selection state.
  const sourceKey = useMemo(
    () => Symbol(mgr.document?.source.sha256),
    [mgr.document],
  );
  const previewKey = useMemo(
    () => Symbol(mgr.preview?.snapshot.receipt),
    [mgr.preview],
  );
  const destinationKey = useMemo(
    () => Symbol(mgr.destination?.receipt),
    [mgr.destination],
  );
  const [selection, setSelection] = useState<{
    source: symbol | null;
    ids: string[];
  }>({ source: null, ids: [] });
  const [inspection, setInspection] = useState<{
    source: symbol | null;
    id: string | null;
  }>({ source: null, id: null });
  const [pagination, setPagination] = useState<{
    source: symbol | null;
    page: number;
  }>({ source: null, page: 0 });
  const [choices, setChoices] = useState<{
    preview: symbol | null;
    values: Record<string, AutomationCatalogResolution>;
  }>({ preview: null, values: {} });
  const [exportSelection, setExportSelection] = useState<{
    destination: symbol | null;
    ids: string[];
  }>({ destination: null, ids: [] });
  const selected = selection.source === sourceKey ? selection.ids : [];
  const inspecting = inspection.source === sourceKey ? inspection.id : null;
  const page = pagination.source === sourceKey ? pagination.page : 0;
  const resolutions = choices.preview === previewKey ? choices.values : {};
  const exportIds =
    exportSelection.destination === destinationKey ? exportSelection.ids : [];
  const setPage = (next: number) =>
    setPagination({ source: sourceKey, page: next });
  const { onBusyChange } = props;
  useEffect(() => {
    onBusyChange?.(mgr.busy);
    return () => onBusyChange?.(false);
  }, [mgr.busy, onBusyChange]);
  const entries = useMemo(
    () =>
      mgr.document?.manifest.entries.filter(
        (item) => item.kind === props.family,
      ) ?? [],
    [mgr.document, props.family],
  );
  const filtered = entries.filter((item) =>
    `${item.payload.name} ${item.description} ${item.platforms.join(" ")} ${item.tags?.join(" ") ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const shownPage = Math.min(page, pages - 1);
  const inspected = entries.find((item) => item.id === inspecting);
  const destination =
    props.scope.kind === "app"
      ? "App library"
      : `Selected database (${props.scope.databaseId.slice(0, 8)}…)`;
  const disabled = !props.enabled || mgr.busy;
  const readyChoices = Boolean(
    mgr.preview?.rows.length &&
    mgr.preview.rows.every((row) => resolutions[row.id]),
  );
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label="Repository automation catalogs"
    >
      <div className="space-y-1">
        <h3 className="sor-settings-section-header">
          <FileJson size={16} />
          Public repository indexes and JSON packs
        </h3>
        <p className="text-sm text-[var(--color-textMuted)]">
          Manually load a public HTTPS raw manifest or a local pack. Git
          repositories are read as data: no clone, hooks, dependency
          installation, automatic import, or execution.
        </p>
        <p
          className="break-words text-sm"
          title={
            props.scope.kind === "database" ? props.scope.databaseId : undefined
          }
        >
          <strong>Destination:</strong> {destination} ·{" "}
          {AUTOMATION_FAMILY_LABELS[props.family]}
        </p>
      </div>
      {!props.enabled && (
        <p role="status" className="text-warning">
          Unlock the selected library and wait for its access state before
          reviewing or exporting.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          Catalog link (raw HTTPS JSON)
          <input
            className="sor-form-input mt-1"
            aria-label="Catalog link (raw HTTPS JSON)"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://publisher.example/repository/ref/index.json"
            disabled={disabled}
          />
        </label>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={disabled || !url.trim()}
          onClick={() => void mgr.refresh(url.trim())}
        >
          <RefreshCw size={14} />
          Refresh source
        </button>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={disabled}
          onClick={() => void mgr.importFile()}
        >
          <Upload size={14} />
          Open JSON pack
        </button>
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        HTTPS only; no credentials, query strings, fragments, redirects or
        private-network sources. Maximum 2 MiB / 128 entries. Source publishers
        are not verified by importing a manifest. Private or authenticated
        repositories are not supported.
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        To publish your own index, select saved scripts or macros below, choose
        Export package, upload that JSON file to a public Git repository, then
        paste its raw HTTPS link here. No hand-written manifest is required.
        Refresh only updates the preview; importing is always explicit.
      </p>
      {mgr.error && (
        <p role="alert" className="break-words text-sm text-error">
          {mgr.error}
        </p>
      )}
      {mgr.message && (
        <p role="status" className="text-sm">
          {mgr.message}
        </p>
      )}
      {mgr.busy && (
        <p role="status" className="text-sm">
          Working on the explicitly requested catalog operation…
        </p>
      )}
      {mgr.document && (
        <div className="sor-settings-card min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="min-w-0 font-medium break-words">
              {mgr.document.manifest.name}
            </h4>
            <AutomationSourceBadge source="external" />
          </div>
          {mgr.document.manifest.publisher && (
            <p className="text-sm break-words">
              Publisher claim: {mgr.document.manifest.publisher.name}
            </p>
          )}
          <p className="text-sm break-words">
            {mgr.document.manifest.description}
          </p>
          <p className="text-xs [overflow-wrap:anywhere]">
            Source: {mgr.document.source.url ?? "User-selected JSON file"}
            <br />
            Read: {mgr.document.source.fetchedAt}
            <br />
            SHA-256 of reviewed bytes: {mgr.document.source.sha256}
          </p>
          {mgr.document.manifest.repository && (
            <p className="text-xs [overflow-wrap:anywhere]">
              Repository claim: {mgr.document.manifest.repository.url} · Ref{" "}
              {mgr.document.manifest.repository.ref} ·{" "}
              {mgr.document.manifest.repository.path}
            </p>
          )}
          {mgr.stale && (
            <p role="status" className="text-warning text-sm">
              Last loaded source retained for inspection only. Refresh
              successfully before importing.
            </p>
          )}
          <input
            className="sor-form-input"
            aria-label="Filter repository entries"
            placeholder="Filter names, descriptions, platforms or tags"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          <p className="text-xs">
            {filtered.length} matching{" "}
            {AUTOMATION_FAMILY_LABELS[props.family].toLowerCase()} ·{" "}
            {selected.length} selected
          </p>
          <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
            <div className="space-y-2">
              {filtered
                .slice(shownPage * 25, shownPage * 25 + 25)
                .map((item) => (
                  <div
                    key={`${item.kind}:${item.id}`}
                    className="flex min-w-0 items-start gap-2 rounded border border-[var(--color-border)] p-2"
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.payload.name}`}
                      checked={selected.includes(item.id)}
                      disabled={disabled || mgr.stale}
                      onChange={(event) => {
                        mgr.discardPreview();
                        const checked = event.target.checked;
                        setSelection((current) => {
                          const ids =
                            current.source === sourceKey ? current.ids : [];
                          return {
                            source: sourceKey,
                            ids: checked
                              ? [...ids, item.id]
                              : ids.filter((id) => id !== item.id),
                          };
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() =>
                        setInspection({ source: sourceKey, id: item.id })
                      }
                    >
                      <span className="block break-words font-medium">
                        {item.payload.name}
                      </span>
                      <span className="block break-words text-xs text-[var(--color-textMuted)]">
                        {item.description}
                      </span>
                      <span className="text-xs">
                        {item.platforms.join(" · ") || "Platform unspecified"}
                      </span>
                    </button>
                  </div>
                ))}
              {!filtered.length && (
                <p className="text-sm">
                  This source has no matching entries for the selected kind.
                </p>
              )}
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="sor-btn-secondary-sm"
                    disabled={shownPage === 0}
                    onClick={() => setPage(shownPage - 1)}
                  >
                    Previous
                  </button>
                  <span className="text-xs">
                    {shownPage + 1} / {pages}
                  </span>
                  <button
                    type="button"
                    className="sor-btn-secondary-sm"
                    disabled={shownPage + 1 >= pages}
                    onClick={() => setPage(shownPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
            <div className="min-w-0">
              {inspected ? (
                <>
                  <h4 className="mb-2 font-medium break-words">
                    {inspected.payload.name}
                  </h4>
                  <SourcePreview item={inspected} />
                </>
              ) : (
                <p className="text-sm text-[var(--color-textMuted)]">
                  Select a name to inspect its exact source or native macro
                  steps. Nothing is run here.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="sor-btn-secondary-sm self-start"
            disabled={disabled || mgr.stale || !selected.length}
            onClick={() => void mgr.review(selected)}
          >
            Review {selected.length} selected for import
          </button>
        </div>
      )}
      {mgr.preview && (
        <div className="sor-settings-card" aria-label="Reviewed import choices">
          <h4 className="font-medium">Review destination and conflicts</h4>
          <p className="text-sm">
            {destination} · {AUTOMATION_FAMILY_LABELS[props.family]}. Copies get
            new IDs; replacement preserves the existing ID and its favorites. No
            execution permissions are enabled.
          </p>
          {mgr.preview.rows.map((row) => (
            <label
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0 break-words">
                {row.name} ·{" "}
                {row.conflict ? "ID already exists" : "New source ID"}
              </span>
              <Select
                variant="form-sm"
                label={`Import choice for ${row.name}`}
                value={resolutions[row.id] ?? ""}
                disabled={disabled}
                onChange={(value) => {
                  if (disabled) return;
                  setChoices((current) => ({
                    preview: previewKey,
                    values: {
                      ...(current.preview === previewKey ? current.values : {}),
                      [row.id]: value as AutomationCatalogResolution,
                    },
                  }));
                }}
                options={[
                  { value: "", label: "Choose action" },
                  { value: "copy", label: "Import independent copy" },
                  { value: "skip", label: "Skip" },
                  ...(row.canReplace
                    ? [
                        {
                          value: "replace",
                          label: "Replace reviewed existing entry",
                        },
                      ]
                    : []),
                ]}
              />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={disabled}
              onClick={mgr.discardPreview}
            >
              Cancel import review
            </button>
            <button
              type="button"
              className="sor-btn-primary-sm"
              disabled={disabled || !readyChoices}
              onClick={async () => {
                if (await mgr.apply(resolutions)) props.onApplied?.();
              }}
            >
              Apply reviewed choices
            </button>
          </div>
        </div>
      )}
      <details className="sor-settings-card">
        <summary className="cursor-pointer text-sm font-medium">
          Export selected destination entries
        </summary>
        <p className="text-xs text-[var(--color-textMuted)]">
          Load the selected destination, review entries, then save a portable
          JSON pack. Secret-looking source is refused, not silently rewritten.
          The destination is rechecked after the Save dialog.
        </p>
        <button
          type="button"
          className="sor-btn-secondary-sm self-start"
          disabled={disabled}
          onClick={() => void mgr.loadDestination()}
        >
          Load destination entries
        </button>
        <div
          className="max-h-64 space-y-2 overflow-y-auto"
          aria-label="Destination export entries"
        >
          {mgr.destination?.entries.map((entry) => (
            <label
              key={entry.payload.id}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                aria-label={`Export ${entry.payload.name}`}
                checked={exportIds.includes(entry.payload.id)}
                disabled={disabled}
                onChange={(event) =>
                  setExportSelection((current) => {
                    const ids =
                      current.destination === destinationKey ? current.ids : [];
                    return {
                      destination: destinationKey,
                      ids: event.target.checked
                        ? [...ids, entry.payload.id]
                        : ids.filter((id) => id !== entry.payload.id),
                    };
                  })
                }
              />
              <span className="break-words">{entry.payload.name}</span>
            </label>
          ))}
        </div>
        {mgr.destination && !mgr.destination.entries.length && (
          <p className="text-sm">No entries in this destination.</p>
        )}
        <button
          type="button"
          className="sor-btn-secondary-sm self-start"
          disabled={disabled || !exportIds.length || !mgr.destination}
          onClick={() =>
            void mgr.exportSelected(exportIds, mgr.destination ?? undefined)
          }
        >
          <Download size={14} />
          Export package ({exportIds.length} selected)
        </button>
      </details>
    </section>
  );
}
