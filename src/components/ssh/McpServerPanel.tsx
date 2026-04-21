import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import { useMcpServer } from "../../hooks/ssh/useMcpServer";
import type { McpServerPanelProps } from "./mcpServer/types";
import { McpServerToolbar } from "./mcpServer/McpServerToolbar";
import { OverviewTab } from "./mcpServer/OverviewTab";
import { ConfigTab } from "./mcpServer/ConfigTab";
import { ToolsTab } from "./mcpServer/ToolsTab";
import { ResourcesTab } from "./mcpServer/ResourcesTab";
import { PromptsTab } from "./mcpServer/PromptsTab";
import { SessionsTab } from "./mcpServer/SessionsTab";
import { LogsTab } from "./mcpServer/LogsTab";
import { EventsTab } from "./mcpServer/EventsTab";

export const McpServerPanel: React.FC<McpServerPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useMcpServer(isOpen);

  if (!isOpen) return null;

  const renderTab = () => {
    switch (mgr.activeTab) {
      case "overview":
        return <OverviewTab mgr={mgr} />;
      case "config":
        return <ConfigTab mgr={mgr} />;
      case "tools":
        return <ToolsTab mgr={mgr} />;
      case "resources":
        return <ResourcesTab mgr={mgr} />;
      case "prompts":
        return <PromptsTab mgr={mgr} />;
      case "sessions":
        return <SessionsTab mgr={mgr} />;
      case "logs":
        return <LogsTab mgr={mgr} />;
      case "events":
        return <EventsTab mgr={mgr} />;
      default:
        return <OverviewTab mgr={mgr} />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        <span className="text-sm font-semibold text-[var(--color-text)]">
          {t("mcpServer.title", "MCP Server")}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          mgr.status?.running
            ? "bg-success/20 text-success"
            : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
        }`}>
          {mgr.status?.running
            ? t("mcpServer.running", "Running")
            : t("mcpServer.stopped", "Stopped")}
        </span>
      </div>

      {/* Toolbar */}
      <McpServerToolbar mgr={mgr} />

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Error banner */}
        {mgr.error && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{mgr.error}</span>
            <button
              onClick={mgr.clearError}
              className="ml-auto text-error/60 hover:text-error"
            >
              ×
            </button>
          </div>
        )}

        {renderTab()}
      </div>
    </div>
  );
};
