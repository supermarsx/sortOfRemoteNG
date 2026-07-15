// useVmware — real Tauri `invoke(...)` wrappers for the sorng-vmware backend.
//
// Pairs 1:1 with src-tauri/crates/sorng-vmware/src/commands.rs (55 commands).
// Argument names match the Rust `#[tauri::command]` params exactly (camelCase,
// per Tauri's snake_case↔camelCase arg mapping) so no custom serializer is needed.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { withGlobalHttpProxyArgs } from "./httpProxy";
import type {
  ClusterSummary,
  ConsoleSession,
  ConsoleTicket,
  ConsoleTicketType,
  CreateSnapshotSpec,
  DatacenterSummary,
  DatastoreInfo,
  DatastoreSummary,
  FolderSummary,
  GuestIdentity,
  HostInfo,
  HostSummary,
  InventorySummary,
  NetworkInfo,
  NetworkSummary,
  OpenConsoleRequest,
  ResourcePoolSummary,
  SnapshotSummary,
  VmCloneSpec,
  VmCpuUpdate,
  VmCreateSpec,
  VmInfo,
  VmMemoryUpdate,
  VmPowerState,
  VmQuickStats,
  VmRelocateSpec,
  VmSummary,
  VmrcConnectionConfig,
  VmrcSession,
  VmwareConnectArgs,
  VsphereConfigSafe,
} from "../../types/vmware";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const vmwareApi = {
  // Connection
  connect: (args: VmwareConnectArgs) =>
    invoke<string>("vmware_connect", {
      host: args.host,
      port: args.port,
      username: args.username,
      password: args.password,
      insecure: args.insecure,
      timeoutSecs: args.timeoutSecs,
      proxyUrl: args.proxyUrl ?? null,
    }),
  disconnect: () => invoke<void>("vmware_disconnect"),
  checkSession: () => invoke<boolean>("vmware_check_session"),
  isConnected: () => invoke<boolean>("vmware_is_connected"),
  getConfig: () => invoke<VsphereConfigSafe | null>("vmware_get_config"),

  // VM lifecycle
  listVms: () => invoke<VmSummary[]>("vmware_list_vms"),
  listRunningVms: () => invoke<VmSummary[]>("vmware_list_running_vms"),
  getVm: (vmId: string) => invoke<VmInfo>("vmware_get_vm", { vmId }),
  createVm: (spec: VmCreateSpec) =>
    invoke<string>("vmware_create_vm", { spec }),
  deleteVm: (vmId: string) => invoke<void>("vmware_delete_vm", { vmId }),
  powerOn: (vmId: string) => invoke<void>("vmware_power_on", { vmId }),
  powerOff: (vmId: string) => invoke<void>("vmware_power_off", { vmId }),
  suspend: (vmId: string) => invoke<void>("vmware_suspend", { vmId }),
  reset: (vmId: string) => invoke<void>("vmware_reset", { vmId }),
  shutdownGuest: (vmId: string) =>
    invoke<void>("vmware_shutdown_guest", { vmId }),
  rebootGuest: (vmId: string) => invoke<void>("vmware_reboot_guest", { vmId }),
  getGuestIdentity: (vmId: string) =>
    invoke<GuestIdentity>("vmware_get_guest_identity", { vmId }),
  updateCpu: (vmId: string, spec: VmCpuUpdate) =>
    invoke<void>("vmware_update_cpu", { vmId, spec }),
  updateMemory: (vmId: string, spec: VmMemoryUpdate) =>
    invoke<void>("vmware_update_memory", { vmId, spec }),
  cloneVm: (spec: VmCloneSpec) => invoke<string>("vmware_clone_vm", { spec }),
  relocateVm: (vmId: string, spec: VmRelocateSpec) =>
    invoke<void>("vmware_relocate_vm", { vmId, spec }),
  findVmByName: (name: string) =>
    invoke<VmSummary | null>("vmware_find_vm_by_name", { name }),
  getPowerState: (vmId: string) =>
    invoke<VmPowerState>("vmware_get_power_state", { vmId }),

  // Snapshots
  listSnapshots: (vmId: string) =>
    invoke<SnapshotSummary[]>("vmware_list_snapshots", { vmId }),
  createSnapshot: (vmId: string, spec: CreateSnapshotSpec) =>
    invoke<string>("vmware_create_snapshot", { vmId, spec }),
  revertSnapshot: (vmId: string, snapshotId: string) =>
    invoke<void>("vmware_revert_snapshot", { vmId, snapshotId }),
  deleteSnapshot: (vmId: string, snapshotId: string, children?: boolean) =>
    invoke<void>("vmware_delete_snapshot", { vmId, snapshotId, children }),
  deleteAllSnapshots: (vmId: string) =>
    invoke<void>("vmware_delete_all_snapshots", { vmId }),

  // Network
  listNetworks: () => invoke<NetworkSummary[]>("vmware_list_networks"),
  getNetwork: (networkId: string) =>
    invoke<NetworkInfo>("vmware_get_network", { networkId }),

  // Storage
  listDatastores: () => invoke<DatastoreSummary[]>("vmware_list_datastores"),
  getDatastore: (datastoreId: string) =>
    invoke<DatastoreInfo>("vmware_get_datastore", { datastoreId }),

  // Hosts / inventory
  listHosts: () => invoke<HostSummary[]>("vmware_list_hosts"),
  getHost: (hostId: string) => invoke<HostInfo>("vmware_get_host", { hostId }),
  disconnectHost: (hostId: string) =>
    invoke<void>("vmware_disconnect_host", { hostId }),
  reconnectHost: (hostId: string) =>
    invoke<void>("vmware_reconnect_host", { hostId }),
  listClusters: () => invoke<ClusterSummary[]>("vmware_list_clusters"),
  listDatacenters: () => invoke<DatacenterSummary[]>("vmware_list_datacenters"),
  listFolders: () => invoke<FolderSummary[]>("vmware_list_folders"),
  listResourcePools: () =>
    invoke<ResourcePoolSummary[]>("vmware_list_resource_pools"),

  // Metrics
  getVmStats: (vmId: string) =>
    invoke<VmQuickStats>("vmware_get_vm_stats", { vmId }),
  getAllVmStats: () => invoke<VmQuickStats[]>("vmware_get_all_vm_stats"),
  getInventorySummary: () =>
    invoke<InventorySummary>("vmware_get_inventory_summary"),

  // Console (cross-platform WebSocket)
  acquireConsoleTicket: (vmId: string, ticketType?: ConsoleTicketType) =>
    invoke<ConsoleTicket>("vmware_acquire_console_ticket", {
      vmId,
      ticketType,
    }),
  openConsole: (req: OpenConsoleRequest) =>
    invoke<ConsoleSession>("vmware_open_console", { req }),
  closeConsole: (sessionId: string) =>
    invoke<void>("vmware_close_console", { sessionId }),
  closeAllConsoles: () => invoke<number>("vmware_close_all_consoles"),
  listConsoleSessions: () =>
    invoke<ConsoleSession[]>("vmware_list_console_sessions"),
  getConsoleSession: (sessionId: string) =>
    invoke<ConsoleSession>("vmware_get_console_session", { sessionId }),

  // VMRC / Horizon (binary fallback)
  launchVmrc: (config: VmrcConnectionConfig) =>
    invoke<VmrcSession>("vmware_launch_vmrc", { config }),
  listVmrcSessions: () => invoke<VmrcSession[]>("vmware_list_vmrc_sessions"),
  closeVmrcSession: (sessionId: string) =>
    invoke<void>("vmware_close_vmrc_session", { sessionId }),
  closeAllVmrcSessions: () => invoke<number>("vmware_close_all_vmrc_sessions"),
  isVmrcAvailable: () => invoke<boolean>("vmware_is_vmrc_available"),
  isHorizonAvailable: () => invoke<boolean>("vmware_is_horizon_available"),
};

export type VmwareApi = typeof vmwareApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful VMware/vSphere session hook. Owns the connect/disconnect lifecycle
 * plus `isLoading`/`error`, and exposes `useCallback`-wrapped operations over
 * `vmwareApi`. A single active vSphere session is held by the backend service,
 * so this hook mirrors that single-session model.
 */
export function useVmware() {
  const [isConnected, setIsConnected] = useState(false);
  const [config, setConfig] = useState<VsphereConfigSafe | null>(null);
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
    async (args: VmwareConnectArgs): Promise<string> => {
      const sessionId = await run(() =>
        vmwareApi.connect(withGlobalHttpProxyArgs(args)),
      );
      setIsConnected(true);
      try {
        setConfig(await vmwareApi.getConfig());
      } catch {
        // Non-fatal: session is up even if the safe-config echo fails.
      }
      return sessionId;
    },
    [run],
  );

  const disconnect = useCallback(async (): Promise<void> => {
    await run(() => vmwareApi.disconnect());
    setIsConnected(false);
    setConfig(null);
  }, [run]);

  const refreshConnection = useCallback(async (): Promise<boolean> => {
    const connected = await run(() => vmwareApi.isConnected());
    setIsConnected(connected);
    if (connected) {
      try {
        setConfig(await vmwareApi.getConfig());
      } catch {
        /* ignore */
      }
    }
    return connected;
  }, [run]);

  return {
    // state
    isConnected,
    config,
    isLoading,
    error,
    setError,
    // lifecycle
    connect,
    disconnect,
    refreshConnection,
    // full command surface (share the `run` wrapper for consistent error/loading)
    api: vmwareApi,
    run,
  };
}

export type VmwareManager = ReturnType<typeof useVmware>;
