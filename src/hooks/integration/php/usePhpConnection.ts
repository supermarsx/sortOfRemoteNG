// usePhpConnection — the PHP-FPM connection-lifecycle hook (t42 §4b, crate lead
// t42-php-L). Owns the 3 shell commands (connect / disconnect / list_connections);
// the category tabs get only the resulting `connectionId`.
//
// NOTE: this crate has no `php_ping` (unlike cpanel) — there is no live-status
// re-check command, so the hook exposes only connect / disconnect / listConnections.
//
// The `config` arg is the snake_case `PhpConnectionConfig` (this crate carries no
// serde rename — see `src/types/php/index.ts`). Only the command arg names
// (`id`, `config`) follow Tauri's camelCase convention.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type {
  PhpConnectionConfig,
  PhpConnectionSummary,
} from "../../../types/php";

/** Thin invoke wrappers for the shell's 3 connection commands. */
export const phpConnectionApi = {
  connect: (id: string, config: PhpConnectionConfig) =>
    invoke<PhpConnectionSummary>("php_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("php_disconnect", { id }),
  listConnections: () => invoke<string[]>("php_list_connections"),
};

/** Connection lifecycle state for the PHP-FPM shell. Persistence of host +
 *  credentials is handled separately by `useIntegrationConfigStore`; this hook
 *  only owns the live backend session identified by `connectionId`. */
export function usePhpConnection() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PhpConnectionSummary | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (
      id: string,
      config: PhpConnectionConfig,
    ): Promise<PhpConnectionSummary> => {
      setConnecting(true);
      setError(null);
      try {
        const result = await phpConnectionApi.connect(id, config);
        setConnectionId(id);
        setSummary(result);
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
      await phpConnectionApi.disconnect(connectionId);
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    } finally {
      setConnectionId(null);
      setSummary(null);
    }
  }, [connectionId]);

  return {
    connectionId,
    summary,
    connecting,
    error,
    connect,
    disconnect,
    setError,
  };
}

export type PhpConnectionManager = ReturnType<typeof usePhpConnection>;
