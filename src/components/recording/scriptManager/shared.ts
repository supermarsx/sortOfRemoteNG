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
  | "android";

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
