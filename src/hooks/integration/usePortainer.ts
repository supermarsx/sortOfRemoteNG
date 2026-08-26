// usePortainer — real Tauri `invoke(...)` wrappers for the sorng-portainer backend.
//
// Binds all 14 Portainer commands registered in the Tauri handler
// (`sorng-commands-ops` / `sorng-commands-services` services_handler.rs). Every
// command after connect is keyed by a connection `id` (the backend holds a map
// of live clients). Argument keys are camelCase — Tauri v2 maps them to the
// snake_case Rust `#[tauri::command]` params (e.g. `endpointId` → `endpoint_id`).
// The `config` object mirrors `PortainerConnectionConfig`'s serde wire shape.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "./httpProxy";
import { useIntegrationConnectionLifecycle } from "../integrations/IntegrationSessionLifecycle";
import type {
  PortainerConnectionConfig,
  PortainerConnectionSummary,
  PortainerContainer,
  PortainerEndpoint,
  PortainerLogLine,
  PortainerStack,
} from "../../types/portainer";

// ─── Low-level invoke wrappers (one per registered #[tauri::command]) ─────────

export const portainerApi = {
  // ── Connection ──────────────────────────────────────────────────
  connect: (id: string, config: PortainerConnectionConfig) =>
    invoke<PortainerConnectionSummary>("portainer_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("portainer_disconnect", { id }),
  listConnections: () => invoke<string[]>("portainer_list_connections"),
  ping: (id: string) =>
    invoke<PortainerConnectionSummary>("portainer_ping", { id }),

  // ── Environments ────────────────────────────────────────────────
  listEndpoints: (id: string) =>
    invoke<PortainerEndpoint[]>("portainer_list_endpoints", { id }),

  // ── Containers ──────────────────────────────────────────────────
  listContainers: (id: string, endpointId: number, all?: boolean) =>
    invoke<PortainerContainer[]>("portainer_list_containers", {
      id,
      endpointId,
      all,
    }),
  startContainer: (id: string, endpointId: number, containerId: string) =>
    invoke<void>("portainer_start_container", { id, endpointId, containerId }),
  stopContainer: (id: string, endpointId: number, containerId: string) =>
    invoke<void>("portainer_stop_container", { id, endpointId, containerId }),
  restartContainer: (id: string, endpointId: number, containerId: string) =>
    invoke<void>("portainer_restart_container", {
      id,
      endpointId,
      containerId,
    }),
  containerLogs: (
    id: string,
    endpointId: number,
    containerId: string,
    tail?: number,
  ) =>
    invoke<PortainerLogLine[]>("portainer_container_logs", {
      id,
      endpointId,
      containerId,
      tail,
    }),

  // ── Stacks ──────────────────────────────────────────────────────
  listStacks: (id: string) =>
    invoke<PortainerStack[]>("portainer_list_stacks", { id }),
  startStack: (id: string, stackId: number, endpointId: number) =>
    invoke<void>("portainer_start_stack", { id, stackId, endpointId }),
  stopStack: (id: string, stackId: number, endpointId: number) =>
    invoke<void>("portainer_stop_stack", { id, stackId, endpointId }),

  // ── Web UI ──────────────────────────────────────────────────────
  webUiUrl: (id: string) => invoke<string>("portainer_web_ui_url", { id }),
};

export type PortainerApi = typeof portainerApi;

// ─── React hook ──────────────────────────────────────────────────────────────

export type PortainerStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as { message?: unknown; kind?: unknown };
    if (typeof obj.message === "string") {
      return typeof obj.kind === "string"
        ? `${obj.kind}: ${obj.message}`
        : obj.message;
    }
  }
  return String(e);
}

/**
 * Stateful Portainer session hook. Owns the connect/disconnect lifecycle for a
 * single connection `id`, caches the last fetched environments / containers /
 * stacks / logs, and exposes the full registered command surface via `api`.
 * The `run` wrapper funnels arbitrary ops through the same busy/error handling.
 */
export function usePortainer() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<PortainerStatus>("disconnected");
  const [summary, setSummary] = useState<PortainerConnectionSummary | null>(
    null,
  );
  const [endpoints, setEndpoints] = useState<PortainerEndpoint[]>([]);
  const [containers, setContainers] = useState<PortainerContainer[]>([]);
  const [stacks, setStacks] = useState<PortainerStack[]>([]);
  const [logs, setLogs] = useState<PortainerLogLine[]>([]);
  const [webUiUrl, setWebUiUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against overlapping in-flight ops flipping busy incorrectly.
  const inflight = useRef(0);

  const run = useCallback(async <T>(op: () => Promise<T>): Promise<T> => {
    inflight.current += 1;
    setBusy(true);
    setError(null);
    try {
      return await op();
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      inflight.current -= 1;
      if (inflight.current === 0) setBusy(false);
    }
  }, []);

  const resetSession = useCallback(() => {
    setConnectionId(null);
    setSummary(null);
    setEndpoints([]);
    setContainers([]);
    setStacks([]);
    setLogs([]);
    setWebUiUrl(null);
  }, []);

  const disconnectById = useCallback(
    async (id: string): Promise<void> => {
      try {
        await portainerApi.disconnect(id);
      } catch (e) {
        setError(errMsg(e));
        throw e;
      } finally {
        resetSession();
        setStatus("disconnected");
      }
    },
    [resetSession],
  );

  const connect = useCallback(
    async (id: string, config: PortainerConnectionConfig): Promise<boolean> => {
      let acknowledgementAvailable =
        config.acknowledge_invalid_cert_risk === true;
      const reconnectConfig = {
        ...config,
        acknowledge_invalid_cert_risk: false,
      };
      try {
        await trackConnect(
          `portainer:${id}`,
          async () => {
            setStatus("connecting");
            setError(null);
            try {
              const attemptConfig = {
                ...reconnectConfig,
                acknowledge_invalid_cert_risk: acknowledgementAvailable,
              };
              acknowledgementAvailable = false;
              const result = await portainerApi.connect(
                id,
                withGlobalHttpProxy(attemptConfig, "camel"),
              );
              setConnectionId(id);
              setSummary(result);
              setStatus("connected");
              // Best effort: the web-UI URL is derived server-side from the
              // normalised base URL; a failure here must not fail connect.
              try {
                setWebUiUrl(await portainerApi.webUiUrl(id));
              } catch {
                setWebUiUrl(null);
              }
              return result;
            } catch (e) {
              resetSession();
              setStatus("error");
              setError(errMsg(e));
              throw e;
            }
          },
          () => disconnectById(id),
        );
        return true;
      } catch {
        return false;
      }
    },
    [disconnectById, resetSession, trackConnect],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connectionId) return;
    try {
      await trackDisconnect(`portainer:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // disconnectById already synchronizes the local error and state.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const requireId = useCallback((): string => {
    if (!connectionId)
      throw new Error("not_connected: Portainer not connected");
    return connectionId;
  }, [connectionId]);

  const refreshSummary = useCallback(async () => {
    const id = requireId();
    const result = await run(() => portainerApi.ping(id));
    setSummary(result);
    return result;
  }, [requireId, run]);

  const loadEndpoints = useCallback(async () => {
    const id = requireId();
    const result = await run(() => portainerApi.listEndpoints(id));
    setEndpoints(result);
    return result;
  }, [requireId, run]);

  const loadContainers = useCallback(
    async (endpointId: number, all?: boolean) => {
      const id = requireId();
      const result = await run(() =>
        portainerApi.listContainers(id, endpointId, all),
      );
      setContainers(result);
      return result;
    },
    [requireId, run],
  );

  const startContainer = useCallback(
    async (endpointId: number, containerId: string) => {
      const id = requireId();
      await run(() => portainerApi.startContainer(id, endpointId, containerId));
    },
    [requireId, run],
  );

  const stopContainer = useCallback(
    async (endpointId: number, containerId: string) => {
      const id = requireId();
      await run(() => portainerApi.stopContainer(id, endpointId, containerId));
    },
    [requireId, run],
  );

  const restartContainer = useCallback(
    async (endpointId: number, containerId: string) => {
      const id = requireId();
      await run(() =>
        portainerApi.restartContainer(id, endpointId, containerId),
      );
    },
    [requireId, run],
  );

  const loadLogs = useCallback(
    async (endpointId: number, containerId: string, tail?: number) => {
      const id = requireId();
      const result = await run(() =>
        portainerApi.containerLogs(id, endpointId, containerId, tail),
      );
      setLogs(result);
      return result;
    },
    [requireId, run],
  );

  const loadStacks = useCallback(async () => {
    const id = requireId();
    const result = await run(() => portainerApi.listStacks(id));
    setStacks(result);
    return result;
  }, [requireId, run]);

  const startStack = useCallback(
    async (stackId: number, endpointId: number) => {
      const id = requireId();
      await run(() => portainerApi.startStack(id, stackId, endpointId));
    },
    [requireId, run],
  );

  const stopStack = useCallback(
    async (stackId: number, endpointId: number) => {
      const id = requireId();
      await run(() => portainerApi.stopStack(id, stackId, endpointId));
    },
    [requireId, run],
  );

  const clearError = useCallback(() => setError(null), []);
  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    // state
    connectionId,
    status,
    summary,
    endpoints,
    containers,
    stacks,
    logs,
    webUiUrl,
    error,
    busy,
    isConnected: status === "connected" && connectionId !== null,
    isConnecting: status === "connecting",
    setError,
    clearError,
    clearLogs,
    // lifecycle
    connect,
    disconnect,
    // data ops (state-caching)
    refreshSummary,
    loadEndpoints,
    loadContainers,
    startContainer,
    stopContainer,
    restartContainer,
    loadLogs,
    loadStacks,
    startStack,
    stopStack,
    // full registered command surface + shared runner
    api: portainerApi,
    run,
  };
}

export type PortainerManager = ReturnType<typeof usePortainer>;
