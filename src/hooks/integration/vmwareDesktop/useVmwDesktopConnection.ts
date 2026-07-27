// useVmwDesktopConnection — connection lifecycle for the VMware Workstation
// integration (t42, vmware-desktop LEAD slice).
//
// Wraps the 5 connection commands of `sorng-vmware-desktop` (commands.rs
// "Connection" section). Argument names match the Rust `#[tauri::command]`
// signatures exactly so Tauri's camelCase mapping works without serializers.
// Category slices (`vms`, `host`) ship their own `<x>Api` slices; this file owns
// only connect/disconnect/status.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxyArgs } from "../httpProxy";
import { useIntegrationConnectionLifecycle } from "../../integrations/IntegrationSessionLifecycle";
import type {
  VmwConnectionSummary,
  VmwHostInfo,
} from "../../../types/vmwareDesktop";

/** Args accepted by `vmwd_connect` (commands.rs:14). Individual params, NOT a
 *  config object. NOTE: `vmwd_connect` does not currently accept
 *  `vmrestSkipTlsVerify` — it is included here so the frontend is ready once the
 *  backend threads it (see t42-vmwaredesktop-categories.md escalation); Tauri
 *  ignores the extra key until then. */
export interface VmwDesktopConnectArgs {
  vmrunPath?: string | null;
  vmrestHost?: string | null;
  vmrestPort?: number | null;
  vmrestUsername?: string | null;
  vmrestPassword?: string | null;
  vmrestSkipTlsVerify?: boolean;
  autoStartVmrest?: boolean;
  timeoutSecs?: number;
  proxyUrl?: string;
}

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const vmwDesktopConnectionApi = {
  connect: (args: VmwDesktopConnectArgs) =>
    invoke<VmwConnectionSummary>("vmwd_connect", {
      vmrunPath: args.vmrunPath ?? null,
      vmrestHost: args.vmrestHost ?? null,
      vmrestPort: args.vmrestPort ?? null,
      vmrestUsername: args.vmrestUsername ?? null,
      vmrestPassword: args.vmrestPassword ?? null,
      vmrestSkipTlsVerify: args.vmrestSkipTlsVerify ?? false,
      autoStartVmrest: args.autoStartVmrest ?? false,
      timeoutSecs: args.timeoutSecs ?? null,
      proxyUrl: args.proxyUrl ?? null,
    }),
  disconnect: () => invoke<void>("vmwd_disconnect"),
  isConnected: () => invoke<boolean>("vmwd_is_connected"),
  connectionSummary: () =>
    invoke<VmwConnectionSummary>("vmwd_connection_summary"),
  hostInfo: () => invoke<VmwHostInfo>("vmwd_host_info"),
};

/**
 * Connection lifecycle hook for the VMware Workstation panel shell. Holds
 * `isConnecting`/`error`/`summary`/`hostInfo` and connect/disconnect/refresh
 * callbacks. Category sub-tabs receive the derived `connected` flag + `summary`
 * from the shell via `VmwDesktopTabProps`.
 */
export function useVmwDesktopConnection() {
  const { trackConnect, trackDisconnect } = useIntegrationConnectionLifecycle();
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VmwConnectionSummary | null>(null);
  const [hostInfo, setHostInfo] = useState<VmwHostInfo | null>(null);
  const ownedConnectionRef = useRef(false);

  const disconnectOperation = useCallback(async () => {
    if (!ownedConnectionRef.current) return;
    try {
      await vmwDesktopConnectionApi.disconnect();
      ownedConnectionRef.current = false;
      setConnected(false);
      setSummary(null);
      setHostInfo(null);
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
      throw e;
    }
  }, []);

  const connect = useCallback(
    async (args: VmwDesktopConnectArgs) =>
      trackConnect(
        "vmwareDesktop:global",
        async () => {
          setIsConnecting(true);
          setError(null);
          try {
            const result = await vmwDesktopConnectionApi.connect(
              withGlobalHttpProxyArgs(args),
            );
            ownedConnectionRef.current = true;
            setSummary(result);
            setConnected(true);
            try {
              setHostInfo(await vmwDesktopConnectionApi.hostInfo());
            } catch {
              setHostInfo(null);
            }
            return result;
          } catch (e) {
            const msg = typeof e === "string" ? e : (e as Error).message;
            setError(msg);
            setConnected(false);
            setSummary(null);
            setHostInfo(null);
            throw e;
          } finally {
            setIsConnecting(false);
          }
        },
        disconnectOperation,
      ),
    [disconnectOperation, trackConnect],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    if (!ownedConnectionRef.current) {
      setConnected(false);
      setSummary(null);
      setHostInfo(null);
      return;
    }
    try {
      await trackDisconnect("vmwareDesktop:global", disconnectOperation);
    } catch {
      // disconnectOperation already synchronizes the local error and state.
    }
  }, [disconnectOperation, trackDisconnect]);

  const refreshStatus = useCallback(async () => {
    if (!ownedConnectionRef.current) {
      setConnected(false);
      setSummary(null);
      setHostInfo(null);
      return;
    }
    try {
      const isConn = await vmwDesktopConnectionApi.isConnected();
      setConnected(isConn);
      if (isConn) {
        setSummary(await vmwDesktopConnectionApi.connectionSummary());
      } else {
        setSummary(null);
        setHostInfo(null);
      }
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    }
  }, []);

  return {
    connected,
    isConnecting,
    error,
    summary,
    hostInfo,
    connect,
    disconnect,
    refreshStatus,
  };
}

export type VmwDesktopConnectionManager = ReturnType<
  typeof useVmwDesktopConnection
>;
