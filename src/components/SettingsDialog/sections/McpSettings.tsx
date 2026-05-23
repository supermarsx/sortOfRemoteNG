import React from "react";
import { AlertCircle, Bot } from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import { useMcpSettings } from "../../../hooks/settings/useMcpSettings";
import type { GlobalSettings } from "../../../types/settings/settings";
import { ConfigTab } from "../../ssh/mcpServer/ConfigTab";

interface McpSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>;
}

export const McpSettings: React.FC<McpSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useMcpSettings(settings, updateSettings);

  return (
    <div className="space-y-6" data-testid="section-mcp-server">
      <SectionHeading
        icon={<Bot className="w-5 h-5 text-primary" />}
        title={mgr.t("mcpServer.title", "MCP Server")}
        description={mgr.t(
          "settings.mcpServer.description",
          "Configure the Model Context Protocol server for AI assistant integration and automation.",
        )}
      />

      {mgr.error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/30 text-xs text-error">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{mgr.error}</span>
          <button
            type="button"
            onClick={mgr.clearError}
            className="ml-auto text-error/70 hover:text-error"
            aria-label={mgr.t("common.dismiss", "Dismiss")}
          >
            x
          </button>
        </div>
      )}

      <ConfigTab mgr={mgr} />
    </div>
  );
};

export default McpSettings;
