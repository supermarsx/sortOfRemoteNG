import { ConnectionSession } from "../../types/connection/connection";
import { ToolDisplayModes } from "../../types/settings/settings";
import { generateId } from "../../utils/core/id";

export type ToolKey = keyof ToolDisplayModes;

export const TOOL_PROTOCOL_PREFIX = "tool:";

export const TOOL_LABELS: Record<ToolKey, string> = {
  performanceMonitor: "Performance Monitor",
  actionLog: "Action Log",
  shortcutManager: "Shortcuts",
  proxyChain: "Proxy Chain",
  internalProxy: "Internal Proxy",
  wol: "Wake-on-LAN",
  bulkSsh: "Bulk SSH",
  serverStats: "Server Stats",
  opkssh: "opkssh",
  mcpServer: "MCP Server",
  scriptManager: "Script Manager",
  macroManager: "Macros",
  recordingManager: "Recording Manager",
  windowsBackup: "Windows Backup",
  diagnostics: "Diagnostics",
  settings: "Settings",
  rdpSessions: "RDP Sessions",
  tagManager: "Tag Manager",
  tabGroupManager: "Tab Groups",
  connectionEditor: "Connection Editor",
};

export const isToolProtocol = (protocol: string): boolean =>
  protocol.startsWith(TOOL_PROTOCOL_PREFIX);

export const getToolKeyFromProtocol = (protocol: string): ToolKey | null => {
  if (!protocol.startsWith(TOOL_PROTOCOL_PREFIX)) {
    return null;
  }

  return protocol.slice(TOOL_PROTOCOL_PREFIX.length) as ToolKey;
};

export const getToolProtocol = (toolKey: ToolKey): string =>
  `${TOOL_PROTOCOL_PREFIX}${toolKey}`;

export const createToolSession = (toolKey: ToolKey, opts?: { connectionId?: string; name?: string }): ConnectionSession => ({
  id: generateId(),
  connectionId: opts?.connectionId ?? `tool-${toolKey}`,
  name: opts?.name ?? TOOL_LABELS[toolKey],
  status: "connected",
  startTime: new Date(),
  protocol: getToolProtocol(toolKey),
  hostname: "",
});
