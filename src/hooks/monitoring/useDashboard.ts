import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  DashboardState,
  DashboardConfig,
  DashboardLayout,
  DashboardAlert,
  ConnectionHealthEntry,
  HealthSummary,
  SparklineData,
  HeatmapCell,
  QuickStats,
} from "../../types/monitoring/dashboard";

const DEFAULT_CONFIG: DashboardConfig = {
  enabled: true,
  refreshIntervalMs: 30000,
  healthCheckTimeoutMs: 5000,
  maxSparklinePoints: 60,
  parallelChecks: 10,
  showOnStartup: false,
};

const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "summary", widgetType: "health_summary", title: "Health Summary", x: 0, y: 0, w: 4, h: 2, config: {} },
    { id: "alerts", widgetType: "alerts", title: "Active Alerts", x: 4, y: 0, w: 4, h: 2, config: {} },
    { id: "stats", widgetType: "quick_stats", title: "Quick Stats", x: 8, y: 0, w: 4, h: 2, config: {} },
    { id: "heatmap", widgetType: "heatmap", title: "Connection Heatmap", x: 0, y: 2, w: 8, h: 3, config: {} },
    { id: "recent", widgetType: "recent", title: "Recent Connections", x: 8, y: 2, w: 4, h: 3, config: {} },
    { id: "sparklines", widgetType: "sparklines", title: "Latency Sparklines", x: 0, y: 5, w: 12, h: 3, config: {} },
  ],
  columns: 12,
  rowHeight: 80,
};

export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_CONFIG);
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [healthEntries, setHealthEntries] = useState<ConnectionHealthEntry[]>([]);
  const [sparklines, setSpark] = useState<Record<string, SparklineData>>({});
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const s = await invoke<DashboardState>("dash_get_state");
      setState(s);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const fetchHealthSummary = useCallback(async () => {
    try {
      return await invoke<HealthSummary>("dash_get_health_summary");
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchQuickStats = useCallback(async () => {
    try {
      const s = await invoke<QuickStats>("dash_get_quick_stats");
      setQuickStats(s);
      return s;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      return await invoke<DashboardAlert[]>("dash_get_alerts");
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const acknowledgeAlert = useCallback(async (alertId: string) => {
    try {
      await invoke("dash_acknowledge_alert", { alertId });
      await fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const fetchConnectionHealth = useCallback(async (connectionId: string) => {
    try {
      return await invoke<ConnectionHealthEntry>("dash_get_connection_health", { connectionId });
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchAllHealth = useCallback(async () => {
    try {
      const entries = await invoke<ConnectionHealthEntry[]>("dash_get_all_health");
      setHealthEntries(entries);
      return entries;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchUnhealthy = useCallback(async () => {
    try {
      return await invoke<ConnectionHealthEntry[]>("dash_get_unhealthy");
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchSparkline = useCallback(async (connectionId: string) => {
    try {
      const s = await invoke<SparklineData>("dash_get_sparkline", { connectionId });
      setSpark(prev => ({ ...prev, [connectionId]: s }));
      return s;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchHeatmap = useCallback(async () => {
    try {
      const h = await invoke<HeatmapCell[]>("dash_get_heatmap");
      setHeatmap(h);
      return h;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchRecent = useCallback(async (limit?: number) => {
    try {
      return await invoke<Array<{ connectionId: string; connectionName: string; protocol: string; timestamp: string }>>("dash_get_recent", { limit: limit ?? 10 });
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchTopLatency = useCallback(async (limit?: number) => {
    try {
      return await invoke<ConnectionHealthEntry[]>("dash_get_top_latency", { limit: limit ?? 10 });
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const startMonitoring = useCallback(async () => {
    try {
      await invoke("dash_start_monitoring");
      await fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const stopMonitoring = useCallback(async () => {
    try {
      await invoke("dash_stop_monitoring");
      await fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const forceRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await invoke("dash_force_refresh");
      await Promise.all([fetchState(), fetchAllHealth(), fetchHeatmap(), fetchQuickStats()]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchState, fetchAllHealth, fetchHeatmap, fetchQuickStats]);

  const checkConnection = useCallback(async (connectionId: string) => {
    try {
      return await invoke<ConnectionHealthEntry>("dash_check_connection", { connectionId });
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<DashboardConfig>("dash_get_config");
      setConfig(c);
    } catch { /* use defaults */ }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<DashboardConfig>) => {
    try {
      const merged = { ...config, ...cfg };
      await invoke("dash_update_config", { config: merged });
      setConfig(merged);
    } catch (e) {
      setError(String(e));
    }
  }, [config]);

  const loadLayout = useCallback(async () => {
    try {
      const l = await invoke<DashboardLayout>("dash_get_layout");
      setLayout(l);
    } catch { /* use defaults */ }
  }, []);

  const updateLayout = useCallback(async (l: DashboardLayout) => {
    try {
      await invoke("dash_update_layout", { layout: l });
      setLayout(l);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (config.enabled && config.refreshIntervalMs > 0) {
      intervalRef.current = setInterval(() => {
        fetchState();
        fetchAllHealth();
        fetchQuickStats();
      }, config.refreshIntervalMs);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  }, [config.enabled, config.refreshIntervalMs, fetchState, fetchAllHealth, fetchQuickStats]);

  return {
    state, config, layout, healthEntries, sparklines, heatmap, quickStats,
    loading, error,
    fetchState, fetchHealthSummary, fetchQuickStats, fetchAlerts,
    acknowledgeAlert, fetchConnectionHealth, fetchAllHealth, fetchUnhealthy,
    fetchSparkline, fetchHeatmap, fetchRecent, fetchTopLatency,
    startMonitoring, stopMonitoring, forceRefresh, checkConnection,
    loadConfig, updateConfig, loadLayout, updateLayout,
  };
}
