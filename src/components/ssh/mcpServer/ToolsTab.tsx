import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Wrench,
  Search,
  Shield,
  AlertTriangle,
  Eye,
  Globe,
  CheckCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { McpTabProps } from "./types";
import type { McpTool } from "../../../types/mcp/mcpServer";

export const ToolsTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const filteredTools = mgr.tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.description.toLowerCase().includes(search.toLowerCase()),
  );

  const categories = groupByCategory(filteredTools);

  return (
    <div className="space-y-3" data-testid="mcp-tools-tab">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("mcpServer.tools.search", "Search tools...")}
          className="w-full pl-8 pr-3 py-2 bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          data-testid="mcp-tools-search"
        />
      </div>

      {/* Summary */}
      <div className="text-xs text-[var(--color-textSecondary)]">
        {filteredTools.length} {t("mcpServer.tools.available", "tools available")}
      </div>

      {/* Grouped tools */}
      {Object.entries(categories).map(([category, tools]) => (
        <div key={category} className="space-y-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-textSecondary)] px-1">
            {category}
          </h3>
          {tools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              isExpanded={expandedTool === tool.name}
              onToggle={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
              t={t}
            />
          ))}
        </div>
      ))}

      {filteredTools.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-textSecondary)]">
          {t("mcpServer.tools.empty", "No tools match your search")}
        </div>
      )}
    </div>
  );
};

const ToolCard: React.FC<{
  tool: McpTool;
  isExpanded: boolean;
  onToggle: () => void;
  t: (key: string, fallback: string) => string;
}> = ({ tool, isExpanded, onToggle, t }) => {
  const ann = tool.annotations;

  return (
    <div
      className="rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] overflow-hidden"
      data-testid={`mcp-tool-${tool.name}`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surfaceHover)] transition-colors"
      >
        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} className="text-[var(--color-accent)] flex-shrink-0" />
        <span className="text-xs font-mono font-medium text-[var(--color-text-primary)] flex-1">
          {tool.name}
        </span>
        {/* Annotation badges */}
        <div className="flex items-center gap-1">
          {ann?.read_only && (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-primary">
              <Eye size={9} className="inline mr-0.5" />{t("mcpServer.tools.readOnly", "Read")}
            </span>
          )}
          {ann?.destructive && (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-error/20 text-error">
              <AlertTriangle size={9} className="inline mr-0.5" />{t("mcpServer.tools.destructive", "Destructive")}
            </span>
          )}
          {ann?.requires_confirmation && (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-warning/20 text-warning">
              <Shield size={9} className="inline mr-0.5" />{t("mcpServer.tools.confirm", "Confirm")}
            </span>
          )}
          {ann?.open_world && (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-primary/20 text-primary">
              <Globe size={9} className="inline mr-0.5" />{t("mcpServer.tools.external", "External")}
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-textSecondary)] pt-2">
            {tool.description}
          </p>
          {tool.inputSchema && (
            <div>
              <div className="text-[10px] font-semibold text-[var(--color-textSecondary)] mb-1 uppercase">
                {t("mcpServer.tools.inputSchema", "Input Schema")}
              </div>
              <pre className="text-[10px] text-[var(--color-text-primary)] bg-[var(--color-surface)] rounded p-2 overflow-x-auto max-h-48 scrollbar-thin">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function groupByCategory(tools: McpTool[]): Record<string, McpTool[]> {
  const groups: Record<string, McpTool[]> = {};
  for (const tool of tools) {
    const prefix = tool.name.split("_")[0];
    const category =
      prefix === "list" || prefix === "get" || prefix === "create" || prefix === "update" || prefix === "delete" || prefix === "search"
        ? "Connection Management"
        : prefix === "ssh"
          ? "SSH Operations"
          : prefix === "sftp"
            ? "File Transfer"
            : prefix === "db"
              ? "Database"
              : prefix === "ping" || prefix === "port" || prefix === "dns" || prefix === "wake"
                ? "Network"
                : "System";
    (groups[category] ??= []).push(tool);
  }
  return groups;
}
