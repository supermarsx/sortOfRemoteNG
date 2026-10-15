import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  NotebookText,
  RefreshCw,
  Search,
} from "lucide-react";
import { useApplicationLogs } from "../../hooks/monitoring/useApplicationLogs";
import type { ApplicationLogSource } from "../../types/monitoring/applicationLogs";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import { Checkbox, Select } from "../ui/forms";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import {
  logCategories,
  logRowsText,
  newestLogRows,
  parseLogTimeline,
  type LogCategory,
} from "../../utils/monitoring/applicationLogTimeline";

/** Merges two bounded native tails without changing their writers or roots. */
export function ApplicationLogTimelineView({
  isActive,
  source = "application",
}: {
  isActive: boolean;
  source?: ApplicationLogSource;
}) {
  const owner = useContext(ConnectionContext)?.databaseAvailability;
  const ownerKey = JSON.stringify([
    owner?.databaseId,
    owner?.generation,
    owner?.status,
  ]);
  const [selection, setSelection] = useState("recent");
  const application = useApplicationLogs(
    "application",
    isActive && source === "application",
    ownerKey,
    selection === "recent",
  );
  const browser = useApplicationLogs(
    "browser",
    isActive,
    ownerKey,
    selection === "recent",
  );
  const [category, setCategory] = useState<LogCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [copyRevision, setCopyRevision] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState("");
  const [copying, setCopying] = useState(false);
  const title =
    source === "application" ? "Application logs" : "Browser startup journal";
  const readers = source === "browser" ? [browser] : [application, browser];
  const files = readers
    .flatMap((reader) =>
      reader.files.map((file) => ({
        ...file,
        source: reader.source,
        key: `${reader.source}:${file.id}`,
      })),
    )
    .sort(
      (a, b) =>
        b.modifiedUnixMs - a.modifiedUnixMs || a.key.localeCompare(b.key),
    );
  const selectedReaders =
    selection === "recent"
      ? readers
      : readers.filter((reader) => selection.startsWith(`${reader.source}:`));
  const loading = selectedReaders.some((reader) => reader.loading);
  const rows = useMemo(
    () =>
      newestLogRows(
        [
          {
            source: "application" as const,
            files: application.files,
            selectedId: application.selectedId,
            content: application.content,
          },
          {
            source: "browser" as const,
            files: browser.files,
            selectedId: browser.selectedId,
            content: browser.content,
          },
        ]
          .filter(
            (reader) =>
              (source === "application" || reader.source === "browser") &&
              (selection === "recent" ||
                selection.startsWith(`${reader.source}:`)),
          )
          .flatMap((reader) => {
            const file = reader.files.find(
              (item) => item.id === reader.selectedId,
            );
            return file && reader.content
              ? parseLogTimeline(reader.content.text, reader.source, file)
              : [];
          }),
      ),
    [
      application.content,
      application.files,
      application.selectedId,
      browser.content,
      browser.files,
      browser.selectedId,
      source,
      selection,
    ],
  );
  const displayedRows = rows.filter(
    (row) =>
      (category === "all" || row.category === category) &&
      `${row.level} ${row.message} ${row.details} ${logCategories[row.category]} ${row.file}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const displayedText = logRowsText(displayedRows);
  const revision = JSON.stringify([
    source,
    ownerKey,
    selection,
    category,
    search,
    application.revision,
    browser.revision,
  ]);
  const current = () =>
    isActive &&
    selectedReaders.every((reader) => reader.isCurrent(reader.revision));
  const setApplicationAutoRefresh = application.setAutoRefresh;
  const setBrowserAutoRefresh = browser.setAutoRefresh;
  useEffect(() => {
    setSelection("recent");
    setCategory("all");
    setSearch("");
    setApplicationAutoRefresh(false);
    setBrowserAutoRefresh(false);
  }, [source, ownerKey, setApplicationAutoRefresh, setBrowserAutoRefresh]);
  useEffect(() => {
    setCopyRevision(null);
    setCopyResult("");
  }, [revision, isActive]);
  const select = async (key: string) => {
    setCopyRevision(null);
    if (key === "recent") {
      setSelection(key);
      await Promise.all(
        readers.map((reader) =>
          reader.files[0] && reader.selectedId !== reader.files[0].id
            ? reader.selectFile(reader.files[0].id)
            : Promise.resolve(),
        ),
      );
      return;
    }
    const file = files.find((item) => item.key === key);
    if (!file) return;
    setSelection(key);
    const reader = readers.find((item) => item.source === file.source);
    if (reader) await reader.selectFile(file.id);
  };
  const refresh = () => Promise.all(readers.map((reader) => reader.refresh()));
  const copy = async () => {
    if (!current() || copyRevision !== revision || !displayedText || copying)
      return;
    setCopyRevision(null);
    setCopying(true);
    try {
      await navigator.clipboard.writeText(displayedText);
      if (current())
        setCopyResult("Displayed log records copied. Review before sharing.");
    } catch {
      if (current())
        setCopyResult(
          "Could not copy the log. Check clipboard permissions and try again.",
        );
    } finally {
      setCopying(false);
    }
  };
  return (
    <section
      aria-label={title}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-surface)]"
    >
      <header className="shrink-0 space-y-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <NotebookText size={16} aria-hidden="true" />
              {title}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-textMuted)]">
              {source === "application"
                ? "Application logs and native browser journals in one timeline. Recent view reads the newest file from each source; select a file to read its archive."
                : "Native browser startup and lifecycle records. Website console and page content are not included."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={!isActive || loading}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCopyRevision(revision)}
            disabled={!isActive || !displayedText || loading || copying}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <Copy size={14} aria-hidden="true" />
            Copy displayed log
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            label="Log file"
            value={selection}
            onChange={(key) => void select(key)}
            disabled={!isActive || loading}
            variant="form-sm"
            className="min-w-44 flex-1"
            options={[
              {
                value: "recent",
                label:
                  source === "application"
                    ? "Recent application and browser logs"
                    : "Recent browser journal",
              },
              ...files.map((file) => ({
                value: file.key,
                label: `${file.source === "browser" ? "Browser" : "Application"} · ${file.name}`,
                description: `${new Date(file.modifiedUnixMs).toLocaleString()}${file.encrypted ? " · Encrypted" : ""}`,
              })),
            ]}
            searchable
          />
          <Select
            label="Log category"
            value={category}
            onChange={(value) => setCategory(value as LogCategory | "all")}
            variant="form-sm"
            className="min-w-44"
            options={[
              { value: "all", label: "All categories" },
              ...Object.entries(logCategories).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <Checkbox
              checked={readers.every((reader) => reader.autoRefresh)}
              onChange={(value) =>
                readers.forEach((reader) => reader.setAutoRefresh(value))
              }
              disabled={!isActive}
            />
            Auto-refresh every 10 s
          </label>
          <div className="relative min-w-44 flex-1">
            <Search
              size={14}
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            />
            <input
              type="search"
              aria-label="Search log text"
              placeholder="Filter log records…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="sor-form-input sor-form-input-icon-left w-full text-xs"
              autoComplete="off"
            />
          </div>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-4">
        <p className="shrink-0 text-xs text-[var(--color-textMuted)]">
          Newest records first. Records without a wall timestamp use file
          modification and recorded order; timing values are elapsed from start.
          Application log text may contain private information; review before
          sharing.
        </p>
        {readers
          .filter((reader) => reader.error)
          .map((reader) => (
            <div
              key={reader.source}
              role="alert"
              className="shrink-0 rounded border border-error/30 bg-error/10 p-3 text-xs text-error"
            >
              <p className="font-medium">
                Could not load {reader.source} logs.
              </p>
              <p>{reader.error}</p>
              <p>
                Content from this source was cleared. Resolve the error, then
                Refresh.
              </p>
            </div>
          ))}
        {selectedReaders.some(
          (reader) => reader.truncated || reader.content?.truncated,
        ) && (
          <p role="status" className="shrink-0 text-xs text-warning">
            This is a bounded excerpt of the newest files and records; older
            data remains on disk.
          </p>
        )}
        {copyResult && (
          <p
            role="status"
            className="shrink-0 text-xs text-[var(--color-textSecondary)]"
          >
            {copyResult}
          </p>
        )}
        {loading && (
          <p role="status" className="text-xs text-[var(--color-textMuted)]">
            Loading log…
          </p>
        )}
        {!loading &&
          !rows.length &&
          !readers.some((reader) => reader.error) && (
            <p className="text-sm text-[var(--color-textMuted)]">
              No log records are available yet. Start a native browser or enable
              application logging, then Refresh.
            </p>
          )}
        {!!rows.length && (
          <div
            tabIndex={0}
            role="region"
            aria-label="Log content"
            className="@container min-h-0 min-w-0 flex-1 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text)]"
          >
            {displayedRows.length ? (
              <ol className="divide-y divide-[var(--color-border)]">
                {displayedRows.map((row) => (
                  <li key={row.id}>
                    <details className="group">
                      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          size={12}
                          aria-hidden="true"
                          className="shrink-0 transition-transform group-open:rotate-90"
                        />
                        <span
                          className="w-24 min-w-0 shrink truncate tabular-nums text-[var(--color-textMuted)] @2xl:w-40"
                          title={
                            row.timestampMs === null
                              ? `Recorded order ${row.sequence + 1} (no wall timestamp)`
                              : new Date(row.timestampMs).toLocaleString()
                          }
                        >
                          {row.timestampMs === null
                            ? `Recorded order ${row.sequence + 1}`
                            : new Date(row.timestampMs).toLocaleString()}
                        </span>
                        <span
                          className="hidden w-36 shrink-0 truncate text-[var(--color-textMuted)] @2xl:block"
                          title={logCategories[row.category]}
                        >
                          {logCategories[row.category]}
                        </span>
                        <span
                          className={`w-12 shrink-0 rounded px-1.5 text-center ${row.level === "ERROR" ? "bg-error/10 text-error" : row.level === "WARN" ? "bg-warning/10 text-warning" : "bg-[var(--color-surface)] text-[var(--color-textMuted)]"}`}
                        >
                          {row.level}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={row.message}
                        >
                          {row.message.replace(/\s+/g, " ")}
                        </span>
                      </summary>
                      <div className="space-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
                        <p className="select-text text-xs text-[var(--color-textMuted)]">
                          {row.timestampMs === null
                            ? `Recorded order ${row.sequence + 1} (no wall timestamp)`
                            : new Date(row.timestampMs).toLocaleString()}{" "}
                          · {logCategories[row.category]} · {row.level}
                        </p>
                        <p className="select-text whitespace-pre-wrap break-words text-sm">
                          {row.message}
                        </p>
                        {row.details && (
                          <p className="select-text whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-textSecondary)]">
                            {row.details}
                          </p>
                        )}
                        <p className="break-all text-xs text-[var(--color-textMuted)]">
                          {row.source === "browser"
                            ? "Browser journal"
                            : "Application file"}{" "}
                          · {row.file}
                        </p>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-3 text-sm">No log records match these filters.</p>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={
          isActive && copyRevision === revision && !!displayedText && current()
        }
        title="Copy log text?"
        message="Application logs may contain private addresses, account identifiers or file paths and are not automatically redacted. Only the displayed formatted records and their file provenance will be copied. Review before sharing."
        confirmText="Copy log text"
        variant="warning"
        confirmOnEnter={false}
        onConfirm={() => void copy()}
        onCancel={() => setCopyRevision(null)}
      />
    </section>
  );
}
