import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  RefreshCw,
  Zap,
  Users,
  Wrench,
  Database,
  Shield,
  Settings,
  AlertCircle,
  Play,
  Square,
  Clock,
  Filter,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpEventType } from "../../../types/mcp/mcpServer";

const eventIcons: Record<McpEventType, React.ElementType> = {
  ServerStarted: Play,
  ServerStopped: Square,
  SessionStarted: Users,
  SessionEnded: Users,
  ToolCalled: Wrench,
  ResourceRead: Database,
  PromptUsed: Zap,
  AuthFailed: Shield,
  ConfigChanged: Settings,
  Error: AlertCircle,
};

const eventColors: Record<McpEventType, string> = {
  ServerStarted: "text-success",
  ServerStopped: "text-error",
  SessionStarted: "text-accent",
  SessionEnded: "text-accent",
  ToolCalled: "text-primary",
  ResourceRead: "text-teal-400",
  PromptUsed: "text-warning",
  AuthFailed: "text-error",
  ConfigChanged: "text-info",
  Error: "text-error",
};

export const EventsTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [filterType, setFilterType] = useState<McpEventType | "">("");

  const filteredEvents = mgr.events
    .filter((e) => !filterType || e.event_type === filterType)
    .reverse(); // newest first

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-events-tab">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <Filter size={12} className="text-[var(--color-text-secondary)]" />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as McpEventType | "")}
          className="bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] outline-none"
        >
          <option value="">{t("mcpServer.events.allTypes", "All event types")}</option>
          {Object.keys(eventIcons).map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={mgr.refreshEvents}
          className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          title={t("mcpServer.events.refresh", "Refresh")}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Tool call log section */}
      {mgr.toolCallLogs.length > 0 && !filterType && (
        <div className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--color-text-secondary)] mb-2">
            <Wrench size={10} />
            {t("mcpServer.events.recentToolCalls", "Recent Tool Calls")}
          </h3>
          <div className="space-y-1">
            {mgr.toolCallLogs.slice(-10).reverse().map((log) => (
              <div key={log.id} className="flex items-center gap-2 text-[10px]">
                <span className={log.success ? "text-success" : "text-error"}>
                  {log.success ? "✓" : "✗"}
                </span>
                <span className="font-mono text-[var(--color-text-primary)]">{log.tool_name}</span>
                <span className="text-[var(--color-text-secondary)]">{log.duration_ms}ms</span>
                <span className="text-[var(--color-text-secondary)] flex-shrink-0">
                  <Clock size={8} className="inline mr-0.5" />
                  {formatTime(log.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event timeline */}
      <div className="space-y-1 max-h-[55vh] overflow-y-auto scrollbar-thin">
        {filteredEvents.map((event) => {
          const Icon = eventIcons[event.event_type] || Activity;
          const color = eventColors[event.event_type] || "text-text-muted";

          return (
            <div
              key={event.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded text-[10px] hover:bg-[var(--color-surface-hover)]"
            >
              <Icon size={10} className={`flex-shrink-0 mt-0.5 ${color}`} />
              <span className="text-[var(--color-text-secondary)] flex-shrink-0 w-16 font-mono">
                {formatTime(event.timestamp)}
              </span>
              <span className={`flex-shrink-0 font-medium ${color}`}>
                {event.event_type}
              </span>
              <span className="text-[var(--color-text-secondary)] flex-1 truncate">
                {JSON.stringify(event.details)}
              </span>
            </div>
          );
        })}
      </div>

      {filteredEvents.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          <Activity size={24} className="mx-auto mb-2 opacity-30" />
          {t("mcpServer.events.empty", "No events recorded")}
        </div>
      )}
    </div>
  );
};
