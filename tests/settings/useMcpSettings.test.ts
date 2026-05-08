import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import type { UseMcpServerResult } from "../../src/hooks/ssh/useMcpServer";
import { DEFAULT_MCP_CONFIG } from "../../src/types/mcp/mcpServer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

let mockServer: UseMcpServerResult;

vi.mock("../../src/hooks/ssh/useMcpServer", () => ({
  useMcpServer: () => mockServer,
}));

import { useMcpSettings } from "../../src/hooks/settings/useMcpSettings";

function makeServer(overrides: Partial<UseMcpServerResult> = {}): UseMcpServerResult {
  return {
    activeTab: "overview",
    setActiveTab: vi.fn(),
    isLoading: false,
    error: null,
    clearError: vi.fn(),
    status: null,
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    stopServer: vi.fn().mockResolvedValue(undefined),
    isStarting: false,
    isStopping: false,
    config: DEFAULT_MCP_CONFIG,
    updateConfig: vi.fn().mockResolvedValue(undefined),
    isSavingConfig: false,
    generateApiKey: vi.fn().mockResolvedValue("generated-key"),
    isGeneratingKey: false,
    sessions: [],
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    disconnectSession: vi.fn().mockResolvedValue(undefined),
    tools: [],
    resources: [],
    prompts: [],
    refreshCapabilities: vi.fn().mockResolvedValue(undefined),
    metrics: null,
    refreshMetrics: vi.fn().mockResolvedValue(undefined),
    resetMetrics: vi.fn().mockResolvedValue(undefined),
    logs: [],
    refreshLogs: vi.fn().mockResolvedValue(undefined),
    clearLogs: vi.fn().mockResolvedValue(undefined),
    events: [],
    refreshEvents: vi.fn().mockResolvedValue(undefined),
    toolCallLogs: [],
    refreshToolCallLogs: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<GlobalSettings["mcpServer"]> = {}): GlobalSettings {
  return {
    mcpServer: {
      ...DEFAULT_MCP_CONFIG,
      ...overrides,
    },
  } as GlobalSettings;
}

describe("useMcpSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = makeServer();
  });

  it("uses the Settings dialog MCP config as the source of truth", () => {
    const updateSettings = vi.fn();
    const settings = makeSettings({ port: 3200 });
    mockServer = makeServer({ config: settings.mcpServer });

    const { result } = renderHook(() => useMcpSettings(settings, updateSettings));

    expect(result.current.config.port).toBe(3200);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("saves config changes to app settings and syncs the backend service", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const settings = makeSettings();
    mockServer = makeServer({ config: settings.mcpServer });
    const nextConfig = { ...settings.mcpServer, enabled: true, port: 3300 };

    const { result } = renderHook(() => useMcpSettings(settings, updateSettings));

    await act(async () => {
      await result.current.updateConfig(nextConfig);
    });

    expect(updateSettings).toHaveBeenCalledWith({ mcpServer: nextConfig });
    expect(mockServer.updateConfig).toHaveBeenCalledWith(nextConfig);
  });

  it("stores generated API keys in app settings", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const settings = makeSettings({ api_key: "old-key" });
    mockServer = makeServer({ config: settings.mcpServer });

    const { result } = renderHook(() => useMcpSettings(settings, updateSettings));

    await act(async () => {
      await result.current.generateApiKey();
    });

    expect(mockServer.generateApiKey).toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith({
      mcpServer: {
        ...settings.mcpServer,
        api_key: "generated-key",
      },
    });
  });
});
