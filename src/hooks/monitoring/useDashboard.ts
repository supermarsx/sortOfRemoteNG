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
  DashboardThresholds,
} from "../../types/monitoring/dashboard";

const DEFAULT_CONFIG: DashboardConfig = {
  enabled: true,
  refreshIntervalMs: 30000,
  healthCheckTimeoutMs: 5000,
  maxSparklinePoints: 60,
  parallelChecks: 10,
  showOnStartup: false,
  thresholds: {
    latencyMs: 500,
    cpuPercent: 80,
    memoryPercent: 80,
  },
};

const DEFAULT_LAYOUT: DashboardLayout = {
  widgets: [
    {
      id: "summary",
      widgetType: "health_summary",
      title: "Health Summary",
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      config: {},
    },
    {
      id: "alerts",
      widgetType: "alerts",
      title: "Active Alerts",
      x: 4,
      y: 0,
      w: 4,
      h: 2,
      config: {},
    },
    {
      id: "stats",
      widgetType: "quick_stats",
      title: "Quick Stats",
      x: 8,
      y: 0,
      w: 4,
      h: 2,
      config: {},
    },
    {
      id: "heatmap",
      widgetType: "heatmap",
      title: "Connection Heatmap",
      x: 0,
      y: 2,
      w: 8,
      h: 3,
      config: {},
    },
    {
      id: "recent",
      widgetType: "recent",
      title: "Recent Connections",
      x: 8,
      y: 2,
      w: 4,
      h: 3,
      config: {},
    },
    {
      id: "sparklines",
      widgetType: "sparklines",
      title: "Latency Sparklines",
      x: 0,
      y: 5,
      w: 12,
      h: 3,
      config: {},
    },
  ],
  columns: 12,
  rowHeight: 80,
};

type BackendDashboardConfig = {
  enabled?: boolean;
  poll_interval_seconds?: number;
  max_latency_history?: number;
  max_concurrent_checks?: number;
  health_check_timeout_ms?: number;
  alert_retention_hours?: number;
  widgets?: unknown[];
  thresholds?: DashboardThresholds;
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};

const normalizeStatus = (status: unknown) => {
  const raw = String(status ?? "unknown").toLowerCase();
  if (raw === "healthy") return "healthy";
  if (raw === "degraded") return "degraded";
  if (raw === "down" || raw === "unhealthy") return "unhealthy";
  if (raw === "unreachable") return "unreachable";
  return "unknown";
};

const normalizeHealthEntry = (value: unknown): ConnectionHealthEntry => {
  const entry = asRecord(value);
  return {
    connectionId: entry.connectionId ?? entry.connection_id ?? "",
    connectionName: entry.connectionName ?? entry.name ?? "",
    protocol: entry.protocol ?? "",
    hostname: entry.hostname ?? "",
    status: normalizeStatus(entry.status),
    latencyMs: entry.latencyMs ?? entry.latency_ms ?? null,
    lastChecked: entry.lastChecked ?? entry.last_checked ?? "",
    lastSeen: entry.lastSeen ?? entry.last_seen ?? null,
    uptimePercent: entry.uptimePercent ?? entry.uptime_pct ?? 0,
    errorMessage: entry.errorMessage ?? entry.last_error ?? null,
    checkCount: entry.checkCount ?? 0,
    failCount: entry.failCount ?? entry.error_count ?? 0,
  };
};

const normalizeHealthSummary = (value: unknown): HealthSummary => {
  const summary = asRecord(value);
  const total = summary.total ?? summary.total_connections ?? 0;
  const healthy = summary.healthy ?? summary.online ?? 0;
  const unhealthy = summary.unhealthy ?? summary.offline ?? summary.down ?? 0;
  const unknown = summary.unknown ?? 0;
  return {
    total,
    healthy,
    degraded: summary.degraded ?? 0,
    unhealthy,
    unknown,
    unreachable: summary.unreachable ?? 0,
    averageLatencyMs: summary.averageLatencyMs ?? summary.avg_latency_ms ?? 0,
    overallUptimePercent:
      summary.overallUptimePercent ?? summary.health_pct ?? 100,
  };
};

const normalizeQuickStats = (value: unknown): QuickStats => {
  const stats = asRecord(value);
  const protocols = Array.isArray(stats.protocols_used)
    ? stats.protocols_used
    : [];
  return {
    totalConnections: stats.totalConnections ?? stats.total_connections ?? 0,
    activeSessionCount: stats.activeSessionCount ?? stats.active_sessions ?? 0,
    protocolBreakdown:
      stats.protocolBreakdown ??
      protocols.reduce<Record<string, number>>((acc, protocol) => {
        acc[String(protocol)] = (acc[String(protocol)] ?? 0) + 1;
        return acc;
      }, {}),
    recentConnectionCount: stats.recentConnectionCount ?? 0,
    averageLatencyMs: stats.averageLatencyMs ?? stats.avg_latency_ms ?? 0,
    alertCount: stats.alertCount ?? stats.recent_errors ?? 0,
  };
};

const normalizeDashboardState = (value: unknown): DashboardState => {
  const state = asRecord(value);
  return {
    summary: normalizeHealthSummary(state.summary ?? state.health_summary),
    alerts: (state.alerts ?? []) as DashboardAlert[],
    recentConnections: state.recentConnections ?? [],
    monitoring: Boolean(state.monitoring),
  };
};

const normalizeSparkline = (
  connectionId: string,
  value: unknown,
): SparklineData => {
  if (!Array.isArray(value)) return value as SparklineData;
  const points = value.map((latency, index) => ({
    timestamp: new Date(
      Date.now() - (value.length - index - 1) * 1000,
    ).toISOString(),
    latencyMs: typeof latency === "number" ? latency : null,
    healthy: typeof latency === "number",
  }));
  const valid = points
    .map((point) => point.latencyMs)
    .filter((latency): latency is number => typeof latency === "number");
  return {
    connectionId,
    points,
    minMs: valid.length ? Math.min(...valid) : 0,
    maxMs: valid.length ? Math.max(...valid) : 0,
    avgMs: valid.length
      ? valid.reduce((sum, latency) => sum + latency, 0) / valid.length
      : 0,
  };
};

const toFrontendConfig = (value: unknown): DashboardConfig => {
  const raw = asRecord(value);
  if ("refreshIntervalMs" in raw) {
    return { ...DEFAULT_CONFIG, ...(raw as Partial<DashboardConfig>) };
  }
  const backend = raw as BackendDashboardConfig;
  return {
    ...DEFAULT_CONFIG,
    enabled: backend.enabled ?? DEFAULT_CONFIG.enabled,
    refreshIntervalMs:
      (backend.poll_interval_seconds ??
        DEFAULT_CONFIG.refreshIntervalMs / 1000) * 1000,
    healthCheckTimeoutMs:
      backend.health_check_timeout_ms ?? DEFAULT_CONFIG.healthCheckTimeoutMs,
    maxSparklinePoints:
      backend.max_latency_history ?? DEFAULT_CONFIG.maxSparklinePoints,
    parallelChecks:
      backend.max_concurrent_checks ?? DEFAULT_CONFIG.parallelChecks,
    thresholds: backend.thresholds ?? DEFAULT_CONFIG.thresholds,
  };
};

const toBackendConfig = (cfg: DashboardConfig) => ({
  enabled: cfg.enabled,
  poll_interval_seconds: Math.max(1, Math.round(cfg.refreshIntervalMs / 1000)),
  max_latency_history: cfg.maxSparklinePoints,
  alert_retention_hours: 72,
  widgets: [],
  max_concurrent_checks: cfg.parallelChecks,
  health_check_timeout_ms: cfg.healthCheckTimeoutMs,
  thresholds: cfg.thresholds ?? DEFAULT_CONFIG.thresholds,
});

export function useDashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [config, setConfig] = useState<DashboardConfig>(DEFAULT_CONFIG);
  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [healthEntries, setHealthEntries] = useState<ConnectionHealthEntry[]>(
    [],
  );
  const [sparklines, setSpark] = useState<Record<string, SparklineData>>({});
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const s = await invoke<unknown>("dash_get_state");
      setState(normalizeDashboardState(s));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const fetchHealthSummary = useCallback(async () => {
    try {
      const summary = await invoke<unknown>("dash_get_health_summary");
      return normalizeHealthSummary(summary);
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchQuickStats = useCallback(async () => {
    try {
      const s = normalizeQuickStats(
        await invoke<unknown>("dash_get_quick_stats"),
      );
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

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      try {
        await invoke("dash_acknowledge_alert", { alertId });
        await fetchState();
      } catch (e) {
        setError(String(e));
      }
    },
    [fetchState],
  );

  const fetchConnectionHealth = useCallback(async (connectionId: string) => {
    try {
      const entry = await invoke<unknown>("dash_get_connection_health", {
        connectionId,
      });
      return normalizeHealthEntry(entry);
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const fetchAllHealth = useCallback(async () => {
    try {
      const entries = (await invoke<unknown[]>("dash_get_all_health")).map(
        normalizeHealthEntry,
      );
      setHealthEntries(entries);
      return entries;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchUnhealthy = useCallback(async () => {
    try {
      return (await invoke<unknown[]>("dash_get_unhealthy")).map(
        normalizeHealthEntry,
      );
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchSparkline = useCallback(
    async (connectionId: string) => {
      try {
        const s = normalizeSparkline(
          connectionId,
          await invoke<unknown>("dash_get_sparkline", {
            connectionId,
            width: config.maxSparklinePoints,
          }),
        );
        setSpark((prev) => ({ ...prev, [connectionId]: s }));
        return s;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [config.maxSparklinePoints],
  );

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
      return await invoke<
        Array<{
          connectionId: string;
          connectionName: string;
          protocol: string;
          timestamp: string;
        }>
      >("dash_get_recent", { count: limit ?? 10 });
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, []);

  const fetchTopLatency = useCallback(async (limit?: number) => {
    try {
      return (
        await invoke<unknown[]>("dash_get_top_latency", { count: limit ?? 10 })
      ).map(normalizeHealthEntry);
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
      await Promise.all([
        fetchState(),
        fetchAllHealth(),
        fetchHeatmap(),
        fetchQuickStats(),
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchState, fetchAllHealth, fetchHeatmap, fetchQuickStats]);

  const checkConnection = useCallback(
    async (connectionId: string, hostname = "", port = 0, protocol = "") => {
      try {
        const entry = await invoke<unknown>("dash_check_connection", {
          id: connectionId,
          hostname,
          port,
          protocol,
        });
        return normalizeHealthEntry(entry);
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [],
  );

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<unknown>("dash_get_config");
      setConfig(toFrontendConfig(c));
    } catch {
      /* use defaults */
    }
  }, []);

  const updateConfig = useCallback(
    async (cfg: Partial<DashboardConfig>) => {
      try {
        const merged = { ...config, ...cfg };
        await invoke("dash_update_config", { config: toBackendConfig(merged) });
        setConfig(merged);
      } catch (e) {
        setError(String(e));
      }
    },
    [config],
  );

  const setThresholds = useCallback(async (thresholds: DashboardThresholds) => {
    try {
      await invoke("dash_set_thresholds", { thresholds });
      setConfig((prev) => ({ ...prev, thresholds }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadLayout = useCallback(async () => {
    try {
      const l = await invoke<DashboardLayout>("dash_get_layout");
      setLayout(l);
    } catch {
      /* use defaults */
    }
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
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [
    config.enabled,
    config.refreshIntervalMs,
    fetchState,
    fetchAllHealth,
    fetchQuickStats,
  ]);

  return {
    state,
    config,
    layout,
    healthEntries,
    sparklines,
    heatmap,
    quickStats,
    loading,
    error,
    fetchState,
    fetchHealthSummary,
    fetchQuickStats,
    fetchAlerts,
    acknowledgeAlert,
    fetchConnectionHealth,
    fetchAllHealth,
    fetchUnhealthy,
    fetchSparkline,
    fetchHeatmap,
    fetchRecent,
    fetchTopLatency,
    startMonitoring,
    stopMonitoring,
    forceRefresh,
    checkConnection,
    loadConfig,
    updateConfig,
    loadLayout,
    updateLayout,
    setThresholds,
  };
}
