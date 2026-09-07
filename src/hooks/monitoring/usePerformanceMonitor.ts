import { useState, useEffect, useCallback, useMemo } from "react";
import { PerformanceMetrics } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";

export function normalizePerformanceMetric(
  metric: PerformanceMetrics,
): PerformanceMetrics {
  if (
    metric.source === "browser-measured" ||
    metric.source === "connection-timing"
  )
    return metric;
  // Older releases mixed simulated values with observations. Keep stored
  // records intact, but exclude unverifiable values from measured summaries.
  return {
    ...metric,
    source: "legacy-unverified",
    latency: null,
    throughput: null,
    cpuUsage: null,
    memoryUsage: null,
    dataTransferred: null,
  };
}

export function measuredAverage(values: (number | null)[]): number | null {
  const measured = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return measured.length
    ? measured.reduce((sum, value) => sum + value, 0) / measured.length
    : null;
}

export function performanceMetricsCsv(metrics: PerformanceMetrics[]): string {
  return [
    "Timestamp,Source,Connection Time (ms),Data Transferred (bytes),HTTP request time (ms),Throughput (KB/s),CPU (%),JS heap allocated (%)",
    ...metrics.map((raw) => {
      const m = normalizePerformanceMetric(raw);
      return [
        m.timestamp >= 946684800000 && Number.isFinite(m.timestamp)
          ? new Date(m.timestamp).toISOString()
          : "",
        m.source,
        m.connectionTime,
        m.dataTransferred,
        m.latency,
        m.throughput,
        m.cpuUsage,
        m.memoryUsage,
      ]
        .map((value) => value ?? "")
        .join(",");
    }),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Module-level helpers                                               */
/* ------------------------------------------------------------------ */

const normalizeLatencyTarget = (target: string): string => {
  const trimmed = target.trim();
  if (!trimmed) return "1.1.1.1";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

const measureLatency = async (
  target: string,
  signal: AbortSignal,
): Promise<number | null> => {
  const url = normalizeLatencyTarget(target);
  const start = performance.now();
  const request = new AbortController();
  const cancel = () => request.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) request.abort();
  const timeout = setTimeout(cancel, 5000);
  try {
    await fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      signal: request.signal,
    });
    if (request.signal.aborted) return null;
    return performance.now() - start;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
};

function normalizePollInterval(interval: number | undefined): number {
  return interval !== undefined && Number.isFinite(interval)
    ? Math.max(1000, interval)
    : 20000;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function usePerformanceMonitor(isOpen: boolean) {
  const settingsManager = useMemo(() => SettingsManager.getInstance(), []);

  /* ---- state ---- */
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([]);
  const [currentMetrics, setCurrentMetrics] =
    useState<PerformanceMetrics | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    normalizePollInterval(
      settingsManager.getSettings().performancePollIntervalMs,
    ),
  );
  const [latencyTarget, setLatencyTarget] = useState<string>(
    settingsManager.getSettings().performanceLatencyTarget || "1.1.1.1",
  );
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  /* ---- callbacks ---- */
  const loadMetrics = useCallback(() => {
    const storedMetrics = settingsManager.getPerformanceMetrics();
    setMetrics(storedMetrics.map(normalizePerformanceMetric));
  }, [settingsManager]);

  const updateCurrentMetrics = useCallback(
    async (signal: AbortSignal) => {
      const memoryInfo = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
        }
      ).memory;
      const latency = await measureLatency(latencyTarget, signal);
      if (signal.aborted) return false;

      const currentMetric: PerformanceMetrics = {
        connectionTime: null,
        dataTransferred: null,
        latency,
        throughput: null,
        cpuUsage: null,
        memoryUsage:
          memoryInfo &&
          memoryInfo.totalJSHeapSize > 0 &&
          Number.isFinite(memoryInfo.usedJSHeapSize)
            ? (memoryInfo.usedJSHeapSize / memoryInfo.totalJSHeapSize) * 100
            : null,
        timestamp: Date.now(),
        source: "browser-measured",
      };

      setCurrentMetrics(currentMetric);
      settingsManager.recordPerformanceMetric(currentMetric);
      return true;
    },
    [latencyTarget, settingsManager],
  );

  const handlePollIntervalChange = useCallback(
    (seconds: number) => {
      const safeSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 20;
      const intervalMs = safeSeconds * 1000;
      setPollIntervalMs(intervalMs);
      settingsManager
        .saveSettings(
          { performancePollIntervalMs: intervalMs },
          { silent: true },
        )
        .catch(console.error);
    },
    [settingsManager],
  );

  const exportMetrics = useCallback(() => {
    const csvContent = performanceMetricsCsv(metrics);

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `performance-metrics-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [metrics]);

  const clearMetrics = useCallback(() => {
    settingsManager.clearPerformanceMetrics?.();
    setMetrics([]);
    setShowClearConfirm(false);
  }, [settingsManager]);

  /* ---- format helpers ---- */
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }, []);

  const formatDuration = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }, []);

  /* ---- effects ---- */
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    loadMetrics();
    settingsManager
      .loadSettings()
      .then((loaded) => {
        if (isMounted) {
          const interval = normalizePollInterval(
            loaded.performancePollIntervalMs,
          );
          setPollIntervalMs(interval);
          setLatencyTarget(loaded.performanceLatencyTarget || "1.1.1.1");
        }
      })
      .catch(console.error);

    return () => {
      isMounted = false;
    };
  }, [isOpen, loadMetrics, settingsManager]);

  useEffect(() => {
    if (!isOpen) return;

    const intervalDuration = normalizePollInterval(pollIntervalMs);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const refreshMetrics = async () => {
      controller = new AbortController();
      try {
        const updated = await updateCurrentMetrics(controller.signal);
        if (!stopped && updated) loadMetrics();
      } catch (error) {
        console.error(error);
      } finally {
        if (!stopped) timer = setTimeout(refreshMetrics, intervalDuration);
      }
    };
    void refreshMetrics();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [isOpen, pollIntervalMs, updateCurrentMetrics, loadMetrics]);

  /* ---- derived / memos ---- */
  const filteredMetrics = useMemo(() => {
    let filtered = [...metrics];

    if (timeRangeFilter !== "all") {
      const now = Date.now();
      const ranges: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - (ranges[timeRangeFilter] || 0);
      filtered = filtered.filter((m) => m.timestamp >= cutoff);
    }

    return filtered;
  }, [metrics, timeRangeFilter]);

  const recentMetrics = useMemo(
    () => filteredMetrics.slice(0, 10),
    [filteredMetrics],
  );

  const avgLatency = useMemo(
    () => measuredAverage(filteredMetrics.map((m) => m.latency)),
    [filteredMetrics],
  );

  const avgThroughput = useMemo(
    () => measuredAverage(filteredMetrics.map((m) => m.throughput)),
    [filteredMetrics],
  );

  const avgCpuUsage = useMemo(
    () => measuredAverage(filteredMetrics.map((m) => m.cpuUsage)),
    [filteredMetrics],
  );

  const avgMemoryUsage = useMemo(
    () => measuredAverage(filteredMetrics.map((m) => m.memoryUsage)),
    [filteredMetrics],
  );

  return {
    /* state */
    metrics,
    currentMetrics,
    pollIntervalMs,
    metricFilter,
    setMetricFilter,
    timeRangeFilter,
    setTimeRangeFilter,
    showClearConfirm,
    setShowClearConfirm,

    /* actions */
    handlePollIntervalChange,
    exportMetrics,
    clearMetrics,

    /* derived */
    filteredMetrics,
    recentMetrics,
    avgLatency,
    avgThroughput,
    avgCpuUsage,
    avgMemoryUsage,

    /* helpers */
    formatBytes,
    formatDuration,
  };
}
