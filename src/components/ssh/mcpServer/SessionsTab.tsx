import React from "react";
import { useTranslation } from "react-i18next";
import {
  Users,
  Clock,
  X,
  Globe,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import type { McpTabProps } from "./types";

export const SessionsTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-3" data-testid="mcp-sessions-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--color-textSecondary)]">
          {mgr.sessions.length} {t("mcpServer.sessions.active", "active sessions")}
        </div>
        <button
          onClick={mgr.refreshSessions}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-[var(--color-textSecondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surfaceHover)]"
        >
          <RefreshCw size={10} />
          {t("mcpServer.sessions.refresh", "Refresh")}
        </button>
      </div>

      {/* Session list */}
      {mgr.sessions.map((session) => (
        <div
          key={session.id}
          className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]"
          data-testid={`mcp-session-${session.id}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users size={12} className="text-primary" />
              <span className="text-xs font-mono text-[var(--color-text-primary)]">
                {session.id.slice(0, 12)}…
              </span>
              {session.initialized ? (
                <span className="flex items-center gap-1 text-[9px] text-success">
                  <CheckCircle size={9} />{t("mcpServer.sessions.initialized", "Initialized")}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] text-warning">
                  <XCircle size={9} />{t("mcpServer.sessions.pending", "Pending")}
                </span>
              )}
            </div>
            <button
              onClick={() => mgr.disconnectSession(session.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-error hover:bg-error/10"
              title={t("mcpServer.sessions.disconnect", "Disconnect")}
            >
              <X size={10} />
              {t("mcpServer.sessions.disconnect", "Disconnect")}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            {session.client_info && (
              <div className="flex items-center gap-1 text-[var(--color-textSecondary)]">
                <Globe size={9} />
                {session.client_info.name} v{session.client_info.version}
              </div>
            )}
            <div className="flex items-center gap-1 text-[var(--color-textSecondary)]">
              <Clock size={9} />
              {t("mcpServer.sessions.created", "Created")}: {formatTime(session.created_at)}
            </div>
            <div className="text-[var(--color-textSecondary)]">
              {t("mcpServer.sessions.requests", "Requests")}: {session.request_count}
            </div>
            <div className="text-[var(--color-textSecondary)]">
              {t("mcpServer.sessions.protocol", "Protocol")}: {session.protocol_version}
            </div>
          </div>

          {session.subscriptions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {session.subscriptions.map((sub) => (
                <span
                  key={sub}
                  className="px-1.5 py-0.5 rounded text-[9px] bg-teal-500/20 text-teal-400 font-mono"
                >
                  {sub}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {mgr.sessions.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-textSecondary)]">
          {t("mcpServer.sessions.empty", "No active MCP sessions")}
        </div>
      )}
    </div>
  );
};
