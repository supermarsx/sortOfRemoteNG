import React, { useState, useEffect, useCallback } from "react";
import {
  Search, RefreshCw, Loader2, AlertCircle, AlertTriangle,
  Info, Shield, ShieldAlert, Filter, Download,
} from "lucide-react";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type {
  EventLogEntry,
  EventLogInfo,
  EventLogFilter,
  EventLogLevel,
} from "../../../types/windows/winmgmt";

const LEVEL_ICONS: Record<EventLogLevel, React.ReactNode> = {
  error: <AlertCircle size={12} className="text-red-400" />,
  warning: <AlertTriangle size={12} className="text-yellow-400" />,
  information: <Info size={12} className="text-blue-400" />,
  auditSuccess: <Shield size={12} className="text-green-400" />,
  auditFailure: <ShieldAlert size={12} className="text-orange-400" />,
  unknown: <Info size={12} className="text-[var(--color-textMuted)]" />,
};

const LEVEL_LABELS: Record<EventLogLevel, string> = {
  error: "Error",
  warning: "Warning",
  information: "Information",
  auditSuccess: "Audit Success",
  auditFailure: "Audit Failure",
  unknown: "Unknown",
};

interface EventLogPanelProps {
  ctx: WinmgmtContext;
}

const EventLogPanel: React.FC<EventLogPanelProps> = ({ ctx }) => {
  const [logs, setLogs] = useState<EventLogInfo[]>([]);
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState("Application");
  const [levelFilter, setLevelFilter] = useState<EventLogLevel | "all">("all");
  const [search, setSearch] = useState("");
  const [maxResults, setMaxResults] = useState(200);
  const [selectedEntry, setSelectedEntry] = useState<number | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const l = await ctx.cmd<EventLogInfo[]>("winmgmt_list_event_logs");
      setLogs(l);
    } catch (err) {
      setError(String(err));
    }
  }, [ctx]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter: EventLogFilter = {
        logNames: [selectedLog],
        levels:
          levelFilter === "all"
            ? []
            : [levelFilter],
        sources: [],
        eventIds: [],
        startTime: null,
        endTime: null,
        messageContains: search || null,
        computerName: null,
        maxResults,
        newestFirst: true,
      };
      const e = await ctx.cmd<EventLogEntry[]>("winmgmt_query_events", {
        filter,
      });
      setEntries(e);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [ctx, selectedLog, levelFilter, search, maxResults]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const exportCsv = useCallback(async () => {
    try {
      const filter: EventLogFilter = {
        logNames: [selectedLog],
        levels: levelFilter === "all" ? [] : [levelFilter],
        sources: [],
        eventIds: [],
        startTime: null,
        endTime: null,
        messageContains: search || null,
        computerName: null,
        maxResults,
        newestFirst: true,
      };
      const csv = await ctx.cmd<string>("winmgmt_export_events_csv", {
        filter,
      });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedLog}-events.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    }
  }, [ctx, selectedLog, levelFilter, search, maxResults]);

  const selectedEntryData = selectedEntry != null
    ? entries.find((e) => e.recordNumber === selectedEntry)
    : null;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-wrap">
        <select
          value={selectedLog}
          onChange={(e) => setSelectedLog(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          {(logs.length > 0
            ? logs.map((l) => l.name)
            : ["Application", "System", "Security"]
          ).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <select
          value={levelFilter}
          onChange={(e) =>
            setLevelFilter(e.target.value as EventLogLevel | "all")
          }
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          <option value="all">All Levels</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="information">Information</option>
          <option value="auditSuccess">Audit Success</option>
          <option value="auditFailure">Audit Failure</option>
        </select>

        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter messages…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <button
          onClick={fetchEntries}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>

        <button
          onClick={exportCsv}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title="Export CSV"
        >
          <Download size={14} />
        </button>

        <span className="text-xs text-[var(--color-textMuted)] ml-auto">
          {entries.length} events
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Event List */}
        <div className="flex-1 overflow-auto">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2
                size={24}
                className="animate-spin text-[var(--color-textMuted)]"
              />
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
                <tr className="text-left text-[var(--color-textSecondary)]">
                  <th className="px-3 py-2 font-medium w-6"></th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium w-16">Event ID</th>
                  <th className="px-3 py-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.recordNumber}
                    onClick={() => setSelectedEntry(entry.recordNumber)}
                    className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                      selectedEntry === entry.recordNumber
                        ? "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                        : "hover:bg-[var(--color-surfaceHover)]"
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      {LEVEL_ICONS[entry.eventType] || LEVEL_ICONS.unknown}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono whitespace-nowrap">
                      {new Date(entry.timeGenerated).toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-text)]">
                      {entry.sourceName}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono">
                      {entry.eventCode}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] truncate max-w-[300px]">
                      {entry.message || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Pane */}
        {selectedEntryData && (
          <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-auto p-3 space-y-3">
            <div className="flex items-center gap-2">
              {LEVEL_ICONS[selectedEntryData.eventType]}
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {LEVEL_LABELS[selectedEntryData.eventType]} —{" "}
                {selectedEntryData.sourceName}
              </h3>
            </div>
            <dl className="text-xs space-y-2">
              <DetailRow label="Log" value={selectedEntryData.logFile} />
              <DetailRow
                label="Event ID"
                value={String(selectedEntryData.eventCode)}
              />
              <DetailRow
                label="Time"
                value={new Date(
                  selectedEntryData.timeGenerated,
                ).toLocaleString()}
              />
              <DetailRow
                label="Computer"
                value={selectedEntryData.computerName}
              />
              {selectedEntryData.user && (
                <DetailRow label="User" value={selectedEntryData.user} />
              )}
              {selectedEntryData.categoryString && (
                <DetailRow
                  label="Category"
                  value={selectedEntryData.categoryString}
                />
              )}
            </dl>
            {selectedEntryData.message && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-textMuted)] mb-1">
                  Message
                </h4>
                <pre className="text-xs text-[var(--color-text)] whitespace-pre-wrap font-mono bg-[var(--color-background)] rounded-md p-2 max-h-60 overflow-auto">
                  {selectedEntryData.message}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div>
    <dt className="text-[var(--color-textMuted)]">{label}</dt>
    <dd className="text-[var(--color-text)] mt-0.5">{value}</dd>
  </div>
);

export default EventLogPanel;
