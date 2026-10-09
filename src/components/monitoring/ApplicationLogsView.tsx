import React, { useEffect, useMemo, useState } from "react";
import { Copy, NotebookText, RefreshCw, Search } from "lucide-react";
import { useApplicationLogs } from "../../hooks/monitoring/useApplicationLogs";
import type { ApplicationLogSource } from "../../types/monitoring/applicationLogs";
import { Checkbox, Select } from "../ui/forms";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { formatBytes } from "../../hooks/rdp/useRdpSessionPanel";

/** Actual native log files; ActionLogViewer remains a separate activity view. */
export function ApplicationLogsView({
  isActive,
  source = "application",
}: {
  isActive: boolean;
  source?: ApplicationLogSource;
}) {
  const logs = useApplicationLogs(source, isActive);
  const [search, setSearch] = useState("");
  const [copyRevision, setCopyRevision] = useState<number | null>(null);
  const [copyResult, setCopyResult] = useState("");
  const [copying, setCopying] = useState(false);
  const title =
    source === "application" ? "Application logs" : "Browser startup journal";
  const selectedFile = logs.files.find((file) => file.id === logs.selectedId);
  const displayedText = useMemo(() => {
    const text = logs.content?.text ?? "";
    const query = search.trim().toLocaleLowerCase();
    return query
      ? text
          .split(/\r?\n/)
          .filter((line) => line.toLocaleLowerCase().includes(query))
          .join("\n")
      : text;
  }, [logs.content, search]);

  useEffect(() => {
    setSearch("");
  }, [source, logs.selectedId]);
  useEffect(() => {
    setCopyRevision(null);
    setCopyResult("");
  }, [source, logs.revision, isActive]);

  const copy = async () => {
    if (
      !isActive ||
      !logs.content ||
      copyRevision !== logs.revision ||
      !logs.isCurrent(logs.revision) ||
      copying
    )
      return;
    setCopyRevision(null);
    setCopying(true);
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopyResult("Displayed log text copied. Review it before sharing.");
    } catch {
      setCopyResult(
        "Could not copy the log. Check clipboard permissions and try again, or select the displayed text and copy it manually.",
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
            <p className="mt-1 max-w-3xl text-xs text-[var(--color-textMuted)]">
              {source === "application"
                ? "Native application log files. Recorded user actions remain in Action Log; encrypted logs require unlocked application storage."
                : "Native browser startup and lifecycle/session breadcrumbs. This is not a website JavaScript console or a complete network trace."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void logs.refresh()}
            disabled={!isActive || logs.loading}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={logs.loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCopyRevision(logs.revision)}
            disabled={!isActive || !displayedText || logs.loading || copying}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <Copy size={14} aria-hidden="true" />
            Copy displayed log
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            label="Log file"
            value={logs.selectedId}
            onChange={(id) => void logs.selectFile(id)}
            disabled={!isActive || logs.loading || !logs.files.length}
            placeholder="No log files"
            variant="form-sm"
            className="min-w-44 max-w-full flex-1"
            options={logs.files.map((file) => ({
              value: file.id,
              label: file.name,
              description: `${new Date(file.modifiedUnixMs).toLocaleString()} · ${formatBytes(file.sizeBytes)}${file.encrypted ? " · Encrypted" : ""}`,
            }))}
            searchable
          />
          <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
            <Checkbox
              checked={logs.autoRefresh}
              onChange={logs.setAutoRefresh}
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
              placeholder="Filter log lines…"
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
          Logs can contain private addresses, file paths and other sensitive
          information. Review before copying or sharing.
        </p>
        {logs.error && (
          <div
            role="alert"
            className="shrink-0 rounded border border-error/30 bg-error/10 p-3 text-xs text-error"
          >
            <p className="font-medium">Could not load {title.toLowerCase()}.</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{logs.error}</p>
            <p className="mt-1">
              Content was cleared. Resolve the error, then use Refresh to retry.
            </p>
          </div>
        )}
        {logs.truncated && (
          <p role="status" className="shrink-0 text-xs text-warning">
            Only the newest log files are listed; older files remain on disk.
          </p>
        )}
        {logs.content?.truncated && (
          <p role="status" className="shrink-0 text-xs text-warning">
            This is a bounded excerpt, not the complete log file.
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
        {logs.loading ? (
          <p role="status" className="text-xs text-[var(--color-textMuted)]">
            Loading log…
          </p>
        ) : !logs.error && !logs.files.length ? (
          <p className="text-sm text-[var(--color-textMuted)]">
            {source === "browser"
              ? "No browser startup journal is available yet. Start a native browser, then Refresh."
              : "No application log files are available. Logging may be disabled or no file has been written yet."}
          </p>
        ) : null}
        {logs.content && (
          <>
            <div className="flex shrink-0 flex-wrap gap-x-3 text-xs text-[var(--color-textMuted)]">
              <span>{selectedFile?.name}</span>
              {selectedFile && (
                <span>
                  {formatBytes(selectedFile.sizeBytes)} on disk
                  {selectedFile.encrypted ? " · Encrypted at rest" : ""}
                </span>
              )}
              {logs.loadedAt && (
                <span>Read {new Date(logs.loadedAt).toLocaleTimeString()}</span>
              )}
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-label="Log content"
              className="min-h-0 min-w-0 flex-1 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-[var(--color-text)]"
            >
              <pre className="select-text whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {displayedText ||
                  (search.trim()
                    ? "No log lines match this search."
                    : "This log file is empty.")}
              </pre>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        isOpen={
          isActive &&
          copyRevision !== null &&
          copyRevision === logs.revision &&
          logs.content !== null
        }
        title="Copy log text?"
        message="Native logs may contain sensitive information such as private addresses, account identifiers or file paths. Only the displayed text will be copied; it is not automatically redacted. Review it before sharing."
        confirmText="Copy log text"
        variant="warning"
        confirmOnEnter={false}
        onConfirm={() => void copy()}
        onCancel={() => setCopyRevision(null)}
      />
    </section>
  );
}
