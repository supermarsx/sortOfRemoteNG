// useVmwDesktopVms — real Tauri `invoke(...)` wrappers for the "VMs & Guest"
// slice of the sorng-vmware-desktop crate (t42-vmwaredesktop-c1).
//
// Binds ALL 44 `vmwd_*` commands of the VMs & Guest category (VM lifecycle /
// hardware 11, Power 8, Snapshots 6, Guest ops 19). Argument names match the
// Rust `#[tauri::command]` params exactly (camelCase per Tauri's snake_case↔
// camelCase mapping) so no custom serializer is needed. The connection slice
// (`useVmwDesktopConnection`) and the `host` slice ship their own APIs; this
// file owns only the vms/guest surface.

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  PowerAction,
  SnapshotInfo,
  VmDetail,
  VmPowerState,
  VmSummary,
} from "../../../types/vmwareDesktop";
import type {
  BatchPowerResult,
  CloneVmArgs,
  ConfigureCdromArgs,
  ConfigureNicArgs,
  CreateSnapshotArgs,
  CreateVmArgs,
  GuestEnvVar,
  GuestExecArgs,
  GuestExecResult,
  GuestProcess,
  GuestScriptArgs,
  SnapshotTree,
  ToolsStatus,
  UpdateVmArgs,
} from "../../../types/vmwareDesktop/vms";

// ─── Low-level invoke wrappers (one per #[tauri::command]) ──────────────────────

export const vmwDesktopVmsApi = {
  // ── VM lifecycle / hardware (11) ────────────────────────────────────────────
  listVms: () => invoke<VmSummary[]>("vmwd_list_vms"),
  getVm: (vmxPath: string) => invoke<VmDetail>("vmwd_get_vm", { vmxPath }),
  createVm: (args: CreateVmArgs) =>
    invoke<VmDetail>("vmwd_create_vm", {
      name: args.name,
      guestOs: args.guestOs,
      numCpus: args.numCpus ?? null,
      memoryMb: args.memoryMb ?? null,
      diskSizeMb: args.diskSizeMb ?? null,
      diskType: args.diskType ?? null,
      isoPath: args.isoPath ?? null,
      networkType: args.networkType ?? null,
      firmware: args.firmware ?? null,
      targetDir: args.targetDir ?? null,
    }),
  updateVm: (args: UpdateVmArgs) =>
    invoke<void>("vmwd_update_vm", {
      vmxPath: args.vmxPath,
      name: args.name ?? null,
      numCpus: args.numCpus ?? null,
      coresPerSocket: args.coresPerSocket ?? null,
      memoryMb: args.memoryMb ?? null,
      annotation: args.annotation ?? null,
      firmware: args.firmware ?? null,
      nestedVirt: args.nestedVirt ?? null,
      sideChannelMitigations: args.sideChannelMitigations ?? null,
      uefiSecureBoot: args.uefiSecureBoot ?? null,
      vtpm: args.vtpm ?? null,
    }),
  deleteVm: (vmxPath: string) => invoke<void>("vmwd_delete_vm", { vmxPath }),
  cloneVm: (args: CloneVmArgs) =>
    invoke<VmDetail>("vmwd_clone_vm", {
      sourceVmx: args.sourceVmx,
      destName: args.destName,
      cloneType: args.cloneType,
      snapshotName: args.snapshotName ?? null,
      destDir: args.destDir ?? null,
    }),
  registerVm: (vmxPath: string) =>
    invoke<string>("vmwd_register_vm", { vmxPath }),
  unregisterVm: (id: string) => invoke<void>("vmwd_unregister_vm", { id }),
  configureNic: (args: ConfigureNicArgs) =>
    invoke<void>("vmwd_configure_nic", {
      vmxPath: args.vmxPath,
      nicIndex: args.nicIndex,
      networkType: args.networkType ?? null,
      adapterType: args.adapterType ?? null,
      macAddress: args.macAddress ?? null,
      vnet: args.vnet ?? null,
      connected: args.connected ?? null,
      startConnected: args.startConnected ?? null,
    }),
  removeNic: (vmxPath: string, nicIndex: number) =>
    invoke<void>("vmwd_remove_nic", { vmxPath, nicIndex }),
  configureCdrom: (args: ConfigureCdromArgs) =>
    invoke<void>("vmwd_configure_cdrom", {
      vmxPath: args.vmxPath,
      cdromIndex: args.cdromIndex,
      deviceType: args.deviceType,
      fileName: args.fileName ?? null,
      connected: args.connected ?? null,
    }),

  // ── Power (8) ───────────────────────────────────────────────────────────────
  startVm: (vmxPath: string, gui?: boolean) =>
    invoke<void>("vmwd_start_vm", { vmxPath, gui: gui ?? null }),
  stopVm: (vmxPath: string, hard?: boolean) =>
    invoke<void>("vmwd_stop_vm", { vmxPath, hard: hard ?? null }),
  resetVm: (vmxPath: string, hard?: boolean) =>
    invoke<void>("vmwd_reset_vm", { vmxPath, hard: hard ?? null }),
  suspendVm: (vmxPath: string, hard?: boolean) =>
    invoke<void>("vmwd_suspend_vm", { vmxPath, hard: hard ?? null }),
  pauseVm: (vmxPath: string) => invoke<void>("vmwd_pause_vm", { vmxPath }),
  unpauseVm: (vmxPath: string) => invoke<void>("vmwd_unpause_vm", { vmxPath }),
  getPowerState: (vmxPath: string) =>
    invoke<VmPowerState>("vmwd_get_power_state", { vmxPath }),
  batchPower: (vmxPaths: string[], action: PowerAction) =>
    invoke<BatchPowerResult>("vmwd_batch_power", { vmxPaths, action }),

  // ── Snapshots (6) ─────────────────────────────────────────────────────────
  listSnapshots: (vmxPath: string) =>
    invoke<SnapshotInfo[]>("vmwd_list_snapshots", { vmxPath }),
  getSnapshotTree: (vmxPath: string) =>
    invoke<SnapshotTree>("vmwd_get_snapshot_tree", { vmxPath }),
  createSnapshot: (args: CreateSnapshotArgs) =>
    invoke<void>("vmwd_create_snapshot", {
      vmxPath: args.vmxPath,
      name: args.name,
      description: args.description ?? null,
      captureMemory: args.captureMemory ?? null,
      quiesceFilesystem: args.quiesceFilesystem ?? null,
    }),
  deleteSnapshot: (vmxPath: string, name: string, deleteChildren?: boolean) =>
    invoke<void>("vmwd_delete_snapshot", {
      vmxPath,
      name,
      deleteChildren: deleteChildren ?? null,
    }),
  revertToSnapshot: (vmxPath: string, name: string) =>
    invoke<void>("vmwd_revert_to_snapshot", { vmxPath, name }),
  getSnapshot: (vmxPath: string, name: string) =>
    invoke<SnapshotInfo>("vmwd_get_snapshot", { vmxPath, name }),

  // ── Guest operations / VMware Tools (19) ────────────────────────────────────
  execInGuest: (args: GuestExecArgs) =>
    invoke<GuestExecResult>("vmwd_exec_in_guest", {
      vmxPath: args.vmxPath,
      guestUser: args.guestUser,
      guestPass: args.guestPass,
      program: args.program,
      arguments: args.arguments,
      wait: args.wait ?? null,
      interactive: args.interactive ?? null,
    }),
  runScriptInGuest: (args: GuestScriptArgs) =>
    invoke<GuestExecResult>("vmwd_run_script_in_guest", {
      vmxPath: args.vmxPath,
      guestUser: args.guestUser,
      guestPass: args.guestPass,
      interpreter: args.interpreter,
      scriptText: args.scriptText,
    }),
  copyToGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    hostPath: string,
    guestPath: string,
  ) =>
    invoke<void>("vmwd_copy_to_guest", {
      vmxPath,
      guestUser,
      guestPass,
      hostPath,
      guestPath,
    }),
  copyFromGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    guestPath: string,
    hostPath: string,
  ) =>
    invoke<void>("vmwd_copy_from_guest", {
      vmxPath,
      guestUser,
      guestPass,
      guestPath,
      hostPath,
    }),
  createDirectoryInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    dirPath: string,
  ) =>
    invoke<void>("vmwd_create_directory_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      dirPath,
    }),
  deleteDirectoryInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    dirPath: string,
  ) =>
    invoke<void>("vmwd_delete_directory_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      dirPath,
    }),
  deleteFileInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    filePath: string,
  ) =>
    invoke<void>("vmwd_delete_file_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      filePath,
    }),
  fileExistsInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    filePath: string,
  ) =>
    invoke<boolean>("vmwd_file_exists_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      filePath,
    }),
  directoryExistsInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    dirPath: string,
  ) =>
    invoke<boolean>("vmwd_directory_exists_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      dirPath,
    }),
  renameFileInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    oldPath: string,
    newPath: string,
  ) =>
    invoke<void>("vmwd_rename_file_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      oldPath,
      newPath,
    }),
  listDirectoryInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    dirPath: string,
  ) =>
    invoke<string[]>("vmwd_list_directory_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      dirPath,
    }),
  listProcessesInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
  ) =>
    invoke<GuestProcess[]>("vmwd_list_processes_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
    }),
  killProcessInGuest: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    pid: number,
  ) =>
    invoke<void>("vmwd_kill_process_in_guest", {
      vmxPath,
      guestUser,
      guestPass,
      pid,
    }),
  readVariable: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    varType: string,
    name: string,
  ) =>
    invoke<string>("vmwd_read_variable", {
      vmxPath,
      guestUser,
      guestPass,
      varType,
      name,
    }),
  writeVariable: (
    vmxPath: string,
    guestUser: string,
    guestPass: string,
    varType: string,
    name: string,
    value: string,
  ) =>
    invoke<void>("vmwd_write_variable", {
      vmxPath,
      guestUser,
      guestPass,
      varType,
      name,
      value,
    }),
  listEnvVars: (vmxPath: string, guestUser: string, guestPass: string) =>
    invoke<GuestEnvVar[]>("vmwd_list_env_vars", {
      vmxPath,
      guestUser,
      guestPass,
    }),
  getToolsStatus: (vmxPath: string) =>
    invoke<ToolsStatus>("vmwd_get_tools_status", { vmxPath }),
  installTools: (vmxPath: string) =>
    invoke<void>("vmwd_install_tools", { vmxPath }),
  getIpAddress: (vmxPath: string) =>
    invoke<string>("vmwd_get_ip_address", { vmxPath }),
};

export type VmwDesktopVmsApi = typeof vmwDesktopVmsApi;

// ─── React hook ─────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : (e as Error).message;
}

/**
 * Stateful hook for the VMs & Guest slice. Owns shared `isLoading` / `error`
 * and a `run` wrapper that funnels every command through consistent loading /
 * error handling (mirrors `useVmware`). The full command surface is exposed via
 * `api`; the sub-tab drives its own per-section result state.
 */
export function useVmwDesktopVms() {
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

  return {
    isLoading,
    error,
    setError,
    run,
    api: vmwDesktopVmsApi,
  };
}

export type VmwDesktopVmsManager = ReturnType<typeof useVmwDesktopVms>;
