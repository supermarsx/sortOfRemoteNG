import React from "react";
import { useTranslation } from "react-i18next";
import { Database, FileText, Link } from "lucide-react";
import type { McpTabProps } from "./types";

export const ResourcesTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4" data-testid="mcp-resources-tab">
      {/* Static resources */}
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          {t("mcpServer.resources.static", "Resources")}
        </h3>
        {mgr.resources.map((r) => (
          <div
            key={r.uri}
            className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]"
            data-testid={`mcp-resource-${r.name}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Database size={12} className="text-teal-400" />
              <span className="text-xs font-medium text-[var(--color-text-primary)]">{r.name}</span>
              {r.mimeType && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">
                  {r.mimeType}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent)] font-mono mb-1">
              <Link size={9} />
              {r.uri}
            </div>
            {r.description && (
              <p className="text-[10px] text-[var(--color-text-secondary)]">{r.description}</p>
            )}
          </div>
        ))}
      </div>

      {mgr.resources.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          {t("mcpServer.resources.empty", "No resources available")}
        </div>
      )}
    </div>
  );
};
