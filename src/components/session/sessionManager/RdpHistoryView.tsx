import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  History,
  Monitor,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import type { RDPSessionHistoryEntry } from "../../../utils/rdp/rdpSessionHistory";
import { formatUptime } from "../../../hooks/rdp/useRdpSessionPanel";
import { EmptyState } from "../../ui/display";

type HistorySortKey =
  | "connection"
  | "target"
  | "username"
  | "lastConnected"
  | "disconnectedAt"
  | "duration"
  | "resolution";

type SortDirection = "asc" | "desc";
type AvailabilityFilter = "all" | "reconnectable" | "unavailable";

interface HistoryRow {
  entry: RDPSessionHistoryEntry;
  connection: Connection | null;
  canReconnect: boolean;
  originalIndex: number;
  rowId: string;
}

export interface RdpHistoryViewProps {
  history: RDPSessionHistoryEntry[];
  resolveConnection: (entry: RDPSessionHistoryEntry) => Connection | null;
  onClear: () => void;
  onReconnect?: (connection: Connection) => void;
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function historyDateValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatHistoryDate(value: string): string {
  const timestamp = historyDateValue(value);
  return timestamp === 0 ? "Unknown" : DATE_FORMATTER.format(timestamp);
}

function resolutionLabel(entry: RDPSessionHistoryEntry): string {
  if (entry.desktopWidth <= 0 || entry.desktopHeight <= 0) return "Unknown";
  return `${entry.desktopWidth} × ${entry.desktopHeight}`;
}

function rowTarget(entry: RDPSessionHistoryEntry): string {
  return `${entry.hostname}:${entry.port}`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareRows(
  left: HistoryRow,
  right: HistoryRow,
  sortKey: HistorySortKey,
): number {
  switch (sortKey) {
    case "connection":
      return compareText(left.entry.connectionName, right.entry.connectionName);
    case "target":
      return compareText(rowTarget(left.entry), rowTarget(right.entry));
    case "username":
      return compareText(left.entry.username || "", right.entry.username || "");
    case "lastConnected":
      return (
        historyDateValue(left.entry.lastConnected) -
        historyDateValue(right.entry.lastConnected)
      );
    case "duration":
      return left.entry.duration - right.entry.duration;
    case "resolution":
      return (
        left.entry.desktopWidth * left.entry.desktopHeight -
        right.entry.desktopWidth * right.entry.desktopHeight
      );
    case "disconnectedAt":
    default:
      return (
        historyDateValue(left.entry.disconnectedAt) -
        historyDateValue(right.entry.disconnectedAt)
      );
  }
}

const SortHeader: React.FC<{
  sortKey: HistorySortKey;
  label: string;
  activeSort: HistorySortKey;
  direction: SortDirection;
  onSort: (sortKey: HistorySortKey) => void;
}> = ({ sortKey, label, activeSort, direction, onSort }) => {
  const active = activeSort === sortKey;
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : undefined
      }
      className="whitespace-nowrap px-3 py-2 font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Sort by ${label}${active ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
      >
        <span>{label}</span>
        <Icon size={12} aria-hidden="true" />
      </button>
    </th>
  );
};

export const RdpHistoryView: React.FC<RdpHistoryViewProps> = ({
  history,
  resolveConnection,
  onClear,
  onReconnect,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [sortKey, setSortKey] = useState<HistorySortKey>("disconnectedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const rows = useMemo<HistoryRow[]>(
    () =>
      history.map((entry, originalIndex) => {
        const connection = resolveConnection(entry);
        return {
          entry,
          connection,
          canReconnect: Boolean(connection && onReconnect),
          originalIndex,
          rowId: `${entry.connectionId || rowTarget(entry)}-${entry.disconnectedAt}-${originalIndex}`,
        };
      }),
    [history, onReconnect, resolveConnection],
  );

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    return rows
      .filter((row) => {
        if (availability === "reconnectable" && !row.canReconnect) return false;
        if (availability === "unavailable" && row.canReconnect) return false;
        if (!normalizedSearch) return true;

        const searchable = [
          row.entry.connectionName,
          row.entry.hostname,
          String(row.entry.port),
          row.entry.username,
          row.entry.lastConnected,
          row.entry.disconnectedAt,
          row.connection?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return searchable.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const compared = compareRows(left, right, sortKey);
        if (compared !== 0) {
          return sortDirection === "asc" ? compared : -compared;
        }
        return left.originalIndex - right.originalIndex;
      });
  }, [availability, rows, searchTerm, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visibleRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const changeSort = (nextSort: HistorySortKey) => {
    if (sortKey === nextSort) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextSort);
      setSortDirection(
        nextSort === "connection" ||
          nextSort === "target" ||
          nextSort === "username"
          ? "asc"
          : "desc",
      );
    }
    setPage(1);
  };

  if (history.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center p-6"
        data-testid="rdp-history-empty"
      >
        <EmptyState
          icon={History}
          message="No session history yet"
          hint="Past RDP sessions appear here after disconnecting"
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="rdp-history-view"
    >
      <div className="flex-shrink-0 space-y-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <label className="relative min-w-56 flex-1">
              <span className="sr-only">Search RDP history</span>
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setPage(1);
                }}
                placeholder="Search connection, host, port, or user…"
                className="sor-form-input w-full pl-8"
                data-testid="rdp-history-search"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]">
              <span>Availability</span>
              <select
                value={availability}
                onChange={(event) => {
                  setAvailability(event.target.value as AvailabilityFilter);
                  setPage(1);
                }}
                className="sor-form-input py-1"
                aria-label="Filter RDP history by reconnect availability"
                data-testid="rdp-history-availability-filter"
              >
                <option value="all">All entries</option>
                <option value="reconnectable">Reconnectable</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="sor-option-chip flex-shrink-0 bg-error/10 text-xs text-error border-error/30 hover:bg-error/20"
            aria-label="Clear RDP history"
          >
            <Trash2 size={12} aria-hidden="true" />
            Clear history
          </button>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto overscroll-contain p-3"
        data-testid="rdp-history-scroll-region"
      >
        <div
          className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]"
          data-testid="rdp-history-table-frame"
        >
          <table
            className="w-full min-w-[1120px] border-collapse text-left text-xs"
            data-testid="rdp-history-table"
          >
            <caption className="sr-only">
              Past RDP sessions and reconnect availability
            </caption>
            <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)] shadow-sm">
              <tr>
                <SortHeader
                  sortKey="connection"
                  label="Connection"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="target"
                  label="Host / port"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="username"
                  label="User"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="lastConnected"
                  label="Connected"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="disconnectedAt"
                  label="Disconnected"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="duration"
                  label="Duration"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="resolution"
                  label="Resolution"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <th scope="col" className="px-3 py-2 font-medium">
                  Availability
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {pageRows.map(({ entry, connection, canReconnect, rowId }) => {
                return (
                  <tr
                    key={rowId}
                    className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                    data-testid={`rdp-history-row-${rowId}`}
                  >
                    <th
                      scope="row"
                      className="max-w-64 px-3 py-2.5 font-normal"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Monitor
                          size={14}
                          className="flex-shrink-0 text-info"
                          aria-hidden="true"
                        />
                        <span
                          className="truncate font-medium text-[var(--color-text)]"
                          title={entry.connectionName}
                        >
                          {entry.connectionName}
                        </span>
                      </div>
                    </th>
                    <td
                      className="max-w-64 truncate px-3 py-2.5 font-mono text-[var(--color-textSecondary)]"
                      title={rowTarget(entry)}
                    >
                      {rowTarget(entry)}
                    </td>
                    <td
                      className="max-w-48 truncate px-3 py-2.5 text-[var(--color-textSecondary)]"
                      title={entry.username || undefined}
                    >
                      {entry.username || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                      <time
                        dateTime={entry.lastConnected}
                        title={entry.lastConnected}
                      >
                        {formatHistoryDate(entry.lastConnected)}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                      <time
                        dateTime={entry.disconnectedAt}
                        title={entry.disconnectedAt}
                      >
                        {formatHistoryDate(entry.disconnectedAt)}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[var(--color-textSecondary)]">
                      {formatUptime(entry.duration)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[var(--color-textSecondary)]">
                      {resolutionLabel(entry)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${canReconnect ? "border-success/30 bg-success/15 text-success" : "border-[var(--color-border)] bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]"}`}
                      >
                        {canReconnect ? "Ready" : "Unavailable"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canReconnect && connection ? (
                        <button
                          type="button"
                          onClick={() => onReconnect?.(connection)}
                          className="sor-option-chip text-xs"
                          aria-label={`Reconnect to ${entry.connectionName}`}
                          title={`Reconnect to ${entry.connectionName}`}
                        >
                          <RefreshCw size={12} aria-hidden="true" />
                          Reconnect
                        </button>
                      ) : (
                        <span className="text-[11px] italic text-[var(--color-textMuted)]">
                          Saved connection unavailable
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pageRows.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={Search}
                message="No matching RDP history"
                hint="Adjust the search or availability filter."
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)]">
        <span aria-live="polite" data-testid="rdp-history-range">
          {visibleRows.length === 0
            ? "0 entries"
            : `${((currentPage - 1) * pageSize + 1).toLocaleString()}–${Math.min(currentPage * pageSize, visibleRows.length).toLocaleString()} of ${visibleRows.length.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="sor-form-input py-1"
              aria-label="RDP history rows per page"
              data-testid="rdp-history-page-size"
            >
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span>
            Page {currentPage.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous RDP history page"
            aria-label="Previous RDP history page"
            data-testid="rdp-history-previous-page"
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(pageCount, current + 1))
            }
            disabled={currentPage >= pageCount}
            className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
            title="Next RDP history page"
            aria-label="Next RDP history page"
            data-testid="rdp-history-next-page"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
