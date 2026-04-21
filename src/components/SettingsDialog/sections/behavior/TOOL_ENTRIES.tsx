import { ScrollText, Gauge, Keyboard, Network, Server, Radio, TerminalSquare, FileCode, ListVideo, Circle, HardDrive } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolDisplayModes } from "../../../../types/settings/settings";
type ToolEntryKey = keyof ToolDisplayModes;

const TOOL_ENTRIES: { key: ToolEntryKey; label: string; icon: LucideIcon }[] = [
  { key: "recordingManager", label: "Recording Manager", icon: Circle },
  { key: "macroManager", label: "Macro Manager", icon: ListVideo },
  { key: "scriptManager", label: "Script Manager", icon: FileCode },
  { key: "performanceMonitor", label: "Performance Monitor", icon: Gauge },
  { key: "actionLog", label: "Action Log", icon: ScrollText },
  { key: "shortcutManager", label: "Shortcut Manager", icon: Keyboard },
  { key: "bulkSsh", label: "Bulk SSH Commander", icon: TerminalSquare },
  { key: "internalProxy", label: "Internal Proxy Manager", icon: Server },
  { key: "proxyChain", label: "Proxy Chain Menu", icon: Network },
  { key: "wol", label: "Wake-on-LAN", icon: Radio },
  { key: "windowsBackup", label: "Windows Backup", icon: HardDrive },
];

export default TOOL_ENTRIES;
