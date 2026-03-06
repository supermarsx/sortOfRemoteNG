import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  McpServerConfig,
  McpServerStatus,
  McpSession,
  McpTool,
  McpResource,
  McpPrompt,
  McpLogEntry,
  McpEvent,
  McpMetrics,
  McpToolCallLog,
  McpPanelTab,
} from "../../types/mcp/mcpServer";
import { DEFAULT_MCP_CONFIG } from "../../types/mcp/mcpServer";

// ─── Tauri runtime check ───────────────────────────────────────────

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

// ─── Types ─────────────────────────────────────────────────────────

export interface UseMcpServerResult {
  // Panel state
  activeTab: McpPanelTab;
  setActiveTab: (tab: McpPanelTab) => void;

  // Loading / Error
  isLoading: boolean;
  error: string | null;
  clearError: () => void;

  // Status
  status: McpServerStatus | null;
  refreshStatus: () => Promise<void>;

  // Server lifecycle
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  isStarting: boolean;
  isStopping: boolean;

  // Configuration
  config: McpServerConfig;
  updateConfig: (config: McpServerConfig) => Promise<void>;
  isSavingConfig: boolean;

  // API Key
  generateApiKey: () => Promise<string | null>;
  isGeneratingKey: boolean;

  // Sessions
  sessions: McpSession[];
  refreshSessions: () => Promise<void>;
  disconnectSession: (sessionId: string) => Promise<void>;

  // Tools / Resources / Prompts
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  refreshCapabilities: () => Promise<void>;

  // Metrics
  metrics: McpMetrics | null;
  refreshMetrics: () => Promise<void>;
  resetMetrics: () => Promise<void>;

  // Logs
  logs: McpLogEntry[];
  refreshLogs: () => Promise<void>;
  clearLogs: () => Promise<void>;

  // Events
  events: McpEvent[];
  refreshEvents: () => Promise<void>;

  // Tool call history
  toolCallLogs: McpToolCallLog[];
  refreshToolCallLogs: () => Promise<void>;
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useMcpServer(isOpen: boolean): UseMcpServerResult {
  // Panel tab state
  const [activeTab, setActiveTab] = useState<McpPanelTab>("overview");

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);

  // Core data
  const [status, setStatus] = useState<McpServerStatus | null>(null);
  const [config, setConfig] = useState<McpServerConfig>(DEFAULT_MCP_CONFIG);
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);
  const [metrics, setMetrics] = useState<McpMetrics | null>(null);
  const [logs, setLogs] = useState<McpLogEntry[]>([]);
  const [events, setEvents] = useState<McpEvent[]>([]);
  const [toolCallLogs, setToolCallLogs] = useState<McpToolCallLog[]>([]);

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearError = useCallback(() => setError(null), []);

  // ── Refresh helpers ────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const s = await invoke<McpServerStatus>("mcp_get_status");
      setStatus(s);
    } catch (e: any) {
      console.warn("Failed to get MCP status:", e);
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const c = await invoke<McpServerConfig>("mcp_get_config");
      setConfig(c);
    } catch (e: any) {
      console.warn("Failed to get MCP config:", e);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const s = await invoke<McpSession[]>("mcp_list_sessions");
      setSessions(s);
    } catch (e: any) {
      console.warn("Failed to list MCP sessions:", e);
    }
  }, []);

  const refreshCapabilities = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const [t, r, p] = await Promise.all([
        invoke<McpTool[]>("mcp_get_tools"),
        invoke<McpResource[]>("mcp_get_resources"),
        invoke<McpPrompt[]>("mcp_get_prompts"),
      ]);
      setTools(t);
      setResources(r);
      setPrompts(p);
    } catch (e: any) {
      console.warn("Failed to get MCP capabilities:", e);
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const m = await invoke<McpMetrics>("mcp_get_metrics");
      setMetrics(m);
    } catch (e: any) {
      console.warn("Failed to get MCP metrics:", e);
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const l = await invoke<McpLogEntry[]>("mcp_get_logs", { limit: 200 });
      setLogs(l);
    } catch (e: any) {
      console.warn("Failed to get MCP logs:", e);
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const e = await invoke<McpEvent[]>("mcp_get_events", { limit: 200 });
      setEvents(e);
    } catch (e: any) {
      console.warn("Failed to get MCP events:", e);
    }
  }, []);

  const refreshToolCallLogs = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const l = await invoke<McpToolCallLog[]>("mcp_get_tool_call_logs", { limit: 100 });
      setToolCallLogs(l);
    } catch (e: any) {
      console.warn("Failed to get MCP tool call logs:", e);
    }
  }, []);

  // ── Server lifecycle ───────────────────────────────────

  const startServer = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    setIsStarting(true);
    try {
      const s = await invoke<McpServerStatus>("mcp_start_server");
      setStatus(s);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e.message || "Failed to start MCP server");
    } finally {
      setIsStarting(false);
    }
  }, []);

  const stopServer = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    setIsStopping(true);
    try {
      const s = await invoke<McpServerStatus>("mcp_stop_server");
      setStatus(s);
      setSessions([]);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e.message || "Failed to stop MCP server");
    } finally {
      setIsStopping(false);
    }
  }, []);

  // ── Configuration ──────────────────────────────────────

  const updateConfig = useCallback(async (newConfig: McpServerConfig) => {
    if (!isTauri()) return;
    setError(null);
    setIsSavingConfig(true);
    try {
      await invoke("mcp_update_config", { config: newConfig });
      setConfig(newConfig);
      await refreshStatus();
    } catch (e: any) {
      setError(typeof e === "string" ? e : e.message || "Failed to update MCP config");
    } finally {
      setIsSavingConfig(false);
    }
  }, [refreshStatus]);

  // ── API Key ────────────────────────────────────────────

  const generateApiKey = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    setIsGeneratingKey(true);
    try {
      const key = await invoke<string>("mcp_generate_api_key");
      await refreshConfig();
      return key;
    } catch (e: any) {
      setError(typeof e === "string" ? e : e.message || "Failed to generate API key");
      return null;
    } finally {
      setIsGeneratingKey(false);
    }
  }, [refreshConfig]);

  // ── Sessions ───────────────────────────────────────────

  const disconnectSession = useCallback(async (sessionId: string) => {
    if (!isTauri()) return;
    try {
      await invoke("mcp_disconnect_session", { sessionId });
      await refreshSessions();
    } catch (e: any) {
      setError(typeof e === "string" ? e : e.message || "Failed to disconnect session");
    }
  }, [refreshSessions]);

  // ── Logs ───────────────────────────────────────────────

  const clearLogs = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("mcp_clear_logs");
      setLogs([]);
    } catch (e: any) {
      console.warn("Failed to clear MCP logs:", e);
    }
  }, []);

  // ── Metrics ────────────────────────────────────────────

  const resetMetrics = useCallback(async () => {
    if (!isTauri()) return;
    try {
      await invoke("mcp_reset_metrics");
      await refreshMetrics();
    } catch (e: any) {
      console.warn("Failed to reset MCP metrics:", e);
    }
  }, [refreshMetrics]);

  // ── Initial load when panel opens ──────────────────────

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    Promise.all([
      refreshStatus(),
      refreshConfig(),
      refreshCapabilities(),
    ]).finally(() => setIsLoading(false));
  }, [isOpen, refreshStatus, refreshConfig, refreshCapabilities]);

  // ── Tab-specific data loading ──────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    switch (activeTab) {
      case "sessions":
        refreshSessions();
        break;
      case "logs":
        refreshLogs();
        break;
      case "events":
        refreshEvents();
        refreshToolCallLogs();
        break;
      case "overview":
        refreshStatus();
        refreshMetrics();
        break;
    }
  }, [
    isOpen,
    activeTab,
    refreshSessions,
    refreshLogs,
    refreshEvents,
    refreshToolCallLogs,
    refreshStatus,
    refreshMetrics,
  ]);

  // ── Status polling when server is running ──────────────

  useEffect(() => {
    if (!isOpen || !status?.running) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(() => {
      refreshStatus();
      if (activeTab === "sessions") refreshSessions();
      if (activeTab === "logs") refreshLogs();
      if (activeTab === "events") {
        refreshEvents();
        refreshToolCallLogs();
      }
      if (activeTab === "overview") refreshMetrics();
    }, 5000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [
    isOpen,
    status?.running,
    activeTab,
    refreshStatus,
    refreshSessions,
    refreshLogs,
    refreshEvents,
    refreshToolCallLogs,
    refreshMetrics,
  ]);

  return {
    activeTab,
    setActiveTab,
    isLoading,
    error,
    clearError,
    status,
    refreshStatus,
    startServer,
    stopServer,
    isStarting,
    isStopping,
    config,
    updateConfig,
    isSavingConfig,
    generateApiKey,
    isGeneratingKey,
    sessions,
    refreshSessions,
    disconnectSession,
    tools,
    resources,
    prompts,
    refreshCapabilities,
    metrics,
    refreshMetrics,
    resetMetrics,
    logs,
    refreshLogs,
    clearLogs,
    events,
    refreshEvents,
    toolCallLogs,
    refreshToolCallLogs,
  };
}
