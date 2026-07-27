// useMailcowConnection — the mailcow connection-lifecycle hook (t42 §4b, crate
// lead t42-mailcow-L). Owns the 4 shell commands (connect/disconnect/ping/
// list_connections); the category tabs get only the resulting `connectionId`.
//
// The `config` arg is the snake_case `MailcowConnectionConfig` (this crate carries
// no serde rename — see `src/types/mailcow/index.ts`). Only the command arg names
// (`id`, `config`) follow Tauri's camelCase convention.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";

import type {
  MailcowConnectionConfig,
  MailcowConnectionSummary,
} from "../../../types/mailcow";

/** Thin invoke wrappers for the shell's 4 connection commands. */
export const mailcowConnectionApi = {
  connect: (id: string, config: MailcowConnectionConfig) =>
    invoke<MailcowConnectionSummary>("mailcow_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("mailcow_disconnect", { id }),
  ping: (id: string) =>
    invoke<MailcowConnectionSummary>("mailcow_ping", { id }),
  listConnections: () => invoke<string[]>("mailcow_list_connections"),
};

/** Connection lifecycle state for the mailcow shell. Persistence of host +
 *  api_key is handled separately by `useIntegrationConfigStore`; this hook only
 *  owns the live backend session identified by `connectionId`. */
export function useMailcowConnection() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MailcowConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnectById = useCallback(async (id: string): Promise<void> => {
    try {
      await mailcowConnectionApi.disconnect(id);
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, []);

  const connect = useCallback(
    async (
      id: string,
      config: MailcowConnectionConfig,
    ): Promise<MailcowConnectionSummary> => {
      return trackConnect(
        `mailcow:${id}`,
        async () => {
          setConnecting(true);
          setError(null);
          try {
            const result = await mailcowConnectionApi.connect(
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
      await trackDisconnect(`mailcow:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const ping = useCallback(async () => {
    if (!connectionId) return;
    try {
      const result = await mailcowConnectionApi.ping(connectionId);
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

export type MailcowConnectionManager = ReturnType<typeof useMailcowConnection>;
