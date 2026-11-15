import React, { useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  Download,
  Filter,
  ScrollText,
  Search,
} from "lucide-react";
import {
  type RDPLogEntry,
  useRDPLogViewer,
} from "../../hooks/rdp/useRdpLogViewer";
import { useLocaleFormat } from "../../hooks/settings/useLocaleFormat";
import { EmptyState } from "../ui/display";

interface RDPLogViewerProps {
  isVisible: boolean;
  /** When set, pre-filters logs to this session ID */
  sessionFilter?: string | null;
}

// Same level colours as the Action Log rows.
const LEVEL_COLORS: Record<string, string> = {
  debug: "text-[var(--color-textMuted)]",
  info: "text-primary",
  warn: "text-warning",
  error: "text-error",
};

function entryText(entry: RDPLogEntry, when: string): string {
  const extra = [
    entry.session_id && `session=${entry.session_id}`,
    entry.channel && `channel=${entry.channel}`,
    entry.code != null && `code=${entry.code}`,
  ].filter(Boolean);
  return `${when} ${entry.level.toUpperCase()} ${entry.message}${
    extra.length ? ` (${extra.join(", ")})` : ""
  }`;
}

export const RDPLogViewer: React.FC<RDPLogViewerProps> = ({
  isVisible,
  sessionFilter,
}) => {
  const mgr = useRDPLogViewer(isVisible, sessionFilter);
  const { formatDate, formatTime } = useLocaleFormat();
  const [copied, setCopied] = useState(false);
  const stamp = (ms: number) => `${formatDate(ms)} ${formatTime(ms)}`;
  const hasFilters =
    mgr.filter !== "" ||
    mgr.levelFilter !== "all" ||
    mgr.sessionIdFilter !== "all";

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        mgr.filteredLogs
          .map((e) => entryText(e, stamp(e.timestamp)))
          .join("\n"),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied
    }
  };

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      ["timestamp", "level", "session", "channel", "code", "message"],
      ...mgr.filteredLogs.map((e) => [
        new Date(e.timestamp).toISOString(),
        e.level,
        e.session_id,
        e.channel,
        e.code,
        e.message,
      ]),
    ]
      .map((row) => row.map(q).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `rdp-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="RDP Logs"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-surface)]"
    >
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
            <ScrollText size={16} aria-hidden="true" /> RDP Logs
          </h2>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={!mgr.filteredLogs.length}
              className="sor-option-chip text-xs disabled:opacity-40"
            >
              {copied ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}{" "}
              Copy filtered logs
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!mgr.filteredLogs.length}
              className="sor-option-chip text-xs disabled:opacity-40"
            >
              <Download size={14} aria-hidden="true" /> Export CSV
            </button>
            <button
              type="button"
              aria-pressed={mgr.autoScroll}
              onClick={() => mgr.setAutoScroll(!mgr.autoScroll)}
              className="sor-option-chip text-xs"
              title={mgr.autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
            >
              <ArrowDown
                size={14}
                aria-hidden="true"
                className={mgr.autoScroll ? "text-primary" : "opacity-50"}
              />{" "}
              Auto-scroll
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
              value={mgr.filter}
              onChange={(e) => mgr.setFilter(e.target.value)}
              autoComplete="off"
              className="sor-form-input sor-form-input-icon-left w-full text-xs"
            />
          </div>
          <Filter
            size={14}
            aria-hidden="true"
            className="text-[var(--color-textMuted)]"
          />
          <select
            aria-label="Filter by level"
            value={mgr.levelFilter}
            onChange={(e) => mgr.setLevelFilter(e.target.value)}
            className="sor-form-select-sm max-w-52"
          >
            <option value="all">All levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
          {mgr.sessionIds.length > 0 && (
            <select
              aria-label="Filter by session"
              value={mgr.sessionIdFilter}
              onChange={(e) => mgr.setSessionIdFilter(e.target.value)}
              className="sor-form-select-sm max-w-52"
            >
              <option value="all">All sessions</option>
              {mgr.sessionIds.map((sid) => (
                <option key={sid} value={sid}>
                  {sid.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                mgr.setFilter("");
                mgr.setLevelFilter("all");
                mgr.setSessionIdFilter("all");
              }}
              className="sor-option-chip text-xs text-warning"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div
        ref={mgr.scrollRef}
        role="region"
        aria-label="RDP log entries"
        tabIndex={0}
        className="@container min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--color-background)] text-[var(--color-text)]"
        data-testid="rdp-log-scroll-region"
      >
        <ol className="divide-y divide-[var(--color-border)]">
          {mgr.filteredLogs.map((entry, i) => (
            <li
              key={`${entry.timestamp}-${i}`}
              data-testid="rdp-log-row"
              className="flex min-w-0 items-start"
            >
              <details className="group min-w-0 flex-1">
                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={12}
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open:rotate-90"
                  />
                  <time
                    dateTime={String(entry.timestamp)}
                    title={stamp(entry.timestamp)}
                    className="w-24 min-w-0 shrink truncate tabular-nums text-[var(--color-textMuted)] @2xl:w-40"
                  >
                    {stamp(entry.timestamp)}
                  </time>
                  <span
                    className="hidden w-36 shrink-0 truncate text-[var(--color-textMuted)] @2xl:block"
                    title={entry.session_id}
                  >
                    {entry.session_id ? entry.session_id.slice(0, 8) : "RDP"}
                  </span>
                  <span
                    className={`w-12 shrink-0 rounded px-1.5 text-center uppercase ${LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.info}`}
                  >
                    {entry.level}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={entry.message}
                  >
                    {entry.message.replace(/\s+/g, " ")}
                  </span>
                </summary>
                <div className="space-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
                  <p className="select-text whitespace-pre-wrap break-words text-sm">
                    {entry.message}
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-textSecondary)]">
                    <dt>Session</dt>
                    <dd className="break-all">{entry.session_id || "—"}</dd>
                    <dt>Channel</dt>
                    <dd className="break-words">{entry.channel || "—"}</dd>
                    <dt>Code</dt>
                    <dd className="break-words">{entry.code ?? "—"}</dd>
                  </dl>
                </div>
              </details>
            </li>
          ))}
        </ol>
        {!mgr.filteredLogs.length && (
          <EmptyState
            icon={ScrollText}
            iconSize={32}
            message={
              mgr.logs.length
                ? "No matching log entries"
                : "No activity recorded yet"
            }
            hint={
              mgr.logs.length
                ? "Adjust your search or filters to see more activity."
                : "RDP session events will appear here as connections run."
            }
          />
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-textSecondary)]">
        <span aria-live="polite">
          {mgr.filteredLogs.length} of {mgr.logs.length} entries
        </span>
      </div>
    </section>
  );
};

export default RDPLogViewer;
