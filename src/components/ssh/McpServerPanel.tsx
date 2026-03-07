import React from "react";
import { useTranslation } from "react-i18next";
import { Server, AlertCircle } from "lucide-react";
import { useMcpServer } from "../../hooks/ssh/useMcpServer";
import Modal from "../ui/overlays/Modal";
import DialogHeader from "../ui/overlays/DialogHeader";
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="mcp-server-panel-modal"
    >
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-accent/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-accent/6 rounded-full blur-3xl" />
        <div className="absolute top-[50%] right-[25%] w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <DialogHeader
          icon={Server}
          iconColor="text-accent dark:text-accent"
          iconBg="bg-accent/20"
          title={t("mcpServer.title", "MCP Server")}
          badge={
            mgr.status?.running
              ? `${t("mcpServer.badge.running", "Running")} · ${mgr.status.active_sessions} ${t("mcpServer.badge.sessions", "sessions")}`
              : t("mcpServer.badge.stopped", "Stopped")
          }
          onClose={onClose}
          sticky
        />

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
    </Modal>
  );
};
