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
    <th
      scope="col"
      aria-sort={
        m.sortKey !== field
          ? "none"
          : m.sortDirection === "asc"
            ? "ascending"
            : "descending"
      }
      className="sor-th whitespace-nowrap"
    >
      <button
        type="button"
        onClick={() => m.sortBy(field)}
        aria-label={`Sort logs by ${field}`}
        className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
      >
        {children}
        <ArrowUpDown
          size={12}
          aria-hidden="true"
          className={m.sortKey === field ? "text-primary" : "opacity-50"}
        />
      </button>
    </th>
  );
}

function LogTable({ manager: m }: { manager: Manager }) {
  const { formatDate, formatTime } = useLocaleFormat();
  return (
    <div
      className="min-h-0 flex-1 overflow-auto"
      data-testid="action-log-scroll-region"
    >
      <table
        className="sor-data-table w-full text-xs"
        aria-label="Action log entries"
      >
        <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
          <tr>
            <SortHeading manager={m} field="timestamp">
              Time
            </SortHeading>
            <SortHeading manager={m} field="source">
              Source
            </SortHeading>
            <SortHeading manager={m} field="level">
              Level
            </SortHeading>
            <SortHeading manager={m} field="action">
              Action
            </SortHeading>
            <SortHeading manager={m} field="connection">
              Connection
            </SortHeading>
            <th scope="col" className="sor-th">
              Details
            </th>
            <SortHeading manager={m} field="duration">
              Duration
            </SortHeading>
            <th scope="col" className="sor-th">
              <span className="sr-only">Copy diagnostics</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {m.pageLogs.map((log) => (
            <tr
              key={log.rowKey}
              className="hover:bg-[var(--color-surfaceHover)]"
              data-testid="action-log-row"
            >
              <td className="px-3 py-2 whitespace-nowrap text-[var(--color-textSecondary)]">
                <time dateTime={String(log.timestamp)}>
                  <span className="block">{formatDate(log.timestamp)}</span>
                  <span className="text-[var(--color-textMuted)]">
                    {formatTime(log.timestamp)}
                  </span>
                </time>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-[var(--color-textSecondary)]">
                {log.sourceLabel}
              </td>
              <td className="px-3 py-2">
                <span className={`capitalize ${LEVEL_COLORS[log.level]}`}>
                  {log.level === "warn" ? "Warning" : log.level}
                </span>
              </td>
              <td className="px-3 py-2 font-medium text-[var(--color-text)]">
                {log.action}
              </td>
              <td className="max-w-48 px-3 py-2 break-words text-[var(--color-textSecondary)]">
                {log.connectionName || "—"}
              </td>
              <td className="min-w-48 max-w-xl px-3 py-2 text-[var(--color-textSecondary)]">
                <p className="break-words">{log.details}</p>
              </td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums text-[var(--color-textSecondary)]">
                {log.duration == null ? "—" : `${log.duration} ms`}
              </td>
              <td className="px-2 py-2">
                <button
                  type="button"
                  aria-label={`Copy diagnostics for ${log.localAlias}`}
                  title="Copy diagnostics; legacy names and free text are omitted"
                  disabled={m.copying !== null}
                  onClick={() => void m.copyLog(log)}
                  className="sor-icon-btn-sm disabled:opacity-40"
                >
                  {m.copied === log.rowKey ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <LogTable manager={manager} />
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
