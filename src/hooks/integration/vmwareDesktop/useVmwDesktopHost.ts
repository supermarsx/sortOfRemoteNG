// useVmwDesktopHost — "host" category slice for the VMware Workstation
// integration (t42-vmwaredesktop-c2).
//
// Wraps the 35 host-level `vmwd_*` commands (commands.rs sections: Shared
// Folders, Networking, VMDK, OVF, VMX, Preferences). Argument names match the
// Rust `#[tauri::command]` signatures exactly so Tauri's snake_case→camelCase
// mapping works without a serializer. `vmwDesktopHostApi` is the low-level
// invoke layer; `useVmwDesktopHost()` adds cached state + a `busy`/`error`
// wrapper for the tab component.

import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SharedFolder, VmDisk } from "../../../types/vmwareDesktop";
import type {
  DhcpLease,
  VirtualNetwork,
  NatPortForward,
  VmdkInfo,
  VmxFile,
  VmwPreferences,
} from "../../../types/vmwareDesktop/host";

// ─── Low-level invoke wrappers ────────────────────────────────────────────────

export const vmwDesktopHostApi = {
  // Shared folders (6)
  enableSharedFolders: (vmxPath: string) =>
    invoke<void>("vmwd_enable_shared_folders", { vmxPath }),
  disableSharedFolders: (vmxPath: string) =>
    invoke<void>("vmwd_disable_shared_folders", { vmxPath }),
  listSharedFolders: (vmxPath: string) =>
    invoke<SharedFolder[]>("vmwd_list_shared_folders", { vmxPath }),
  addSharedFolder: (
    vmxPath: string,
    name: string,
    hostPath: string,
    writable?: boolean,
  ) =>
    invoke<void>("vmwd_add_shared_folder", {
      vmxPath,
      name,
      hostPath,
      writable: writable ?? null,
    }),
  removeSharedFolder: (vmxPath: string, name: string) =>
    invoke<void>("vmwd_remove_shared_folder", { vmxPath, name }),
  setSharedFolderState: (
    vmxPath: string,
    name: string,
    hostPath: string,
    writable: boolean,
  ) =>
    invoke<void>("vmwd_set_shared_folder_state", {
      vmxPath,
      name,
      hostPath,
      writable,
    }),

  // Virtual networking (10)
  listNetworks: () => invoke<VirtualNetwork[]>("vmwd_list_networks"),
  getNetwork: (name: string) =>
    invoke<VirtualNetwork>("vmwd_get_network", { name }),
  createNetwork: (
    name: string,
    networkType: string,
    subnet?: string | null,
    mask?: string | null,
  ) =>
    invoke<VirtualNetwork>("vmwd_create_network", {
      name,
      networkType,
      subnet: subnet ?? null,
      mask: mask ?? null,
    }),
  updateNetwork: (
    name: string,
    networkType: string,
    subnet?: string | null,
    mask?: string | null,
  ) =>
    invoke<VirtualNetwork>("vmwd_update_network", {
      name,
      networkType,
      subnet: subnet ?? null,
      mask: mask ?? null,
    }),
  deleteNetwork: (name: string) =>
    invoke<void>("vmwd_delete_network", { name }),
  listPortForwards: (network: string) =>
    invoke<NatPortForward[]>("vmwd_list_port_forwards", { network }),
  setPortForward: (
    network: string,
    protocol: string,
    hostPort: number,
    guestIp: string,
    guestPort: number,
    description?: string | null,
  ) =>
    invoke<void>("vmwd_set_port_forward", {
      network,
      protocol,
      hostPort,
      guestIp,
      guestPort,
      description: description ?? null,
    }),
  deletePortForward: (network: string, protocol: string, hostPort: number) =>
    invoke<void>("vmwd_delete_port_forward", { network, protocol, hostPort }),
  getDhcpLeases: (network: string) =>
    invoke<DhcpLease[]>("vmwd_get_dhcp_leases", { network }),
  readNetworkingConfig: () =>
    invoke<Record<string, string>>("vmwd_read_networking_config"),

  // VMDK / disks (10)
  createVmdk: (
    path: string,
    sizeMb: number,
    diskType?: string | null,
    adapterType?: string | null,
  ) =>
    invoke<VmdkInfo>("vmwd_create_vmdk", {
      path,
      sizeMb,
      diskType: diskType ?? null,
      adapterType: adapterType ?? null,
    }),
  getVmdkInfo: (path: string) =>
    invoke<VmdkInfo>("vmwd_get_vmdk_info", { path }),
  defragmentVmdk: (path: string) =>
    invoke<void>("vmwd_defragment_vmdk", { path }),
  shrinkVmdk: (path: string) => invoke<void>("vmwd_shrink_vmdk", { path }),
  expandVmdk: (path: string, newSizeMb: number) =>
    invoke<void>("vmwd_expand_vmdk", { path, newSizeMb }),
  convertVmdk: (source: string, diskType: string, dest?: string | null) =>
    invoke<void>("vmwd_convert_vmdk", {
      source,
      diskType,
      dest: dest ?? null,
    }),
  renameVmdk: (source: string, dest: string) =>
    invoke<void>("vmwd_rename_vmdk", { source, dest }),
  addDiskToVm: (
    vmxPath: string,
    vmdkPath: string,
    controllerType?: string | null,
    busNumber?: number | null,
    unitNumber?: number | null,
    mode?: string | null,
  ) =>
    invoke<void>("vmwd_add_disk_to_vm", {
      vmxPath,
      vmdkPath,
      controllerType: controllerType ?? null,
      busNumber: busNumber ?? null,
      unitNumber: unitNumber ?? null,
      mode: mode ?? null,
    }),
  removeDiskFromVm: (
    vmxPath: string,
    controllerType: string,
    bus: number,
    unit: number,
  ) =>
    invoke<void>("vmwd_remove_disk_from_vm", {
      vmxPath,
      controllerType,
      bus,
      unit,
    }),
  listVmDisks: (vmxPath: string) =>
    invoke<VmDisk[]>("vmwd_list_vm_disks", { vmxPath }),

  // OVF / OVA (2)
  importOvf: (sourcePath: string, destDir: string, name?: string | null) =>
    invoke<string>("vmwd_import_ovf", {
      sourcePath,
      destDir,
      name: name ?? null,
    }),
  exportOvf: (vmxPath: string, destPath: string, format?: string | null) =>
    invoke<void>("vmwd_export_ovf", {
      vmxPath,
      destPath,
      format: format ?? null,
    }),

  // VMX file (4)
  parseVmx: (vmxPath: string) => invoke<VmxFile>("vmwd_parse_vmx", { vmxPath }),
  updateVmxKeys: (vmxPath: string, updates: Record<string, string>) =>
    invoke<void>("vmwd_update_vmx_keys", { vmxPath, updates }),
  removeVmxKeys: (vmxPath: string, keys: string[]) =>
    invoke<void>("vmwd_remove_vmx_keys", { vmxPath, keys }),
  discoverVmxFiles: (dir: string) =>
    invoke<string[]>("vmwd_discover_vmx_files", { dir }),

  // Preferences (3)
  readPreferences: () => invoke<VmwPreferences>("vmwd_read_preferences"),
  getDefaultVmDir: () => invoke<string>("vmwd_get_default_vm_dir"),
  setPreference: (key: string, value: string) =>
    invoke<void>("vmwd_set_preference", { key, value }),
};

export type VmwDesktopHostApi = typeof vmwDesktopHostApi;

// ─── Stateful hook ────────────────────────────────────────────────────────────

/**
 * Host-category hook for the VMware Workstation panel. Holds the loaded
 * virtual-network list + preferences and exposes a `run` helper that funnels
 * every mutating call through a shared `busy`/`error` state so the tab can show
 * a spinner and surface failures uniformly. All raw wrappers remain reachable
 * via `api` for one-off reads (VMDK info, DHCP leases, VMX parsing, etc.).
 */
export function useVmwDesktopHost() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networks, setNetworks] = useState<VirtualNetwork[]>([]);
  const [preferences, setPreferences] = useState<VmwPreferences | null>(null);

  /** Run an async API call with shared busy/error handling. Returns the result,
   *  or `undefined` if it threw (error captured in `error`). */
  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(typeof e === "string" ? e : (e as Error).message);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const refreshNetworks = useCallback(async () => {
    const list = await run(() => vmwDesktopHostApi.listNetworks());
    if (list) setNetworks(list);
    return list;
  }, [run]);

  const refreshPreferences = useCallback(async () => {
    const prefs = await run(() => vmwDesktopHostApi.readPreferences());
    if (prefs) setPreferences(prefs);
    return prefs;
  }, [run]);

  return {
    api: vmwDesktopHostApi,
    busy,
    error,
    setError,
    networks,
    preferences,
    run,
    refreshNetworks,
    refreshPreferences,
  };
}

export type VmwDesktopHostManager = ReturnType<typeof useVmwDesktopHost>;
