import { defaultScripts } from "../../../data/defaultScripts";

export type OSTag =
  | "windows"
  | "linux"
  | "macos"
  | "agnostic"
  | "multiplatform"
  | "cisco-ios"
  | "arista-eos"
  | "hpe-comware"
  | "aruba-cx"
  | "android"
  | SpecificOSTag;
type SpecificOSTag =
  | "debian"
  | "ubuntu"
  | "centos"
  | "fedora"
  | "rhel"
  | "rocky-linux"
  | "almalinux"
  | "opensuse"
  | "alpine"
  | "arch-linux"
  | "freebsd"
  | "openbsd"
  | "pfsense"
  | "opnsense"
  | "openwrt"
  | "junos"
  | "routeros"
  | "fortios";

export interface ManagedScript {
  id: string;
  name: string;
  description: string;
  script: string;
  language: ScriptLanguage;
  category: string;
  osTags: OSTag[];
  createdAt: string;
  updatedAt: string;
}

export type ScriptLanguage = "bash" | "sh" | "powershell" | "batch" | "auto";

export const OS_TAG_LABELS: Record<OSTag, string> = {
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  agnostic: "Agnostic",
  multiplatform: "Multi-Platform",
  "cisco-ios": "Cisco IOS",
  "arista-eos": "Arista EOS",
  "hpe-comware": "HPE Comware",
  "aruba-cx": "HPE Aruba CX",
  android: "Android / Termux",
  debian: "Debian",
  ubuntu: "Ubuntu",
  centos: "CentOS / CentOS Stream",
  fedora: "Fedora",
  rhel: "RHEL (Red Hat Enterprise Linux)",
  "rocky-linux": "Rocky Linux",
  almalinux: "AlmaLinux",
  opensuse: "openSUSE",
  alpine: "Alpine Linux",
  "arch-linux": "Arch Linux",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  pfsense: "pfSense",
  opnsense: "OPNsense",
  openwrt: "OpenWrt",
  junos: "Juniper Junos",
  routeros: "MikroTik RouterOS",
  fortios: "Fortinet FortiOS",
};

export const OS_TAG_ICONS: Record<OSTag, string> = {
  windows: "windows",
  linux: "linux",
  macos: "macos",
  agnostic: "globe",
  multiplatform: "workflow",
  "cisco-ios": "cisco",
  "arista-eos": "arista",
  "hpe-comware": "hpe",
  "aruba-cx": "hpe",
  android: "android",
  debian: "debian",
  ubuntu: "ubuntu",
  centos: "centos",
  fedora: "fedora",
  rhel: "redhat",
  "rocky-linux": "rocky-linux",
  almalinux: "almalinux",
  opensuse: "opensuse",
  alpine: "linux",
  "arch-linux": "linux",
  freebsd: "freebsd",
  openbsd: "server",
  pfsense: "pfsense",
  opnsense: "opnsense",
  openwrt: "router",
  junos: "juniper",
  routeros: "mikrotik",
  fortios: "fortinet",
};

export const SCRIPTS_STORAGE_KEY = "managedScripts";

export const getDefaultScripts = (): ManagedScript[] => [...defaultScripts];

export const languageLabels: Record<ScriptLanguage, string> = {
  auto: "Auto Detect",
  bash: "Bash",
  sh: "Shell (sh)",
  powershell: "PowerShell",
  batch: "Batch (cmd)",
};

export const languageIcons: Record<ScriptLanguage, string> = {
  auto: "file-code",
  bash: "bash",
  sh: "sh",
  powershell: "powershell",
  batch: "batch",
};

// ── Sub-components ─────────────────────────────────────────────────
