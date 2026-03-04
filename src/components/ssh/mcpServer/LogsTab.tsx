import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ScrollText,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Info,
  Bug,
  AlertCircle,
  Filter,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpLogLevel } from "../../../types/mcpServer";

const levelIcons: Record<string, React.ElementType> = {
  debug: Bug,
  info: Info,
  notice: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  critical: AlertCircle,
  alert: AlertCircle,
  emergency: AlertCircle,
};

const levelColors: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-blue-400",
  notice: "text-cyan-400",
  warning: "text-amber-400",
  error: "text-red-400",
  critical: "text-red-500",
  alert: "text-red-600",
  emergency: "text-red-700",
};

export const LogsTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [filterLevel, setFilterLevel] = useState<McpLogLevel | "">("");
  const [search, setSearch] = useState("");

  const filteredLogs = mgr.logs.filter((log) => {
    if (filterLevel && log.level !== filterLevel) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-logs-tab">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1">
          <Filter size={12} className="text-[var(--color-text-secondary)]" />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as McpLogLevel | "")}
            className="bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] outline-none"
          >
            <option value="">{t("mcpServer.logs.allLevels", "All levels")}</option>
            {["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mcpServer.logs.search", "Search logs...")}
            className="flex-1 bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] outline-none"
          />
        </div>
        <button
          onClick={mgr.refreshLogs}
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          title={t("mcpServer.logs.refresh", "Refresh")}
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={mgr.clearLogs}
          className="p-1.5 rounded hover:bg-red-500/10 text-red-400"
          title={t("mcpServer.logs.clear", "Clear")}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Log entries */}
      <div className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin">
        {filteredLogs.map((log) => {
          const Icon = levelIcons[log.level] || Info;
          const color = levelColors[log.level] || "text-gray-400";

          return (
            <div
              key={log.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded text-[10px] hover:bg-[var(--color-surface-hover)]"
            >
              <Icon size={10} className={`flex-shrink-0 mt-0.5 ${color}`} />
              <span className="text-[var(--color-text-secondary)] flex-shrink-0 w-16 font-mono">
                {formatTime(log.timestamp)}
              </span>
              <span className={`flex-shrink-0 w-12 uppercase font-semibold ${color}`}>
                {log.level}
              </span>
              <span className="text-[var(--color-text-secondary)] flex-shrink-0 w-20 font-mono truncate">
                {log.logger}
              </span>
              <span className="text-[var(--color-text-primary)] flex-1 break-all">
                {log.message}
              </span>
            </div>
          );
        })}
      </div>

      {filteredLogs.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          <ScrollText size={24} className="mx-auto mb-2 opacity-30" />
          {t("mcpServer.logs.empty", "No log entries")}
        </div>
      )}
    </div>
  );
};
