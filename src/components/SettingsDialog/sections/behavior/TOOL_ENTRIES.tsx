import type { LucideIcon } from "lucide-react";
import type { ToolDisplayModes } from "../../../../types/settings/settings";
import { TOOL_DESCRIPTORS } from "../../../app/toolDescriptors";
type ToolEntryKey = keyof ToolDisplayModes;

const TOOL_ENTRY_LABELS = [
  { key: "recordingManager", label: "Recording Manager" },
  { key: "macroManager", label: "Macro Manager" },
  { key: "scriptManager", label: "Script Manager" },
  { key: "performanceMonitor", label: "Performance Monitor" },
  { key: "actionLog", label: "Action Log" },
  { key: "shortcutManager", label: "Shortcut Manager" },
  { key: "bulkSsh", label: "Bulk SSH Commander" },
  { key: "rdpSessions", label: "Session Manager" },
  { key: "proxyChain", label: "Proxy Chain Menu" },
  { key: "wol", label: "Wake-on-LAN" },
  { key: "windowsBackup", label: "Windows Backup" },
] as const satisfies readonly { key: ToolEntryKey; label: string }[];

const TOOL_ENTRIES: { key: ToolEntryKey; label: string; icon: LucideIcon }[] =
  TOOL_ENTRY_LABELS.map(({ key, label }) => ({
    key,
    label,
    icon: TOOL_DESCRIPTORS[key].icon,
  }));

export default TOOL_ENTRIES;
