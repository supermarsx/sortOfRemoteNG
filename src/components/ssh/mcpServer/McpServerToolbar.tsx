import React from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Settings,
  Wrench,
  Database,
  MessageSquare,
  Users,
  ScrollText,
  Activity,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpPanelTab } from "../../../types/mcpServer";

const tabs: { key: McpPanelTab; icon: React.ElementType; labelKey: string; fallback: string }[] = [
  { key: "overview", icon: LayoutDashboard, labelKey: "mcpServer.tabs.overview", fallback: "Overview" },
  { key: "config", icon: Settings, labelKey: "mcpServer.tabs.config", fallback: "Config" },
  { key: "tools", icon: Wrench, labelKey: "mcpServer.tabs.tools", fallback: "Tools" },
  { key: "resources", icon: Database, labelKey: "mcpServer.tabs.resources", fallback: "Resources" },
  { key: "prompts", icon: MessageSquare, labelKey: "mcpServer.tabs.prompts", fallback: "Prompts" },
  { key: "sessions", icon: Users, labelKey: "mcpServer.tabs.sessions", fallback: "Sessions" },
  { key: "logs", icon: ScrollText, labelKey: "mcpServer.tabs.logs", fallback: "Logs" },
  { key: "events", icon: Activity, labelKey: "mcpServer.tabs.events", fallback: "Events" },
];

export const McpServerToolbar: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-border)] overflow-x-auto scrollbar-thin"
      role="tablist"
      data-testid="mcp-server-toolbar"
    >
      {tabs.map(({ key, icon: Icon, labelKey, fallback }) => {
        const isActive = mgr.activeTab === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => mgr.setActiveTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
              isActive
                ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            }`}
            data-testid={`mcp-tab-${key}`}
          >
            <Icon size={14} />
            <span>{t(labelKey, fallback)}</span>
            {key === "sessions" && mgr.sessions.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/20 text-[10px]">
                {mgr.sessions.length}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
