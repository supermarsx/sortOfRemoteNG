// VMware Workstation — `vms` category slice types (t42-vmwaredesktop-c1).
//
// Request-arg and result shapes for the "VMs & Guest" sub-tab: VM lifecycle,
// hardware, power, snapshots and guest (VMware Tools) operations. camelCase 1:1
// mirror of the individual `#[tauri::command]` params / return structs in
// `src-tauri/crates/sorng-vmware-desktop/src/{commands,types}.rs`.
//
// Shared VM-core structs (VmSummary, VmDetail, VmNic, VmDisk, VmCdrom,
// SharedFolder, SnapshotInfo and the enums) are IMPORTED from the
// `../vmwareDesktop` barrel; only vms-specific shapes live here, and this file
// does NOT re-export through the barrel (keeps the slice disjoint).

import type { SnapshotInfo } from "./index";

// ─── Result structs not present in the barrel ─────────────────────────────────

/** Snapshot tree for a VM (`vmwd_get_snapshot_tree`). Mirrors `SnapshotTree`. */
export interface SnapshotTree {
  vmName: string;
  vmxPath: string;
  currentSnapshot?: string | null;
  snapshots: SnapshotInfo[];
}

/** Result of a guest program / script run (`GuestExecResult`). */
export interface GuestExecResult {
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

/** A process listed inside the guest (`GuestProcess`). */
export interface GuestProcess {
  pid: number;
  name: string;
  owner?: string | null;
  command?: string | null;
  startTime?: string | null;
}

/** A single guest environment variable (`GuestEnvVar`). */
export interface GuestEnvVar {
  name: string;
  value: string;
}

/** VMware Tools status inside the guest (`ToolsStatus`). */
export interface ToolsStatus {
  installed: boolean;
  running: boolean;
  version?: string | null;
  upgradeStatus?: string | null;
}

/** One failure entry of a batch power run (`BatchPowerFailure`). */
export interface BatchPowerFailure {
  vmxPath: string;
  error: string;
}

/** Aggregate result of `vmwd_batch_power` (`BatchPowerResult`). */
export interface BatchPowerResult {
  succeeded: string[];
  failed: BatchPowerFailure[];
}

// ─── Command argument shapes ──────────────────────────────────────────────────
// Each mirrors the individual params of the matching `#[tauri::command]` fn.
// Tauri maps snake_case params to camelCase JS keys, so these are the exact
// invoke argument objects.

export interface CreateVmArgs {
  name: string;
  guestOs: string;
  numCpus?: number | null;
  memoryMb?: number | null;
  diskSizeMb?: number | null;
  diskType?: string | null;
  isoPath?: string | null;
  networkType?: string | null;
  firmware?: string | null;
  targetDir?: string | null;
}

export interface UpdateVmArgs {
  vmxPath: string;
  name?: string | null;
  numCpus?: number | null;
  coresPerSocket?: number | null;
  memoryMb?: number | null;
  annotation?: string | null;
  firmware?: string | null;
  nestedVirt?: boolean | null;
  sideChannelMitigations?: boolean | null;
  uefiSecureBoot?: boolean | null;
  vtpm?: boolean | null;
}

export interface CloneVmArgs {
  sourceVmx: string;
  destName: string;
  /** "full" or "linked". */
  cloneType: string;
  snapshotName?: string | null;
  destDir?: string | null;
}

export interface ConfigureNicArgs {
  vmxPath: string;
  nicIndex: number;
  networkType?: string | null;
  adapterType?: string | null;
  macAddress?: string | null;
  vnet?: string | null;
  connected?: boolean | null;
  startConnected?: boolean | null;
}

export interface ConfigureCdromArgs {
  vmxPath: string;
  cdromIndex: number;
  deviceType: string;
  fileName?: string | null;
  connected?: boolean | null;
}

export interface CreateSnapshotArgs {
  vmxPath: string;
  name: string;
  description?: string | null;
  captureMemory?: boolean;
  quiesceFilesystem?: boolean;
}

/** Auth block shared by every guest-ops command. Note the Rust params are
 *  `guest_user` / `guest_pass` (not `guest_password`). */
export interface GuestAuth {
  vmxPath: string;
  guestUser: string;
  guestPass: string;
}

export interface GuestExecArgs extends GuestAuth {
  program: string;
  /** `Vec<String>` on the Rust side — joined into the command line there. */
  arguments: string[];
  wait?: boolean;
  interactive?: boolean;
}

export interface GuestScriptArgs extends GuestAuth {
  interpreter: string;
  scriptText: string;
}
