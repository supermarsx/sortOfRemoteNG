import React from "react";
import {
  AlertCircle,
  Info,
  AlertTriangle,
  XCircle,
  Search,
  ArrowDown,
} from "lucide-react";
import { useRdpLogViewer } from "../hooks/rdp/useRdpLogViewer";

type Mgr = ReturnType<typeof useRdpLogViewer>;

interface RdpLogEntry {
  timestamp: number;
  session_id?: string;
  level: string;
  message: string;
}

interface RdpLogViewerProps {
  isVisible: boolean;
  /** When set, pre-filters logs to this session ID */
  sessionFilter?: string | null;
}

const LEVEL_CONFIG: Record<string, { icon: React.ElementType; color: string }> =
  {
    info: { icon: Info, color: "text-blue-400" },
    warn: { icon: AlertTriangle, color: "text-yellow-400" },
    error: { icon: AlertCircle, color: "text-red-400" },
    debug: { icon: Info, color: "text-gray-500" },
  };

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const RdpLogViewer: React.FC<RdpLogViewerProps> = ({
  isVisible,
  sessionFilter,
}) => {
  const mgr = useRdpLogViewer(isVisible, sessionFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="relative flex-1">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            value={mgr.filter}
            onChange={(e) => mgr.setFilter(e.target.value)}
            placeholder="Filter logs..."
            className="sor-settings-input sor-settings-input-compact sor-settings-input-sm w-full pl-7 pr-2 placeholder-gray-500"
          />
        </div>
        <select
          value={mgr.levelFilter}
          onChange={(e) => mgr.setLevelFilter(e.target.value)}
          className="sor-settings-select sor-settings-input-sm"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        {mgr.sessionIds.length > 0 && (
          <select
            value={mgr.sessionIdFilter}
            onChange={(e) => mgr.setSessionIdFilter(e.target.value)}
            className="sor-settings-select sor-settings-input-sm max-w-[80px]"
            data-tooltip="Filter by session"
          >
            <option value="all">All sessions</option>
            {mgr.sessionIds.map((sid) => (
              <option key={sid} value={sid}>
                {sid.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => mgr.setAutoScroll(!mgr.autoScroll)}
          className={`p-1 rounded transition-colors ${mgr.autoScroll ? "text-indigo-400 bg-indigo-900/30" : "text-gray-500 hover:text-[var(--color-textSecondary)]"}`}
          data-tooltip={mgr.autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
        >
          <ArrowDown size={12} />
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={mgr.scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono text-[10px]"
      >
        {mgr.filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-xs">
            No log entries
          </div>
        ) : (
          mgr.filteredLogs.map((entry, i) => {
            const config = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
            const Icon = config.icon;
            return (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-start gap-1.5 px-1.5 py-0.5 hover:bg-[var(--color-surface)]/50 rounded"
              >
                <Icon
                  size={10}
                  className={`${config.color} flex-shrink-0 mt-0.5`}
                />
                <span className="text-gray-500 flex-shrink-0">
                  {formatTimestamp(entry.timestamp)}
                </span>
                {entry.session_id && (
                  <span
                    className="text-gray-600 flex-shrink-0"
                    title={entry.session_id}
                  >
                    [{entry.session_id.slice(0, 6)}]
                  </span>
                )}
                <span className="text-[var(--color-textSecondary)] break-all">
                  {entry.message}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 border-t border-[var(--color-border)] text-[10px] text-gray-500 flex-shrink-0">
        {mgr.filteredLogs.length} / {mgr.logs.length} entries
      </div>
    </div>
  );
};

export default RdpLogViewer;
