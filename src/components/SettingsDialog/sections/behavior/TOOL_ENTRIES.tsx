import { ScrollText, Gauge, Keyboard, Network, Server, Radio, TerminalSquare, FileCode, ListVideo, Circle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ToolDisplayModes } from "../../../../types/settings";
type ToolEntryKey = Exclude<keyof ToolDisplayModes, "globalDefault">;

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
];

const defaultToolDisplayModes: ToolDisplayModes = {
  globalDefault: "popup",
  recordingManager: "inherit",
  macroManager: "inherit",
  scriptManager: "inherit",
  performanceMonitor: "inherit",
  actionLog: "inherit",
  shortcutManager: "inherit",
  bulkSsh: "inherit",
  internalProxy: "inherit",
  proxyChain: "inherit",
  wol: "inherit",
};

export default TOOL_ENTRIES;
