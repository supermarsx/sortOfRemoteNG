import React, { useMemo, useState } from "react";
import {
  ArrowUpDown,
  BarChart3,
  Globe,
  List,
  RefreshCw,
  ScrollText,
  Search,
  StopCircle,
} from "lucide-react";
import { EmptyState } from "../../ui/display";
import { ApplicationLogsView } from "../../monitoring/ApplicationLogsView";
import type { Connection } from "../../../types/connection/connection";
import type { NativeBrowserDiagnostics } from "../../../types/network/nativeBrowserDiagnostics";
import type { UnifiedSessionRow } from "../../../hooks/session/useUnifiedSessionManager";
import {
  BROWSER_SESSION_STATUS_META,
  BROWSER_STATUS_ORDER,
  UNKNOWN_VALUE,
  buildBrowserSessionRows,
  formatAbsoluteTime,
  formatCount,
  formatRelativeTime,
  humanizeToken,
  type BrowserSessionListRow,
} from "./browserSessionList";
import { BrowserSessionStatusPill } from "./BrowserSessionStatusPill";
import { BrowserSessionStatistics } from "./BrowserSessionStatistics";

export type BrowserSessionsSubView = "sessions" | "statistics" | "journal";

export interface BrowserSessionsViewProps {
  view: BrowserSessionsSubView;
  onViewChange: (view: BrowserSessionsSubView) => void;
  /** Unified frontend rows; HTTP/HTTPS tabs are picked out here. */
  frontendRows: UnifiedSessionRow[];
  connections: Connection[];
  diagnostics?: NativeBrowserDiagnostics;
  diagnosticsError: string;
  diagnosticsLoading: boolean;
  isActive: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onCloseSession: (
    sessionId: string,
  ) => boolean | void | Promise<boolean | void>;
  /** Clock override for relative times (tests). */
  now?: number;
}

type SortKey = "name" | "status" | "relay" | "started" | "activity";
type SortDirection = "asc" | "desc";

const SUB_VIEWS: {
  id: BrowserSessionsSubView;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "sessions", label: "Live sessions", icon: List },
  { id: "statistics", label: "Statistics", icon: BarChart3 },
  { id: "journal", label: "Startup journal", icon: ScrollText },
];

function relayLabel(row: BrowserSessionListRow): string {
  if (!row.native) return UNKNOWN_VALUE;
  return row.native.proxy
    ? humanizeToken(row.native.proxy.state)
    : "Unavailable";
}

function dateValue(value?: Date): number {
  return value?.getTime() ?? 0;
}

const SortHeader: React.FC<{
  sortKey: SortKey;
  label: string;
  activeSort: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}> = ({ sortKey, label, activeSort, direction, onSort }) => {
  const active = activeSort === sortKey;
  return (
    <th
      scope="col"
      aria-sort={
        !active ? "none" : direction === "asc" ? "ascending" : "descending"
      }
      className="px-3 py-2 font-medium"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
        title={`Sort by ${label.toLowerCase()}`}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <ArrowUpDown
          size={11}
          aria-hidden="true"
          className={active ? "text-[var(--color-primary)]" : "opacity-50"}
        />
      </button>
    </th>
  );
};

const BrowserSessionList: React.FC<{
  rows: BrowserSessionListRow[];
  now: number;
  onShowStatistics: (sessionId: string) => void;
  onCloseSession: BrowserSessionsViewProps["onCloseSession"];
}> = ({ rows, now, onShowStatistics, onCloseSession }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const visibleRows = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return rows
      .filter(
        (row) =>
          !query ||
          [
            row.title,
            row.subtitle,
            BROWSER_SESSION_STATUS_META[row.status].label,
            row.failureReason,
            relayLabel(row),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort((left, right) => {
        let result = 0;
        switch (sortKey) {
          case "name":
            result = left.title.localeCompare(right.title, undefined, {
              numeric: true,
              sensitivity: "base",
            });
            break;
          case "status":
            result =
              BROWSER_STATUS_ORDER.indexOf(left.status) -
              BROWSER_STATUS_ORDER.indexOf(right.status);
            break;
          case "relay":
            result = relayLabel(left).localeCompare(relayLabel(right));
            break;
          case "activity":
            result =
              dateValue(left.lastActivity) - dateValue(right.lastActivity);
            break;
          case "started":
          default:
            result = dateValue(left.startedAt) - dateValue(right.startedAt);
        }
        if (result === 0) result = left.id.localeCompare(right.id);
        return sortDirection === "asc" ? result : -result;
      });
  }, [rows, searchTerm, sortDirection, sortKey]);

  const changeSort = (next: SortKey) => {
    if (next === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDirection(next === "name" || next === "relay" ? "asc" : "desc");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-[var(--color-border)] px-4 py-2.5">
        <label className="relative block">
          <span className="sr-only">Search browser sessions</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search name, target, status, or relay…"
            className="sor-form-input sor-form-input-icon-left w-full"
            data-testid="browser-session-search"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
        <div className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]">
          <table
            className="w-full min-w-[760px] border-collapse text-left text-xs"
            data-testid="browser-session-table"
          >
            <caption className="sr-only">Live browser sessions</caption>
            <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
              <tr>
                <SortHeader
                  sortKey="name"
                  label="Name / target"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="status"
                  label="Status"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="relay"
                  label="Relay"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="started"
                  label="Started"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <SortHeader
                  sortKey="activity"
                  label="Last activity"
                  activeSort={sortKey}
                  direction={sortDirection}
                  onSort={changeSort}
                />
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                  data-testid={`browser-session-row-${row.id}`}
                >
                  <th scope="row" className="max-w-80 px-3 py-2.5 font-normal">
                    <div className="flex min-w-0 items-center gap-2">
                      <Globe
                        size={14}
                        className="flex-shrink-0 text-info"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium text-[var(--color-text)]"
                          title={row.title}
                        >
                          {row.title}
                        </div>
                        <div
                          className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                          title={row.subtitle}
                        >
                          {row.subtitle}
                        </div>
                      </div>
                    </div>
                  </th>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-0.5">
                      <BrowserSessionStatusPill
                        status={row.status}
                        title={row.failureReason}
                      />
                      {row.failureReason && (
                        <span
                          className="max-w-48 truncate text-[10px] text-error"
                          title={row.failureReason}
                        >
                          {row.failureReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 ${row.native?.proxy ? "text-[var(--color-textSecondary)]" : "text-[var(--color-textMuted)]"}`}
                  >
                    {relayLabel(row)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]"
                    title={formatAbsoluteTime(row.startedAt)}
                  >
                    {formatRelativeTime(row.startedAt, now)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]"
                    title={formatAbsoluteTime(row.lastActivity)}
                  >
                    {formatRelativeTime(row.lastActivity, now)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => onShowStatistics(row.id)}
                        className="sor-icon-btn-xs"
                        title="View session statistics"
                        aria-label={`View statistics for ${row.title}`}
                      >
                        <BarChart3 size={14} aria-hidden="true" />
                      </button>
                      {row.frontendRow && (
                        <button
                          type="button"
                          onClick={() => void onCloseSession(row.id)}
                          className="sor-icon-btn-xs text-error hover:text-error"
                          title="Close browser tab"
                          aria-label={`Close browser session ${row.title}`}
                        >
                          <StopCircle size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={Globe}
                message={
                  rows.length === 0
                    ? "No browser sessions"
                    : "No matching browser sessions"
                }
                hint={
                  rows.length === 0
                    ? "Open an HTTP or HTTPS connection to see it here."
                    : "Adjust the search to see more sessions."
                }
              />
            </div>
          )}
        </div>
      </div>
      <div
        className="flex-shrink-0 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)]"
        aria-live="polite"
      >
        {visibleRows.length === rows.length
          ? `${formatCount(rows.length)} browser session${rows.length === 1 ? "" : "s"}`
          : `${formatCount(visibleRows.length)} of ${formatCount(rows.length)} browser sessions`}
      </div>
    </div>
  );
};

/** Browser sessions: a live list, a statistics page, and the startup journal. */
export const BrowserSessionsView: React.FC<BrowserSessionsViewProps> = ({
  view,
  onViewChange,
  frontendRows,
  connections,
  diagnostics,
  diagnosticsError,
  diagnosticsLoading,
  isActive,
  isRefreshing,
  onRefresh,
  onCloseSession,
  now: nowOverride,
}) => {
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const rows = useMemo(
    () => buildBrowserSessionRows(frontendRows, diagnostics, connections),
    [connections, diagnostics, frontendRows],
  );
  const now = nowOverride ?? Date.now();

  return (
    <section
      aria-label="Browser sessions"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <div
          role="group"
          aria-label="Browser log views"
          className="flex flex-wrap gap-2"
        >
          {SUB_VIEWS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (item.id !== "statistics") setFocusSessionId(null);
                  onViewChange(item.id);
                }}
                className={`sor-option-chip text-xs ${active ? "sor-option-chip-active" : ""}`}
                data-testid={`browser-sessions-view-${item.id}`}
              >
                <Icon size={12} aria-hidden="true" />
                {item.label}
                {item.id === "sessions" && rows.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="ml-0.5 rounded-full bg-[var(--color-border)] px-1.5 text-[9px] leading-4"
                  >
                    {rows.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {view !== "journal" && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={!isActive || isRefreshing}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh sessions
          </button>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view === "sessions" && diagnosticsError && (
          <p
            role="alert"
            className="mx-4 mt-2.5 rounded border border-error/40 bg-error/10 px-3 py-2 text-xs text-error"
          >
            {diagnosticsError}
          </p>
        )}
        {view === "sessions" && (
          <BrowserSessionList
            rows={rows}
            now={now}
            onCloseSession={onCloseSession}
            onShowStatistics={(sessionId) => {
              setFocusSessionId(sessionId);
              onViewChange("statistics");
            }}
          />
        )}
        {view === "statistics" && (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <BrowserSessionStatistics
              rows={rows}
              diagnostics={diagnostics}
              diagnosticsError={diagnosticsError}
              diagnosticsLoading={diagnosticsLoading}
              focusSessionId={focusSessionId}
              now={now}
            />
          </div>
        )}
        {view === "journal" && (
          <ApplicationLogsView source="browser" isActive={isActive} />
        )}
      </div>
    </section>
  );
};
