import React from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, ListChecks, CheckCircle, Circle } from "lucide-react";
import type { McpTabProps } from "./types";

export const PromptsTab: React.FC<McpTabProps> = ({ mgr }) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3" data-testid="mcp-prompts-tab">
      <div className="text-xs text-[var(--color-text-secondary)]">
        {mgr.prompts.length} {t("mcpServer.prompts.available", "prompt templates available")}
      </div>

      {mgr.prompts.map((prompt) => (
        <div
          key={prompt.name}
          className="p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]"
          data-testid={`mcp-prompt-${prompt.name}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={12} className="text-accent" />
            <span className="text-xs font-mono font-medium text-[var(--color-text-primary)]">
              {prompt.name}
            </span>
          </div>
          {prompt.description && (
            <p className="text-[10px] text-[var(--color-text-secondary)] mb-2">{prompt.description}</p>
          )}
          {prompt.arguments && prompt.arguments.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--color-text-secondary)]">
                <ListChecks size={9} />
                {t("mcpServer.prompts.arguments", "Arguments")}
              </div>
              {prompt.arguments.map((arg) => (
                <div key={arg.name} className="flex items-center gap-2 pl-2 text-[10px]">
                  {arg.required ? (
                    <CheckCircle size={9} className="text-success" />
                  ) : (
                    <Circle size={9} className="text-[var(--color-text-secondary)]" />
                  )}
                  <span className="font-mono text-[var(--color-text-primary)]">{arg.name}</span>
                  {arg.required && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-success/20 text-success">
                      {t("mcpServer.prompts.required", "required")}
                    </span>
                  )}
                  {arg.description && (
                    <span className="text-[var(--color-text-secondary)]">— {arg.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {mgr.prompts.length === 0 && (
        <div className="text-center py-8 text-xs text-[var(--color-text-secondary)]">
          {t("mcpServer.prompts.empty", "No prompts available")}
        </div>
      )}
    </div>
  );
};
