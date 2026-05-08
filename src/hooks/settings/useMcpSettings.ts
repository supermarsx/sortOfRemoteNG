import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMcpServer, type UseMcpServerResult } from "../ssh/useMcpServer";
import type { GlobalSettings } from "../../types/settings/settings";
import type { McpServerConfig } from "../../types/mcp/mcpServer";
import { DEFAULT_MCP_CONFIG } from "../../types/mcp/mcpServer";

type UpdateSettings = (updates: Partial<GlobalSettings>) => void | Promise<void>;

function normalizeMcpConfig(config: Partial<McpServerConfig> | undefined): McpServerConfig {
  return {
    ...DEFAULT_MCP_CONFIG,
    ...(config ?? {}),
  };
}

function configsEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type UseMcpSettingsResult = Omit<
  UseMcpServerResult,
  "config" | "updateConfig" | "generateApiKey"
> & {
  t: (key: string, fallback?: string) => string;
  config: McpServerConfig;
  updateConfig: (config: McpServerConfig) => Promise<void>;
  generateApiKey: () => Promise<string | null>;
};

export function useMcpSettings(
  settings: GlobalSettings,
  updateSettings: UpdateSettings,
): UseMcpSettingsResult {
  const { t } = useTranslation();
  const server = useMcpServer(true);
  const translate = useCallback(
    (key: string, fallback?: string) => t(key, fallback ?? key),
    [t],
  );
  const {
    config: serverConfig,
    updateConfig: updateServerConfig,
    generateApiKey: generateServerApiKey,
  } = server;

  const settingsConfig = useMemo(
    () => normalizeMcpConfig(settings.mcpServer),
    [settings.mcpServer],
  );

  useEffect(() => {
    if (!settings.mcpServer) {
      void updateSettings({ mcpServer: settingsConfig });
    }
  }, [settings.mcpServer, settingsConfig, updateSettings]);

  useEffect(() => {
    if (!configsEqual(serverConfig, settingsConfig)) {
      void updateServerConfig(settingsConfig);
    }
  }, [serverConfig, settingsConfig, updateServerConfig]);

  const updateConfig = useCallback(
    async (config: McpServerConfig) => {
      const nextConfig = normalizeMcpConfig(config);
      await updateSettings({ mcpServer: nextConfig });
      await updateServerConfig(nextConfig);
    },
    [updateServerConfig, updateSettings],
  );

  const generateApiKey = useCallback(async () => {
    const key = await generateServerApiKey();
    if (key) {
      await updateSettings({
        mcpServer: {
          ...settingsConfig,
          api_key: key,
        },
      });
    }
    return key;
  }, [generateServerApiKey, settingsConfig, updateSettings]);

  return {
    ...server,
    t: translate,
    config: settingsConfig,
    updateConfig,
    generateApiKey,
  };
}
