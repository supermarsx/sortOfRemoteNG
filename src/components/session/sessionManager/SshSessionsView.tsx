import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  History,
  ScrollText,
  Search,
  Terminal,
} from "lucide-react";
import { EmptyState } from "../../ui/display";
import {
  type CommandExecution,
  type SSHCommandHistoryEntry,
} from "../../../types/ssh/sshCommandHistory";
import {
  SSH_SESSION_ACTIVITY_STORAGE_KEY,
  SSH_SESSION_ACTIVITY_SYNC_EVENT,
  type SSHSessionActivityKind,
  type SSHSessionActivityRecord,
} from "../../../utils/ssh/sshSessionActivity";
import { commandExecutionDisplayStatus } from "../../../utils/ssh/sshCommandEvidence";
import {
  SSH_COMMAND_HISTORY_SYNC_EVENT,
  sanitizeSSHCommandHistory,
  sanitizeSSHHistoryString as displayString,
} from "../../../utils/ssh/sshCommandHistorySanitizer";

export const SSH_COMMAND_HISTORY_STORAGE_KEY = "sshCommandHistory";

type SshSessionsTab = "logs" | "history";
type SortDirection = "asc" | "desc";
type LogSortKey = "recorded" | "session" | "activity" | "status";
type HistorySortKey = "recorded" | "command" | "category" | "executions";

type SshActivityStatus =
  | "connected"
  | "disconnected"
  | "dispatched"
  | "dispatch-failed"
  | "completed"
  | "failed"
  | "legacy-unverified";

interface SshActivityRow {
  id: string;
  sessionId: string;
  sessionName: string;
  hostname: string;
  activity: string;
  details: string;
  status: SshActivityStatus;
  recordedAt: string;
  timestampLabel: string;
}

const SSH_SESSION_TABS = [
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "history", label: "History", icon: History },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeLifecycleActivity(
  value: unknown,
): SSHSessionActivityRecord | null {
  if (!isRecord(value)) return null;
  const id = displayString(value.id, 512, { required: true });
  const sessionId = displayString(value.sessionId, 512, { required: true });
  const sessionName = displayString(value.sessionName, 512);
  const hostname = displayString(value.hostname, 512);
  const recordedAt = displayString(value.recordedAt, 128);
  const kind = displayString(value.kind, 32);
  if (
    id === undefined ||
    sessionId === undefined ||
    sessionName === undefined ||
    hostname === undefined ||
    recordedAt === undefined ||
    !Number.isFinite(Date.parse(recordedAt)) ||
    (kind !== "connected" && kind !== "disconnected") ||
    value.source !== "web-terminal-lifecycle"
  ) {
    return null;
  }
  return {
    id,
    sessionId,
    sessionName,
    hostname,
    recordedAt,
    kind,
    source: "web-terminal-lifecycle",
  };
}

function readPersistedHistory(): {
  raw: string | null;
  entries: SSHCommandHistoryEntry[];
} {
  if (typeof window === "undefined") return { raw: null, entries: [] };
  try {
    const raw = window.localStorage.getItem(SSH_COMMAND_HISTORY_STORAGE_KEY);
    if (!raw) return { raw, entries: [] };
    const parsed: unknown = JSON.parse(raw);
    return {
      raw,
      entries: sanitizeSSHCommandHistory(parsed, { mode: "storage" }),
    };
  } catch {
    return { raw: null, entries: [] };
  }
}

function readPersistedLifecycleActivity(): {
  raw: string | null;
  records: SSHSessionActivityRecord[];
} {
  if (typeof window === "undefined") return { raw: null, records: [] };
  try {
    const raw = window.localStorage.getItem(SSH_SESSION_ACTIVITY_STORAGE_KEY);
    if (!raw) return { raw, records: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { raw, records: [] };
    return {
      raw,
      records: parsed
        .map(sanitizeLifecycleActivity)
        .filter(
          (record): record is SSHSessionActivityRecord => record !== null,
        ),
    };
  } catch {
    return { raw: null, records: [] };
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: SshActivityStatus): string {
  switch (status) {
    case "connected":
    case "completed":
      return "border-success/30 bg-success/15 text-success";
    case "failed":
    case "dispatch-failed":
      return "border-error/30 bg-error/15 text-error";
    case "dispatched":
      return "border-warning/30 bg-warning/15 text-warning";
    default:
      return "border-[var(--color-border)] bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)]";
  }
}

const StatusBadge: React.FC<{ status?: SshActivityStatus }> = ({ status }) =>
  status ? (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusTone(status)}`}
    >
      {
        {
          connected: "Connected",
          disconnected: "Disconnected",
          dispatched: "Dispatched",
          "dispatch-failed": "Dispatch failed",
          completed: "Completed",
          failed: "Failed",
          "legacy-unverified": "Legacy unverified",
        }[status]
      }
    </span>
  ) : (
    <span className="text-[var(--color-textMuted)]">—</span>
  );

const SortButton: React.FC<{
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}> = ({ label, active, direction, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1 hover:text-[var(--color-text)]"
    aria-label={`Sort SSH ${label.toLocaleLowerCase()}`}
    title={`Sort by ${label.toLocaleLowerCase()}`}
  >
    {label}
    <ArrowUpDown
      size={11}
      aria-hidden="true"
      className={active ? "text-[var(--color-primary)]" : "opacity-50"}
    />
    <span className="sr-only">
      {active ? `, ${direction === "asc" ? "ascending" : "descending"}` : ""}
    </span>
  </button>
);

const Pagination: React.FC<{
  count: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}> = ({ count, page, pageSize, onPage, onPageSize }) => {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pageCount);
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)]">
      <span aria-live="polite">
        {count === 0
          ? "0 records"
          : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, count)} of ${count}`}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="sor-form-input py-1"
            aria-label="SSH rows per page"
            data-testid="ssh-sessions-page-size"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span>
          Page {currentPage} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPage(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous SSH records page"
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onPage(Math.min(pageCount, currentPage + 1))}
          disabled={currentPage >= pageCount}
          className="sor-icon-btn-xs disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next SSH records page"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

function executionActivityStatus(
  displayStatus: ReturnType<typeof commandExecutionDisplayStatus>,
): SshActivityStatus {
  if (displayStatus === "success") return "completed";
  if (displayStatus === "error") return "failed";
  if (displayStatus === "dispatched") return "dispatched";
  if (displayStatus === "dispatch-failed") return "dispatch-failed";
  return "legacy-unverified";
}

function executionActivityDetails(
  execution: CommandExecution,
  displayStatus: ReturnType<typeof commandExecutionDisplayStatus>,
): string {
  if (displayStatus === "unverified") {
    return "Unverified record; stored status, evidence, output, and error details are not treated as trusted.";
  }
  if (displayStatus === "dispatched") {
    return "Transport accepted command input; remote completion was not observed.";
  }
  if (displayStatus === "dispatch-failed") {
    return execution.errorMessage
      ? `Dispatch error: ${execution.errorMessage}`
      : "Command input dispatch failed.";
  }
  const details = [
    execution.exitCode == null ? null : `exit ${execution.exitCode}`,
    execution.durationMs == null
      ? null
      : `${execution.durationMs.toLocaleString()} ms`,
    execution.stderr
      ? displayStatus === "success"
        ? `Diagnostics: ${execution.stderr}`
        : `Error: ${execution.stderr}`
      : execution.errorMessage
        ? `Error: ${execution.errorMessage}`
        : null,
    execution.output ? `Output: ${execution.output}` : null,
  ].filter(Boolean);
  return details.join(" · ") || "Remote completion recorded without output.";
}

function executionSearchTerms(execution: CommandExecution): string[] {
  const displayStatus = commandExecutionDisplayStatus(execution);
  const terms = [
    execution.sessionId,
    execution.sessionName,
    execution.hostname,
  ];
  if (displayStatus === "success" || displayStatus === "error") {
    return [
      ...terms,
      displayStatus === "success" ? "verified success" : "verified failure",
      execution.output,
      execution.stderr,
      execution.errorMessage,
      execution.exitCode?.toString(),
    ].filter((value): value is string => value !== undefined);
  }
  if (displayStatus === "dispatch-failed") {
    return [...terms, "dispatch failed", execution.errorMessage].filter(
      (value): value is string => value !== undefined,
    );
  }
  return [
    ...terms,
    displayStatus === "dispatched" ? "dispatched" : "unverified",
  ];
}

export const SshSessionsView: React.FC = () => {
  const initialHistory = useMemo(readPersistedHistory, []);
  const initialLifecycle = useMemo(readPersistedLifecycleActivity, []);
  const [entries, setEntries] = useState(initialHistory.entries);
  const [lifecycleActivity, setLifecycleActivity] = useState(
    initialLifecycle.records,
  );
  const rawHistoryRef = useRef(initialHistory.raw);
  const rawLifecycleRef = useRef(initialLifecycle.raw);
  const tabRefs = useRef<Record<SshSessionsTab, HTMLButtonElement | null>>({
    logs: null,
    history: null,
  });
  const [activeTab, setActiveTab] = useState<SshSessionsTab>("logs");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [logSort, setLogSort] = useState<LogSortKey>("recorded");
  const [historySort, setHistorySort] = useState<HistorySortKey>("recorded");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    const refresh = () => {
      const nextHistory = readPersistedHistory();
      if (nextHistory.raw !== rawHistoryRef.current) {
        rawHistoryRef.current = nextHistory.raw;
        setEntries(nextHistory.entries);
      }
      const nextLifecycle = readPersistedLifecycleActivity();
      if (nextLifecycle.raw !== rawLifecycleRef.current) {
        rawLifecycleRef.current = nextLifecycle.raw;
        setLifecycleActivity(nextLifecycle.records);
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(SSH_COMMAND_HISTORY_SYNC_EVENT, refresh);
    window.addEventListener(SSH_SESSION_ACTIVITY_SYNC_EVENT, refresh);
    const timer = window.setInterval(refresh, 3000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(SSH_COMMAND_HISTORY_SYNC_EVENT, refresh);
      window.removeEventListener(SSH_SESSION_ACTIVITY_SYNC_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, []);

  const activateTab = (tab: SshSessionsTab, moveFocus = false) => {
    setActiveTab(tab);
    if (moveFocus) tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % SSH_SESSION_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + SSH_SESSION_TABS.length) % SSH_SESSION_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SSH_SESSION_TABS.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    activateTab(SSH_SESSION_TABS[nextIndex].id, true);
  };

  const activityRows = useMemo<SshActivityRow[]>(() => {
    const dispatchRows = entries.flatMap((entry, entryIndex) =>
      entry.executions.map((execution, executionIndex) => {
        const displayStatus = commandExecutionDisplayStatus(execution);
        const isVerifiedCompletion =
          displayStatus === "success" || displayStatus === "error";
        const isDispatch =
          displayStatus === "dispatched" || displayStatus === "dispatch-failed";
        return {
          id: `dispatch:${entryIndex}:${executionIndex}`,
          sessionId: execution.sessionId,
          sessionName: execution.sessionName,
          hostname: execution.hostname,
          activity: isVerifiedCompletion
            ? `Script completion: ${entry.command}`
            : isDispatch
              ? `Command dispatch: ${entry.command}`
              : `Unverified SSH record: ${entry.command}`,
          details: executionActivityDetails(execution, displayStatus),
          status: executionActivityStatus(displayStatus),
          recordedAt: execution.executedAt ?? entry.lastExecutedAt,
          timestampLabel: isVerifiedCompletion
            ? "Completion recorded"
            : isDispatch
              ? "Dispatch recorded"
              : "Unverified activity",
        };
      }),
    );
    const lifecycleRows = lifecycleActivity.map((activity, index) => ({
      id: `lifecycle:${index}`,
      sessionId: activity.sessionId,
      sessionName: activity.sessionName,
      hostname: activity.hostname,
      activity:
        activity.kind === "connected"
          ? "SSH session connected"
          : "SSH session disconnected",
      details:
        "Verified WebTerminal lifecycle event; terminal input and command content were not persisted.",
      status: activity.kind as SshActivityStatus,
      recordedAt: activity.recordedAt,
      timestampLabel: "Lifecycle recorded",
    }));
    return [...dispatchRows, ...lifecycleRows];
  }, [entries, lifecycleActivity]);

  const query = searchTerm.trim().toLocaleLowerCase();
  const filteredLogs = useMemo(
    () =>
      activityRows
        .filter((row) =>
          [
            row.activity,
            row.details,
            row.sessionId,
            row.sessionName,
            row.hostname,
            row.status,
          ]
            .filter((value) => value != null)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
        )
        .sort((left, right) => {
          let result = 0;
          switch (logSort) {
            case "session":
              result = (left.sessionName || left.sessionId).localeCompare(
                right.sessionName || right.sessionId,
              );
              break;
            case "activity":
              result = left.activity.localeCompare(right.activity);
              break;
            case "status":
              result = left.status.localeCompare(right.status);
              break;
            default:
              result = left.recordedAt.localeCompare(right.recordedAt);
          }
          if (result === 0) result = left.id.localeCompare(right.id);
          return sortDirection === "asc" ? result : -result;
        }),
    [activityRows, logSort, query, sortDirection],
  );

  const filteredHistory = useMemo(
    () =>
      entries
        .filter((entry) =>
          [
            entry.command,
            entry.category,
            entry.note,
            ...entry.tags,
            ...entry.executions.flatMap(executionSearchTerms),
          ]
            .filter((value) => value != null)
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
        )
        .sort((left, right) => {
          let result = 0;
          switch (historySort) {
            case "command":
              result = left.command.localeCompare(right.command);
              break;
            case "category":
              result = left.category.localeCompare(right.category);
              break;
            case "executions":
              result = left.executionCount - right.executionCount;
              break;
            default:
              result = left.lastExecutedAt.localeCompare(right.lastExecutedAt);
          }
          if (result === 0) result = left.id.localeCompare(right.id);
          return sortDirection === "asc" ? result : -result;
        }),
    [entries, historySort, query, sortDirection],
  );

  useEffect(() => {
    setPage(1);
  }, [activeTab, pageSize, searchTerm]);

  const setSort = (key: LogSortKey | HistorySortKey) => {
    const current = activeTab === "logs" ? logSort : historySort;
    if (current === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      if (activeTab === "logs") setLogSort(key as LogSortKey);
      else setHistorySort(key as HistorySortKey);
      setSortDirection(
        key === "command" ||
          key === "activity" ||
          key === "session" ||
          key === "category"
          ? "asc"
          : "desc",
      );
    }
    setPage(1);
  };

  const rows = activeTab === "logs" ? filteredLogs : filteredHistory;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);

  return (
    <section
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
      aria-label="SSH Sessions"
      data-testid="ssh-sessions-view"
    >
      <div className="flex flex-shrink-0 flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-backgroundSecondary)]/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Terminal size={15} className="text-info" aria-hidden="true" />
              SSH Sessions
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-textMuted)]">
              Verified session lifecycle activity and explicit command dispatch
              records. Remote completion is shown only when evidence exists.
            </p>
          </div>
          <div
            className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
            role="tablist"
            aria-label="SSH session records"
            aria-orientation="horizontal"
          >
            {SSH_SESSION_TABS.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                ref={(element) => {
                  tabRefs.current[id] = element;
                }}
                type="button"
                role="tab"
                id={`ssh-sessions-tab-${id}`}
                aria-controls={`ssh-sessions-panel-${id}`}
                aria-selected={activeTab === id}
                tabIndex={activeTab === id ? 0 : -1}
                onClick={() => activateTab(id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${
                  activeTab === id
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                }`}
                data-testid={`ssh-sessions-tab-${id}`}
              >
                <Icon size={12} aria-hidden="true" />
                {label}
                <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[9px] leading-none">
                  {id === "logs" ? activityRows.length : entries.length}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="relative max-w-2xl">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder={
              activeTab === "logs"
                ? "Search SSH activity, dispatches, sessions, or hosts..."
                : "Search commands, sessions, hosts, tags, or notes..."
            }
            className="sor-form-input w-full pl-8 text-xs"
            aria-label={`Search SSH ${activeTab}`}
            data-testid="ssh-sessions-search"
          />
        </div>
      </div>

      <div
        id={`ssh-sessions-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`ssh-sessions-tab-${activeTab}`}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-auto p-3 overscroll-contain"
        data-testid="ssh-sessions-table-scroll-region"
      >
        <div className="min-h-full w-max min-w-full rounded-lg border border-[var(--color-border)]">
          {activeTab === "logs" ? (
            <table
              className="w-full min-w-[980px] border-collapse text-left text-xs"
              data-testid="ssh-logs-table"
            >
              <caption className="sr-only">
                Persisted SSH lifecycle activity and command dispatch logs
              </caption>
              <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
                <tr>
                  {(
                    [
                      ["recorded", "Executed"],
                      ["session", "Session / host"],
                      ["activity", "Activity"],
                      ["status", "Status"],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key} scope="col" className="px-3 py-2 font-medium">
                      <SortButton
                        label={label}
                        active={logSort === key}
                        direction={sortDirection}
                        onClick={() => setSort(key)}
                      />
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Evidence / details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {(pageRows as SshActivityRow[]).map((row) => {
                  return (
                    <tr
                      key={row.id}
                      className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                        <div>{formatDate(row.recordedAt)}</div>
                        <div className="text-[10px] text-[var(--color-textMuted)]">
                          {row.timestampLabel}
                        </div>
                      </td>
                      <td className="max-w-60 px-3 py-2.5">
                        <div
                          className="truncate font-medium"
                          title={row.sessionName || row.sessionId}
                        >
                          {row.sessionName || row.sessionId}
                        </div>
                        <div
                          className="truncate font-mono text-[10px] text-[var(--color-textMuted)]"
                          title={`${row.hostname} · ${row.sessionId}`}
                        >
                          {row.hostname || "Unknown host"} · {row.sessionId}
                        </div>
                      </td>
                      <td
                        className="max-w-80 px-3 py-2.5 font-mono"
                        title={row.activity}
                      >
                        <div className="truncate">{row.activity}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td
                        className="max-w-[32rem] px-3 py-2.5 text-[var(--color-textSecondary)]"
                        title={row.details}
                      >
                        <div className="line-clamp-2 whitespace-pre-wrap break-words">
                          {row.details}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table
              className="w-full min-w-[1040px] border-collapse text-left text-xs"
              data-testid="ssh-history-table"
            >
              <caption className="sr-only">
                Persistent grouped SSH command history
              </caption>
              <thead className="sticky top-0 z-10 bg-[var(--color-backgroundSecondary)] text-[var(--color-textSecondary)]">
                <tr>
                  {(
                    [
                      ["recorded", "Last run"],
                      ["command", "Command"],
                      ["category", "Category"],
                      ["executions", "Dispatch runs / retained targets"],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key} scope="col" className="px-3 py-2 font-medium">
                      <SortButton
                        label={label}
                        active={historySort === key}
                        direction={sortDirection}
                        onClick={() => setSort(key)}
                      />
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Sessions / hosts
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Last status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Tags / notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {(pageRows as SSHCommandHistoryEntry[]).map((entry) => {
                  const sessions = [
                    ...new Set(
                      entry.executions.map(
                        (execution) =>
                          execution.sessionName || execution.sessionId,
                      ),
                    ),
                  ];
                  const hosts = [
                    ...new Set(
                      entry.executions
                        .map((execution) => execution.hostname)
                        .filter(Boolean),
                    ),
                  ];
                  const lastExecution =
                    entry.executions[entry.executions.length - 1];
                  const annotations = [
                    entry.starred ? "Starred" : null,
                    entry.tags.length > 0
                      ? `Tags: ${entry.tags.join(", ")}`
                      : null,
                    entry.note ? `Note: ${entry.note}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr
                      key={entries.indexOf(entry)}
                      className="bg-[var(--color-background)]/40 hover:bg-[var(--color-surfaceHover)]/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-textSecondary)]">
                        {formatDate(entry.lastExecutedAt)}
                      </td>
                      <th
                        scope="row"
                        className="max-w-80 px-3 py-2.5 text-left font-mono font-normal"
                        title={entry.command}
                      >
                        <div className="truncate">{entry.command}</div>
                      </th>
                      <td className="px-3 py-2.5 capitalize text-[var(--color-textSecondary)]">
                        {entry.category}
                      </td>
                      <td className="px-3 py-2.5">
                        <div>
                          {entry.executionCount.toLocaleString()} recorded runs
                        </div>
                        <div className="text-[10px] text-[var(--color-textMuted)]">
                          {entry.executions.length.toLocaleString()} target
                          records retained
                        </div>
                      </td>
                      <td
                        className="max-w-72 px-3 py-2.5 text-[var(--color-textSecondary)]"
                        title={`${sessions.join(", ")} · ${hosts.join(", ")}`}
                      >
                        <div className="truncate">
                          {sessions.join(", ") || "Unknown session"}
                        </div>
                        <div className="truncate font-mono text-[10px] text-[var(--color-textMuted)]">
                          {hosts.join(", ") || "Unknown host"}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          status={
                            lastExecution
                              ? executionActivityStatus(
                                  commandExecutionDisplayStatus(lastExecution),
                                )
                              : undefined
                          }
                        />
                      </td>
                      <td
                        className="max-w-72 px-3 py-2.5 text-[var(--color-textSecondary)]"
                        title={annotations}
                      >
                        <div className="truncate">{annotations || "—"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {pageRows.length === 0 && (
            <div className="flex items-center justify-center py-14">
              <EmptyState
                icon={activeTab === "logs" ? ScrollText : History}
                message={
                  query
                    ? `No matching SSH ${activeTab}`
                    : activeTab === "logs"
                      ? "No SSH activity recorded"
                      : "No SSH dispatch history recorded"
                }
                hint={
                  query
                    ? "Adjust the search to include more persisted records."
                    : activeTab === "logs"
                      ? "Open an SSH terminal to record connection lifecycle activity, or explicitly dispatch a bulk SSH command. Interactive terminal keystrokes are not persisted because prompts may contain secrets."
                      : "Explicit bulk SSH command dispatches appear here. Interactive terminal keystrokes are not persisted because their shell context cannot be verified safely."
                }
              />
            </div>
          )}
        </div>
      </div>

      <Pagination
        count={rows.length}
        page={currentPage}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(size) => setPageSize(size)}
      />
    </section>
  );
};

export default SshSessionsView;
