// useJiraConnection — the Jira connection-lifecycle hook (t42 §4b, crate lead
// t42-jira-L). Owns the 4 shell commands (connect/disconnect/ping/
// list_connections); the category tabs get only the resulting `connectionId`.
//
// The `config` arg is the snake_case `JiraConnectionConfig` (this crate carries
// no serde rename — see `src/types/jira/index.ts`). `config.auth` is serde's
// externally-tagged wire object (e.g. `{ ApiToken: { email, token } }`). Only the
// command arg names (`id`, `config`) follow Tauri's camelCase convention.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxy } from "../httpProxy";
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";

import type {
  JiraConnectionConfig,
  JiraConnectionStatus,
} from "../../../types/jira";

/** Thin invoke wrappers for the shell's 4 connection commands. */
export const jiraConnectionApi = {
  connect: (id: string, config: JiraConnectionConfig) =>
    invoke<JiraConnectionStatus>("jira_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("jira_disconnect", { id }),
  ping: (id: string) => invoke<JiraConnectionStatus>("jira_ping", { id }),
  listConnections: () => invoke<string[]>("jira_list_connections"),
};

/** Connection lifecycle state for the Jira shell. Persistence of host +
 *  credentials is handled separately by `useIntegrationConfigStore`; this hook
 *  only owns the live backend session identified by `connectionId`. */
export function useJiraConnection() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnectById = useCallback(async (id: string): Promise<void> => {
    try {
      await jiraConnectionApi.disconnect(id);
    } finally {
      setConnectionId(null);
      setStatus(null);
    }
  }, []);

  const connect = useCallback(
    async (
      id: string,
      config: JiraConnectionConfig,
    ): Promise<JiraConnectionStatus> => {
      let acknowledgementAvailable =
        config.acknowledge_invalid_cert_risk === true;
      const reconnectConfig = {
        ...config,
        acknowledge_invalid_cert_risk: false,
      };
      return trackConnect(
        `jira:${id}`,
        async () => {
          setConnecting(true);
          setError(null);
          try {
            const attemptConfig = {
              ...reconnectConfig,
              acknowledge_invalid_cert_risk: acknowledgementAvailable,
            };
            acknowledgementAvailable = false;
            const result = await jiraConnectionApi.connect(
              id,
              withGlobalHttpProxy(attemptConfig),
            );
            setConnectionId(id);
            setStatus(result);
            return result;
          } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error).message;
            setError(msg);
            setConnectionId(null);
            setStatus(null);
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
      await trackDisconnect(`jira:${connectionId}`, () =>
        disconnectById(connectionId),
      );
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    }
  }, [connectionId, disconnectById, trackDisconnect]);

  const ping = useCallback(async () => {
    if (!connectionId) return;
    try {
      const result = await jiraConnectionApi.ping(connectionId);
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

export type JiraConnectionManager = ReturnType<typeof useJiraConnection>;
