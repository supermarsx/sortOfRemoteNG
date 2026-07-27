// useCpanelConnection — the cPanel/WHM connection-lifecycle hook (t42 §4b, crate
// lead t42-cpanel-L). Owns the 4 shell commands (connect/disconnect/ping/
// list_connections); the category tabs get only the resulting `connectionId`.
//
// The `config` arg is the snake_case `CpanelConnectionConfig` (this crate carries
// no serde rename — see `src/types/cpanel/index.ts`). Only the command arg names
// (`id`, `config`) follow Tauri's camelCase convention.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";

import type {
  CpanelConnectionConfig,
  CpanelConnectionSummary,
} from "../../../types/cpanel";

/** Thin invoke wrappers for the shell's 4 connection commands. */
export const cpanelConnectionApi = {
  connect: (id: string, config: CpanelConnectionConfig) =>
    invoke<CpanelConnectionSummary>("cpanel_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("cpanel_disconnect", { id }),
  ping: (id: string) => invoke<CpanelConnectionSummary>("cpanel_ping", { id }),
  listConnections: () => invoke<string[]>("cpanel_list_connections"),
};

/** Connection lifecycle state for the cPanel/WHM shell. Persistence of host +
 *  credentials is handled separately by `useIntegrationConfigStore`; this hook
 *  only owns the live backend session identified by `connectionId`. */
export function useCpanelConnection() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CpanelConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnectById = useCallback(async (id: string): Promise<void> => {
    try {
      await cpanelConnectionApi.disconnect(id);
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, []);

  const connect = useCallback(
    async (
      id: string,
      config: CpanelConnectionConfig,
    ): Promise<CpanelConnectionSummary> => {
      return trackConnect(
        `cpanel:${id}`,
        async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await cpanelConnectionApi.connect(
              id,
              withGlobalHttpProxy(config),
            );
            setConnectionId(id);
            setSummary(result);
            return result;
          } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error).message;
            setError(msg);
            setConnectionId(null);
            setSummary(null);
            throw e;
          } finally {
            setConnecting(false);
          }
        },
        () => disconnectById(id),
      );
    },
    [disconnectById, trackConnect],
  );

  const disconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await trackDisconnect(`cpanel:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const ping = useCallback(async () => {
    if (!connectionId) return;
    try {
      const result = await cpanelConnectionApi.ping(connectionId);
      setSummary(result);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, [connectionId]);

  return {
    connectionId,
    summary,
    connecting,
    error,
    connect,
    disconnect,
    ping,
    setError,
  };
}

export type CpanelConnectionManager = ReturnType<typeof useCpanelConnection>;
