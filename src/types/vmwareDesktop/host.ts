// VMware Workstation — "host" category types (t42-vmwaredesktop-c2).
//
// Host-level plumbing: virtual networking (vmnet), host↔guest shared folder
// mutations, VMDK / standalone disk storage, OVF/OVA import-export, raw VMX
// editing, and application preferences. camelCase 1:1 mirror of the matching
// structs in `src-tauri/crates/sorng-vmware-desktop/src/types.rs`
// (serde `rename_all = "camelCase"`). Shared structs (`VmDisk`, `SharedFolder`)
// are imported from the barrel; this file holds only the request/result types
// specific to the host slice.

import type { SharedFolder, VmDisk } from "./index";

export type { SharedFolder, VmDisk };

// ─── Shared folders (mutations) ───────────────────────────────────────────────

/** Request to add / modify a shared folder (`SharedFolderRequest` in types.rs).
 *  `vmwd_add_shared_folder` takes the individual `name`/`hostPath`/`writable`
 *  args rather than this object; kept for form modelling / typing. */
export interface SharedFolderRequest {
  vmxPath: string;
  name: string;
  hostPath: string;
  writable?: boolean | null;
  enabled?: boolean | null;
}

// ─── Virtual networking (vmnet) ───────────────────────────────────────────────

/** A virtual network (vmnet adapter). */
export interface VirtualNetwork {
  name: string;
  networkType: string;
  subnet?: string | null;
  subnetMask?: string | null;
  dhcpEnabled?: boolean | null;
  natEnabled?: boolean | null;
  hostOnlyAdapter?: string | null;
  mtu?: number | null;
}

/** NAT port-forwarding rule. */
export interface NatPortForward {
  network: string;
  protocol: string;
  hostPort: number;
  guestIp: string;
  guestPort: number;
  description?: string | null;
}

/** DHCP reservation (static MAC→IP mapping). */
export interface DhcpReservation {
  network: string;
  macAddress: string;
  ipAddress: string;
}

/** MAC-to-IP mapping (active DHCP lease). */
export interface DhcpLease {
  macAddress: string;
  ipAddress: string;
  hostname?: string | null;
  expires?: string | null;
}

/** Request to create / update a virtual network. */
export interface CreateNetworkRequest {
  name: string;
  networkType: string;
  subnet?: string | null;
  subnetMask?: string | null;
  dhcpEnabled?: boolean | null;
  natEnabled?: boolean | null;
}

/** Request to add a NAT port-forward. */
export interface AddPortForwardRequest {
  network: string;
  protocol: string;
  hostPort: number;
  guestIp: string;
  guestPort: number;
  description?: string | null;
}

// ─── VMDK / disks ─────────────────────────────────────────────────────────────

/** Individual VMDK extent (one backing file). */
export interface VmdkExtent {
  access: string;
  sizeSectors: number;
  extentType: string;
  fileName: string;
}

/** VMDK disk metadata. */
export interface VmdkInfo {
  path: string;
  capacityMb: number;
  diskType: string;
  adapterType: string;
  parentVmdk?: string | null;
  extents: VmdkExtent[];
  sizeOnDiskMb?: number | null;
}

/** Request to create a standalone VMDK. */
export interface CreateVmdkRequest {
  path: string;
  sizeMb: number;
  /** "monolithicSparse" | "monolithicFlat" | "twoGbMaxExtentSparse" | "twoGbMaxExtentFlat" */
  diskType?: string | null;
  adapterType?: string | null;
}

/** Request to add a virtual disk to a VM (`AddDiskRequest` in types.rs). */
export interface AddDiskRequest {
  vmxPath: string;
  sizeMb: number;
  diskType?: string | null;
  /** "scsi" | "sata" | "nvme" | "ide" */
  controllerType?: string | null;
  fileName?: string | null;
}

// ─── OVF / OVA ────────────────────────────────────────────────────────────────

/** OVF/OVA import options. */
export interface OvfImportRequest {
  /** Path to the .ovf or .ova file. */
  sourcePath: string;
  /** Target directory for the new VM. */
  targetDir?: string | null;
  /** Override the VM name. */
  name?: string | null;
  /** Accept license agreements automatically. */
  acceptEula: boolean;
}

/** OVF/OVA export options. */
export interface OvfExportRequest {
  vmxPath: string;
  targetPath: string;
  /** "ovf" | "ova" */
  format?: string | null;
  includeIsos: boolean;
}

// ─── VMX file ─────────────────────────────────────────────────────────────────

/** Parsed VMX key-value pair. */
export interface VmxEntry {
  key: string;
  value: string;
}

/** A full parsed VMX file. */
export interface VmxFile {
  path: string;
  entries: VmxEntry[];
  settings: Record<string, string>;
}

// ─── Preferences / application-level ──────────────────────────────────────────

/** VMware Workstation / Player application preferences. */
export interface VmwPreferences {
  defaultVmPath?: string | null;
  autoConnectUsb?: boolean | null;
  hotKeyCombo?: string | null;
  showTrayIcon?: boolean | null;
  updatesCheck?: boolean | null;
  ceipEnabled?: boolean | null;
  sharedVmsPath?: string | null;
  wsPort?: number | null;
  /** Raw key-value pairs from the preferences file. */
  raw: Record<string, string>;
}
