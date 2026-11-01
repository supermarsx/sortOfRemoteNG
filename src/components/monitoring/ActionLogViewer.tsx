import React from "react";
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Search,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import {
  ACTION_LOG_SOURCES,
  type ActionLogSortKey,
  useActionLogViewer,
} from "../../hooks/monitoring/useActionLogViewer";
import { useLocaleFormat } from "../../hooks/settings/useLocaleFormat";
import { EmptyState } from "../ui/display";
import { Checkbox } from "../ui/forms";
import { LogSelectionToolbar } from "./LogSelectionToolbar";

interface ActionLogViewerProps {
  isOpen: boolean;
  /** Session Manager supplies its visibility/minimize gate. */
  isActive?: boolean;
  /** Legacy callers may still supply this; this embedded view has no close chrome. */
  onClose?: () => void;
}
type Manager = ReturnType<typeof useActionLogViewer>;
const LEVEL_COLORS: Record<string, string> = {
  debug: "text-[var(--color-textMuted)]",
  info: "text-primary",
  warn: "text-warning",
  error: "text-error",
};

function LogFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-textSecondary)]">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="sor-form-select-sm max-w-52"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LogToolbar({ manager: m }: { manager: Manager }) {
  return (
    <div className="shrink-0 border-b border-[var(--color-border)] p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
            <ScrollText size={16} aria-hidden="true" /> Action Log
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-[var(--color-textMuted)]">
            Session activity is retained in this window’s memory, up to{" "}
            {m.sessionLimit.toLocaleString()} entries; older entries are
            evicted. Application history follows your log retention settings.
          </p>
        </div>
        <div className="flex flex-wrap shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void m.copyFilteredDiagnostics()}
            disabled={!m.filteredLogs.length || m.copying !== null}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <Copy size={14} aria-hidden="true" /> Copy filtered diagnostics
          </button>
          <button
            type="button"
            onClick={m.exportLogs}
            disabled={!m.filteredLogs.length}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <Download size={14} aria-hidden="true" /> Export diagnostics CSV
          </button>
          <button
            type="button"
            onClick={m.requestLegacyExport}
            disabled={!m.filteredApplicationLogs.length}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            Export application log…
          </button>
          <button
            type="button"
            onClick={m.clearLogs}
            disabled={!m.logs.length}
            className="sor-option-chip text-xs text-error disabled:opacity-40"
          >
            <Trash2 size={14} aria-hidden="true" /> {m.t("logs.clear", "Clear")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search
            size={14}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="search"
            placeholder="Search logs..."
            aria-label="Search logs"
            value={m.searchTerm}
            onChange={(event) => m.setSearchTerm(event.target.value)}
            autoComplete="off"
            className="sor-form-input sor-form-input-icon-left w-full text-xs"
          />
        </div>
        <Filter
          size={14}
          aria-hidden="true"
          className="text-[var(--color-textMuted)]"
        />
        <LogFilter
          label="Filter by source"
          value={m.sourceFilter}
          onChange={m.setSourceFilter}
          options={[
            { value: "all", label: "All sources" },
            ...ACTION_LOG_SOURCES,
          ]}
        />
        <LogFilter
          label="Filter by level"
          value={m.levelFilter}
          onChange={m.setLevelFilter}
          options={[
            { value: "all", label: "All levels" },
            { value: "debug", label: "Debug" },
            { value: "info", label: "Info" },
            { value: "warn", label: "Warning" },
            { value: "error", label: "Error" },
          ]}
        />
        <LogFilter
          label="Filter by action"
          value={m.actionFilter}
          onChange={m.setActionFilter}
          options={[
            { value: "all", label: "All actions" },
            ...m.uniqueActions.map((action) => ({
              value: action,
              label: action,
            })),
          ]}
        />
        <LogFilter
          label="Filter by connection"
          value={m.connectionFilter}
          onChange={m.setConnectionFilter}
          options={[
            { value: "all", label: "All connections" },
            ...m.uniqueConnections.map((connection) => ({
              value: connection,
              label: connection,
            })),
          ]}
        />
        <LogFilter
          label="Filter by time"
          value={m.dateFilter}
          onChange={m.setDateFilter}
          options={[
            { value: "all", label: "All time" },
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "week", label: "Last 7 days" },
            { value: "month", label: "Last 30 days" },
          ]}
        />
        {m.hasActiveFilters && (
          <button
            type="button"
            onClick={m.resetFilters}
            className="sor-option-chip text-xs text-warning"
          >
            <X size={12} aria-hidden="true" /> Clear filters
          </button>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-textMuted)]">
        Diagnostics omit legacy application names and free-text action/details.
        CSV includes all matching rows, not just the current page.
      </p>
      <LogSelectionToolbar
        selecting={m.selecting}
        selectedCount={m.selectedCount}
        allSelected={m.allSelected}
        disabled={!m.filteredLogs.length || m.copying !== null}
        onToggleMode={m.toggleSelection}
        onSelectAll={m.selectAll}
        onClear={m.clearSelection}
        onCopy={() => void m.copySelectedDiagnostics()}
      />
      {m.selecting && (
        <p role="status" className="text-[11px] text-[var(--color-textMuted)]">
          Updates are paused while selecting logs. Done selecting resumes
          current activity.
        </p>
      )}
      {m.feedback && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          {m.feedback}
        </p>
      )}
    </div>
  );
}

function SortHeading({
  manager: m,
  field,
  children,
}: {
  manager: Manager;
  field: ActionLogSortKey;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => m.sortBy(field)}
      aria-label={`Sort logs by ${field}`}
      aria-pressed={m.sortKey === field}
      title={
        m.sortKey === field
          ? `Sorted ${m.sortDirection === "asc" ? "ascending" : "descending"}`
          : `Sort by ${field}`
      }
      className="sor-option-chip text-xs"
    >
      {children}
      <ArrowUpDown
        size={12}
        aria-hidden="true"
        className={m.sortKey === field ? "text-primary" : "opacity-50"}
      />
      {m.sortKey === field && (
        <span className="sr-only">
          {m.sortDirection === "asc" ? "ascending" : "descending"}
        </span>
      )}
    </button>
  );
}

function LogList({ manager: m }: { manager: Manager }) {
  const { formatDate, formatTime } = useLocaleFormat();
  return (
    <>
      <div
        role="group"
        aria-label="Sort action logs"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2 text-xs"
      >
        <span className="text-[var(--color-textMuted)]">Sort by</span>
        {(
          [
            ["timestamp", "Time"],
            ["source", "Source"],
            ["level", "Level"],
            ["action", "Action"],
            ["connection", "Connection"],
            ["duration", "Duration"],
          ] as const
        ).map(([field, label]) => (
          <SortHeading key={field} manager={m} field={field}>
            {label}
          </SortHeading>
        ))}
      </div>
      <div
        role="region"
        aria-label="Action log entries"
        tabIndex={0}
        className="@container min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--color-background)] text-[var(--color-text)]"
        data-testid="action-log-scroll-region"
      >
        <ol className="divide-y divide-[var(--color-border)]">
          {m.pageLogs.map((log) => (
            <li
              key={log.rowKey}
              data-testid="action-log-row"
              className={`flex min-w-0 items-start ${m.selectedIds.has(log.rowKey) ? "bg-primary/10" : ""}`}
            >
              {m.selecting && (
                <Checkbox
                  aria-label={`Select ${log.localAlias}`}
                  checked={m.selectedIds.has(log.rowKey)}
                  onChange={(checked) => m.selectRow(log.rowKey, checked)}
                  className="ml-3 mt-2 shrink-0"
                />
              )}
              <details className="group min-w-0 flex-1">
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={12}
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open:rotate-90"
                  />
                  <time
                    dateTime={String(log.timestamp)}
                    title={`${formatDate(log.timestamp)} ${formatTime(log.timestamp)}`}
                    className="w-24 min-w-0 shrink truncate tabular-nums text-[var(--color-textMuted)] @2xl:w-40"
                  >
                    {formatDate(log.timestamp)} {formatTime(log.timestamp)}
                  </time>
                  <span
                    className="hidden w-36 shrink-0 truncate text-[var(--color-textMuted)] @2xl:block"
                    title={log.sourceLabel}
                  >
                    {log.sourceLabel}
                  </span>
                  <span
                    className={`w-12 shrink-0 rounded px-1.5 text-center uppercase ${LEVEL_COLORS[log.level]}`}
                  >
                    {log.level}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={`${log.action}: ${log.details}`}
                  >
                    {log.action} · {log.details.replace(/\s+/g, " ")}
                  </span>
                  {log.duration != null && (
                    <span className="hidden shrink-0 tabular-nums text-[var(--color-textMuted)] @2xl:block">
                      {log.duration} ms
                    </span>
                  )}
                </summary>
                <div className="space-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
                  <p className="select-text whitespace-pre-wrap break-words text-sm">
                    {log.details}
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-textSecondary)]">
                    <dt>Action</dt>
                    <dd className="break-words">{log.action}</dd>
                    <dt>Source</dt>
                    <dd>{log.sourceLabel}</dd>
                    <dt>Connection</dt>
                    <dd className="break-words">{log.connectionName || "—"}</dd>
                    <dt>Duration</dt>
                    <dd>{log.duration == null ? "—" : `${log.duration} ms`}</dd>
                  </dl>
                </div>
              </details>
              <button
                type="button"
                aria-label={`Copy diagnostics for ${log.localAlias}`}
                title="Copy diagnostics; legacy names and free text are omitted"
                disabled={m.copying !== null}
                onClick={() => void m.copyLog(log)}
                className="sor-icon-btn-sm mt-1 mr-2 shrink-0 disabled:opacity-40"
              >
                {m.copied === log.rowKey ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ol>
        {!m.filteredLogs.length && (
          <EmptyState
            icon={ScrollText}
            iconSize={32}
            message={
              m.logs.length
                ? "No matching log entries"
                : "No activity recorded yet"
            }
            hint={
              m.logs.length
                ? "Adjust your search or filters to see more activity."
                : "Application and session actions will appear here when logging is enabled."
            }
          />
        )}
      </div>
    </>
  );
}

function LogPagination({ manager: m }: { manager: Manager }) {
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-textSecondary)]">
      <span aria-live="polite">
        {m.filteredLogs.length ? (m.currentPage - 1) * m.pageSize + 1 : 0}–
        {Math.min(m.currentPage * m.pageSize, m.filteredLogs.length)} of{" "}
        {m.filteredLogs.length} matching · {m.logs.length} retained
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          Rows
          <select
            aria-label="Log rows per page"
            className="sor-form-select-sm"
            value={m.pageSize}
            onChange={(event) => m.setPageSize(Number(event.target.value))}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          Page {m.currentPage} of {m.pageCount}
        </span>
        <button
          type="button"
          aria-label="Previous log page"
          className="sor-icon-btn-sm disabled:opacity-40"
          disabled={m.currentPage <= 1}
          onClick={() => m.setPage(m.currentPage - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next log page"
          className="sor-icon-btn-sm disabled:opacity-40"
          disabled={m.currentPage >= m.pageCount}
          onClick={() => m.setPage(m.currentPage + 1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export const ActionLogViewer: React.FC<ActionLogViewerProps> = ({
  isOpen,
  isActive = isOpen,
}) => {
  const manager = useActionLogViewer(isOpen && isActive);
  if (!isOpen) return null;
  return (
    <>
      <section
        aria-label="Action Log"
        className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-[var(--color-surface)]"
      >
        <LogToolbar manager={manager} />
        <LogList manager={manager} />
        <LogPagination manager={manager} />
      </section>
      <ConfirmDialog
        isOpen={manager.showClearConfirm}
        title="Clear Action Log"
        message="Clear retained application log entries and current in-memory session activity? This cannot be undone. Active sessions and saved scripts or macros are not affected."
        confirmText={manager.t("logs.clear", "Clear")}
        cancelText={manager.t("common.cancel", "Cancel")}
        onConfirm={manager.confirmClearLogs}
        onCancel={() => manager.setShowClearConfirm(false)}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={manager.showLegacyExportConfirm}
        title="Export application log?"
        message="This exports the original application log, including names and free-text details that may contain sensitive information. Review the file before sharing it. New session activity is not included. For sharing, use Export diagnostics CSV instead."
        confirmText="Export application log"
        cancelText="Cancel"
        onConfirm={manager.confirmLegacyExport}
        onCancel={() => manager.setShowLegacyExportConfirm(false)}
        variant="warning"
      />
    </>
  );
};
