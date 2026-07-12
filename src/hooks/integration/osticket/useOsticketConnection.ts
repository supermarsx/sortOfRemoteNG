// useOsticketConnection — the osTicket connection-lifecycle hook (t42 §4b, crate
// lead t42-osticket-L). Owns the 4 shell commands (connect/disconnect/ping/
// list_connections); the category tabs get only the resulting `connectionId`.
//
// The `config` arg is the snake_case `OsticketConnectionConfig` (this crate
// carries no serde rename — see `src/types/osticket/index.ts`). Only the command
// arg names (`id`, `config`) follow Tauri's camelCase convention.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  OsticketConnectionConfig,
  OsticketConnectionStatus,
} from "../../../types/osticket";

/** Thin invoke wrappers for the shell's 4 connection commands. */
export const osticketConnectionApi = {
  connect: (id: string, config: OsticketConnectionConfig) =>
    invoke<OsticketConnectionStatus>("osticket_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("osticket_disconnect", { id }),
  ping: (id: string) =>
    invoke<OsticketConnectionStatus>("osticket_ping", { id }),
  listConnections: () => invoke<string[]>("osticket_list_connections"),
};

/** Connection lifecycle state for the osTicket shell. Persistence of host + the
 *  API key is handled separately by `useIntegrationConfigStore`; this hook only
 *  owns the live backend session identified by `connectionId`. */
export function useOsticketConnection() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<OsticketConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (
      id: string,
      config: OsticketConnectionConfig,
    ): Promise<OsticketConnectionStatus> => {
      setConnecting(true);
      setError(null);
      try {
        const result = await osticketConnectionApi.connect(id, config);
        setConnectionId(id);
        setStatus(result);
        return result;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await osticketConnectionApi.disconnect(connectionId);
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    } finally {
      setConnectionId(null);
      setStatus(null);
    }
  }, [connectionId]);

  const ping = useCallback(async () => {
    if (!connectionId) return;
    try {
      const result = await osticketConnectionApi.ping(connectionId);
      setStatus(result);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, [connectionId]);

  return {
    connectionId,
    status,
    connecting,
    error,
    connect,
    disconnect,
    ping,
    setError,
  };
}

export type OsticketConnectionManager = ReturnType<
  typeof useOsticketConnection
>;
