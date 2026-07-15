// VMware Workstation / Player (vmware-desktop) integration — shared types barrel.
//
// camelCase 1:1 mirror of `src-tauri/crates/sorng-vmware-desktop/src/types.rs`
// (serde `rename_all = "camelCase"`; snake_case enums are string-literal unions
// matching their serde tags). This barrel holds the CONFIG, CONNECTION, and the
// core VM structs shared by both command-category slices, plus the panel↔sub-tab
// contract. Category execs (`vms`, `host`) import shared types from here and keep
// their category-specific request/result types in `./vms.ts` / `./host.ts`.

import type { ComponentType } from "react";

// ─── Product & Host ──────────────────────────────────────────────────────────

/** Which VMware desktop product is installed. serde snake_case. */
export type VmwProduct =
  | "player"
  | "workstation"
  | "workstation_pro"
  | "fusion"
  | "fusion_pro"
  | "unknown";

/** Whether vmrest / vmrun was detected, and product version. */
export interface VmwHostInfo {
  product: VmwProduct;
  productVersion?: string | null;
  vmrunPath?: string | null;
  vmrestAvailable: boolean;
  vmrestPort?: number | null;
  os: string;
  defaultVmDir?: string | null;
  networkTypes: string[];
}

/** Connection/config for reaching the vmrest endpoint (or local CLI). */
export interface VmwDesktopConfig {
  /** Path to vmrun binary (auto-detected if omitted). */
  vmrunPath?: string | null;
  /** If using vmrest: host (default 127.0.0.1). */
  vmrestHost?: string | null;
  /** vmrest port (default 8697). */
  vmrestPort?: number | null;
  /** vmrest basic-auth username. */
  vmrestUsername?: string | null;
  /** vmrest basic-auth password (secret — persisted via the OS vault, not config JSON). */
  vmrestPassword?: string | null;
  /** Skip TLS certificate verification for the vmrest HTTPS endpoint. */
  vmrestSkipTlsVerify: boolean;
  /** Whether to also launch vmrest if it is not already running. */
  autoStartVmrest: boolean;
  /** Timeout for CLI commands (seconds). */
  timeoutSecs: number;
  /** Optional HTTP proxy URL used for vmrest API calls. */
  proxyUrl?: string | null;
}

/** Summary returned after a successful connection / detection. */
export interface VmwConnectionSummary {
  product: VmwProduct;
  productVersion?: string | null;
  vmrunAvailable: boolean;
  vmrestAvailable: boolean;
  vmCount: number;
}

// ─── VM core (shared across slices) ───────────────────────────────────────────

/** Power state of a VM. serde snake_case. */
export type VmPowerState =
  | "powered_on"
  | "powered_off"
  | "suspended"
  | "paused"
  | "unknown";

/** Guest OS family. serde snake_case. */
export type GuestOsFamily =
  | "windows"
  | "linux"
  | "mac_os"
  | "free_bsd"
  | "solaris"
  | "other";

/** Power action for batch operations. serde snake_case. */
export type PowerAction =
  | "start"
  | "stop"
  | "suspend"
  | "reset"
  | "pause"
  | "unpause"
  | "shutdown"
  | "reboot";

/** Compact VM listing entry. */
export interface VmSummary {
  /** VM identifier (vmrest uses an opaque ID, vmrun uses vmx path). */
  id: string;
  vmxPath: string;
  name: string;
  powerState: VmPowerState;
  guestOs?: string | null;
  guestOsFamily: GuestOsFamily;
  numCpus?: number | null;
  memoryMb?: number | null;
}

/** Network adapter attached to a VM. */
export interface VmNic {
  index: number;
  adapterType: string;
  networkType: string;
  macAddress?: string | null;
  connected: boolean;
  startConnected: boolean;
  vnet?: string | null;
}

/** Virtual disk attached to a VM. */
export interface VmDisk {
  index: number;
  fileName: string;
  capacityMb?: number | null;
  diskType: string;
  controllerType: string;
  controllerBus: number;
  unitNumber: number;
}

/** CD/DVD device. */
export interface VmCdrom {
  index: number;
  deviceType: string;
  fileName?: string | null;
  connected: boolean;
  startConnected: boolean;
}

/** Display / 3D acceleration settings. */
export interface VmDisplay {
  displayName?: string | null;
  useAutoDetect: boolean;
  accel3d: boolean;
  vramSizeKb?: number | null;
  numDisplays?: number | null;
}

/** Shared folder between host and guest. */
export interface SharedFolder {
  name: string;
  hostPath: string;
  writable: boolean;
  enabled: boolean;
}

/** Snapshot metadata. */
export interface SnapshotInfo {
  name: string;
  displayName?: string | null;
  description?: string | null;
  createdAt?: string | null;
  parent?: string | null;
  isCurrent: boolean;
  children: string[];
  hasMemory?: boolean | null;
  size?: number | null;
}

/** Full VM detail including hardware, settings, snapshots, etc. */
export interface VmDetail {
  id: string;
  vmxPath: string;
  name: string;
  powerState: VmPowerState;
  guestOs?: string | null;
  guestOsFamily: GuestOsFamily;
  annotation?: string | null;
  hardwareVersion?: number | null;
  numCpus?: number | null;
  coresPerSocket?: number | null;
  memoryMb?: number | null;
  firmware?: string | null;
  biosType?: string | null;
  uefiSecureBoot?: boolean | null;
  vtpmPresent?: boolean | null;
  encryptionEnabled?: boolean | null;
  toolsStatus?: string | null;
  toolsVersion?: string | null;
  ipAddress?: string | null;
  macAddresses: string[];
  nics: VmNic[];
  disks: VmDisk[];
  cdroms: VmCdrom[];
  usbControllers: string[];
  soundCard?: string | null;
  display?: VmDisplay | null;
  sharedFolders: SharedFolder[];
  snapshots: SnapshotInfo[];
  autoStart?: boolean | null;
  vmxSettings: Record<string, string>;
}

// ─── Panel ↔ sub-tab contract ─────────────────────────────────────────────────

/** Props every VMware Workstation sub-tab receives from the panel shell. Category
 *  execs' tab components consume this; the shell owns connection lifecycle and
 *  passes the live status down. Each tab imports its own `<x>Api` slice/hook. */
export interface VmwDesktopTabProps {
  /** Whether the vmrest/CLI connection is currently live. */
  connected: boolean;
  /** Latest connection summary, or null before a successful connect. */
  summary: VmwConnectionSummary | null;
}

/** One entry in the per-crate sub-tab registry (`components/.../registry.ts`).
 *  The shell renders a tab bar from these and lazily imports the active tab —
 *  the same disjoint-append trick as the top-level integrations registry, one
 *  level down (plan §4b). */
export interface VmwDesktopTabDescriptor {
  /** Stable key for the category slice, e.g. `"vms"`. */
  categoryKey: string;
  /** i18n key for the tab label. */
  labelKey: string;
  /** English fallback for the tab label. */
  labelDefault: string;
  /** Lazy import of the sub-tab module (default export). */
  importTab: () => Promise<{ default: ComponentType<VmwDesktopTabProps> }>;
}
