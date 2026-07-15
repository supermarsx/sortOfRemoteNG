// usePrometheus — real Tauri `invoke(...)` wrappers for the sorng-prometheus
// backend.
//
// Binds the 22 Prometheus commands actually registered in the Tauri handler
// (`sorng-commands-ops/src/ops_handler.rs`). The crate's `commands.rs` defines
// 16 further functions (ping, exemplars, active/dropped targets, target
// metadata, alerting/recording-group rules, alertmanagers, TSDB snapshot/delete/
// clean, get_metadata, update/expire silence) that are NOT wired into the
// handler — invoking them would fail at runtime, so they are intentionally not
// exposed here (see the panel's header note / t42 plan R4).
//
// Every command is keyed by a connection `id` (the backend holds a map of live
// clients). Argument names match the Rust `#[tauri::command]` params exactly,
// and the `config` object mirrors `PrometheusConnectionConfig`'s serde wire
// shape (snake_case).

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import type {
  Alert,
  ConfigReloadResult,
  FederationResult,
  MetricMetadata,
  PromTarget,
  PrometheusConfig,
  PrometheusConnectionConfig,
  PrometheusConnectionSummary,
  QueryResult,
  RangeQueryResult,
  RuleGroup,
  Silence,
  SilenceMatcher,
  TsdbStatus,
} from "../../types/prometheus";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const prometheusApi = {
  // Connection lifecycle
  connect: (id: string, config: PrometheusConnectionConfig) =>
    invoke<PrometheusConnectionSummary>("prometheus_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("prometheus_disconnect", { id }),
  listConnections: () => invoke<string[]>("prometheus_list_connections"),

  // Queries
  instantQuery: (id: string, query: string, time?: string, timeout?: string) =>
    invoke<QueryResult>("prometheus_instant_query", {
      id,
      query,
      time,
      timeout,
    }),
  rangeQuery: (
    id: string,
    query: string,
    start: string,
    end: string,
    step: string,
    timeout?: string,
  ) =>
    invoke<RangeQueryResult>("prometheus_range_query", {
      id,
      query,
      start,
      end,
      step,
      timeout,
    }),
  series: (
    id: string,
    matchSelectors: string[],
    start?: string,
    end?: string,
  ) =>
    invoke<Record<string, string>[]>("prometheus_series", {
      id,
      matchSelectors,
      start,
      end,
    }),
  labelNames: (
    id: string,
    matchSelectors: string[],
    start?: string,
    end?: string,
  ) =>
    invoke<string[]>("prometheus_label_names", {
      id,
      matchSelectors,
      start,
      end,
    }),
  labelValues: (
    id: string,
    labelName: string,
    matchSelectors: string[],
    start?: string,
    end?: string,
  ) =>
    invoke<string[]>("prometheus_label_values", {
      id,
      labelName,
      matchSelectors,
      start,
      end,
    }),
  federate: (id: string, matchSelectors: string[]) =>
    invoke<FederationResult>("prometheus_federate", { id, matchSelectors }),

  // Targets
  listTargets: (id: string, stateFilter?: string) =>
    invoke<PromTarget[]>("prometheus_list_targets", { id, stateFilter }),

  // Rules & alerts
  listRules: (id: string, ruleType?: string) =>
    invoke<RuleGroup[]>("prometheus_list_rules", { id, ruleType }),
  listRecordingRules: (id: string) =>
    invoke<RuleGroup[]>("prometheus_list_recording_rules", { id }),
  listAlerts: (id: string) => invoke<Alert[]>("prometheus_list_alerts", { id }),

  // Silences
  listSilences: (id: string, filter?: string) =>
    invoke<Silence[]>("prometheus_list_silences", { id, filter }),
  getSilence: (id: string, silenceId: string) =>
    invoke<Silence>("prometheus_get_silence", { id, silenceId }),
  createSilence: (
    id: string,
    matchers: SilenceMatcher[],
    startsAt: string,
    endsAt: string,
    createdBy: string,
    comment: string,
  ) =>
    invoke<string>("prometheus_create_silence", {
      id,
      matchers,
      startsAt,
      endsAt,
      createdBy,
      comment,
    }),
  deleteSilence: (id: string, silenceId: string) =>
    invoke<void>("prometheus_delete_silence", { id, silenceId }),

  // Status / config / TSDB / metadata
  getConfig: (id: string) =>
    invoke<PrometheusConfig>("prometheus_get_config", { id }),
  reloadConfig: (id: string) =>
    invoke<ConfigReloadResult>("prometheus_reload_config", { id }),
  getFlags: (id: string) =>
    invoke<Record<string, string>>("prometheus_get_flags", { id }),
  getTsdbStatus: (id: string) =>
    invoke<TsdbStatus>("prometheus_get_tsdb_status", { id }),
  listMetadata: (id: string, metric?: string, limit?: number) =>
    invoke<Record<string, MetricMetadata[]>>("prometheus_list_metadata", {
      id,
      metric,
      limit,
    }),
};

export type PrometheusApi = typeof prometheusApi;

// ─── React hook ──────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful Prometheus session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, plus shared `isLoading`/`error`, and exposes the full
 * registered command surface via `api` (each call takes the connection id). The
 * `run` wrapper funnels arbitrary ops through the same loading/error handling.
 */
export function usePrometheus() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PrometheusConnectionSummary | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping in-flight ops flipping isLoading incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setIsLoading(false);
    }
  }, []);

  const connect = useCallback(
    async (
      id: string,
      config: PrometheusConnectionConfig,
    ): Promise<boolean> => {
      setIsConnecting(true);
      setError(null);
      try {
        const s = await prometheusApi.connect(id, withGlobalHttpProxy(config));
        setConnectionId(id);
        setSummary(s);
        return true;
      } catch (e) {
        setError(errMsg(e));
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await prometheusApi.disconnect(connectionId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // state
    connectionId,
    summary,
    isConnected: connectionId !== null,
    isConnecting,
    isLoading,
    error,
    setError,
    clearError,
    // lifecycle
    connect,
    disconnect,
    // full registered command surface + shared runner
    api: prometheusApi,
    run,
  };
}

export type PrometheusManager = ReturnType<typeof usePrometheus>;
