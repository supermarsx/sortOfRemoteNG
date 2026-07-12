// Ansible — connection-lifecycle invoke slice + hook (t42 §4b, crate lead
// t42-ansible-L).
//
// Owns the 5 shell commands (connect/disconnect/list_connections/is_available/
// get_info). The per-category tabs get only the resulting `connectionId` and
// bind the remaining 55 `ansible_*` commands via their own invoke slices
// (`useAnsibleRuns`, `useAnsibleContent`).
//
// Command ARG names are camelCase (Tauri default); the `config` payload's STRUCT
// fields are snake_case (this crate has no `rename_all` — see `types/ansible`).

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { AnsibleConnectionConfig, AnsibleInfo } from "../../../types/ansible";

/** Thin 1:1 wrappers over the connection-lifecycle commands. */
export const ansibleConnectionApi = {
  connect: (id: string, config: AnsibleConnectionConfig) =>
    invoke<AnsibleInfo>("ansible_connect", { id, config }),
  disconnect: (id: string) => invoke<void>("ansible_disconnect", { id }),
  listConnections: () => invoke<string[]>("ansible_list_connections"),
  isAvailable: (id: string) => invoke<boolean>("ansible_is_available", { id }),
  getInfo: (id: string) => invoke<AnsibleInfo>("ansible_get_info", { id }),
};

export interface UseAnsibleConnection {
  connectionId: string | null;
  info: AnsibleInfo | null;
  connecting: boolean;
  error: string | null;
  /** Connect using an already-persisted instance id as the stable session id. */
  connect: (id: string, config: AnsibleConnectionConfig) => Promise<boolean>;
  disconnect: () => Promise<void>;
  clearError: () => void;
}

/** React hook wrapping the Ansible control-node connection lifecycle. Mirrors the
 *  isLoading/error idiom used across the integration hooks. */
export function useAnsibleConnection(): UseAnsibleConnection {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [info, setInfo] = useState<AnsibleInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (id: string, config: AnsibleConnectionConfig): Promise<boolean> => {
      setConnecting(true);
      setError(null);
      try {
        const result = await ansibleConnectionApi.connect(id, config);
        setConnectionId(id);
        setInfo(result);
        return true;
      } catch (e) {
        const msg = typeof e === "string" ? e : (e as Error).message;
        setError(msg);
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      await ansibleConnectionApi.disconnect(connectionId);
    } catch {
      // Best-effort: drop local state even if the backend session is already gone.
    } finally {
      setConnectionId(null);
      setInfo(null);
    }
  }, [connectionId]);

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionId,
    info,
    connecting,
    error,
    connect,
    disconnect,
    clearError,
  };
}
