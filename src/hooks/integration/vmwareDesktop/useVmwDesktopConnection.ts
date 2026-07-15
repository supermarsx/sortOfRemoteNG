// useVmwDesktopConnection — connection lifecycle for the VMware Workstation
// integration (t42, vmware-desktop LEAD slice).
//
// Wraps the 5 connection commands of `sorng-vmware-desktop` (commands.rs
// "Connection" section). Argument names match the Rust `#[tauri::command]`
// signatures exactly so Tauri's camelCase mapping works without serializers.
// Category slices (`vms`, `host`) ship their own `<x>Api` slices; this file owns
// only connect/disconnect/status.

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxyArgs } from "../httpProxy";
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
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<VmwConnectionSummary | null>(null);
  const [hostInfo, setHostInfo] = useState<VmwHostInfo | null>(null);

  const connect = useCallback(async (args: VmwDesktopConnectArgs) => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await vmwDesktopConnectionApi.connect(
        withGlobalHttpProxyArgs(args),
      );
      setSummary(result);
      setConnected(true);
      // Host detection is best-effort; a failure here must not fail connect.
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
      throw e;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await vmwDesktopConnectionApi.disconnect();
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error).message;
      setError(msg);
    } finally {
      setConnected(false);
      setSummary(null);
      setHostInfo(null);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const isConn = await vmwDesktopConnectionApi.isConnected();
      setConnected(isConn);
      if (isConn) {
        setSummary(await vmwDesktopConnectionApi.connectionSummary());
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
