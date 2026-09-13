import { ConnectionSession } from "../../types/connection/connection";
import { ToolDisplayModes } from "../../types/settings/settings";
import { generateId } from "../../utils/core/id";

export type ToolKey = keyof ToolDisplayModes;

export const TOOL_PROTOCOL_PREFIX = "tool:";

// Session-scoped tools are not global tools or configurable display modes.
export const RDP_INTERNALS_PROTOCOL = "tool:rdpInternals";
export const RDP_INTERNALS_WINDOW_MESSAGE =
  "RDP Internals stays in the desktop viewer's window. Open it from the RDP desktop after moving that session.";
export const RECORDING_PLAYER_PROTOCOL = "tool:recordingPlayer";
export const TRUST_CENTER_PROTOCOL = "tool:trustCenter";
export const CREDENTIAL_VAULT_PROTOCOL = "tool:credentialVault";
export const CREDENTIAL_VAULT_WINDOW_MESSAGE =
  "Database Credential Vault stays in the main window to protect private drafts. Open it from the main application toolbar or Settings → Security.";
export const HARDWARE_KEYS_PROTOCOL = "tool:hardwareKeys";
export type SecurityTool = "credentialVault" | "hardwareKeys";

/** Tool windows carry no secrets. A vault stays bound to its original database. */
export const createSecurityToolSession = (
  tool: SecurityTool,
  source?: ConnectionSession,
  databaseId?: string,
): ConnectionSession => ({
  id: `${tool}-${generateId()}`,
  connectionId: `tool-${tool}`,
  name:
    tool === "credentialVault" ? "Database Credential Vault" : "Hardware Keys",
  status: "connected",
  startTime: new Date(),
  protocol: `tool:${tool}`,
  hostname: "",
  tabGroupId: source?.tabGroupId,
  ...(tool === "credentialVault" && databaseId
    ? { ownerDatabaseId: databaseId }
    : {}),
  ...(source?.layout?.isDetached ? { layout: { ...source.layout } } : {}),
});
export const ICON_EXPLORER_PROTOCOL = "tool:iconExplorer";
export const CONNECTION_RECYCLE_BIN_PROTOCOL = "tool:connectionRecycleBin";

/** One database-owned explorer; opening it never selects or unlocks a database. */
export const createConnectionRecycleBinSession = (
  databaseId: string,
  databaseName: string,
): ConnectionSession => ({
  id: `connection-recycle-bin-${encodeURIComponent(databaseId)}`,
  connectionId: "tool-connection-recycle-bin",
  name: `Recycle Bin — ${databaseName}`,
  status: "connected",
  startTime: new Date(),
  protocol: CONNECTION_RECYCLE_BIN_PROTOCOL,
  hostname: "",
  connectionRecycleBin: { databaseId },
});

export const createIconExplorerSession = (
  source?: ConnectionSession,
): ConnectionSession => ({
  id: `icon-explorer-${source?.layout?.isDetached ? (source.layout.windowId ?? source.id) : "main"}`,
  connectionId: "tool-icon-explorer",
  name: "Icon Explorer",
  status: "connected",
  startTime: new Date(),
  protocol: ICON_EXPLORER_PROTOCOL,
  hostname: "",
  tabGroupId: source?.tabGroupId,
  ...(source?.layout?.isDetached ? { layout: { ...source.layout } } : {}),
});

export const createTrustCenterSession = (
  source?: ConnectionSession,
): ConnectionSession => ({
  id: `trust-center-${source?.layout?.isDetached ? (source.layout.windowId ?? source.id) : "main"}`,
  connectionId: "tool-trust-center",
  name: "Trust Center",
  status: "connected",
  startTime: new Date(),
  protocol: TRUST_CENTER_PROTOCOL,
  hostname: "",
  tabGroupId: source?.tabGroupId,
  ...(source?.layout?.isDetached ? { layout: { ...source.layout } } : {}),
});

export const createRdpInternalsSession = (
  source: ConnectionSession,
  section: "diagnostics" | "settings" = "diagnostics",
): ConnectionSession => ({
  id: `rdp-internals-${source.id}`,
  connectionId: `rdp-internals-${source.id}`,
  name: `RDP Internals — ${source.name}`,
  status: "connected",
  startTime: new Date(),
  protocol: RDP_INTERNALS_PROTOCOL,
  hostname: "",
  tabGroupId: source.tabGroupId,
  ...(source.layout?.isDetached ? { layout: { ...source.layout } } : {}),
  rdpInternals: { sessionId: source.id, section },
});

export const createRecordingPlayerSession = (
  recordingId: string,
  recordingName: string,
): ConnectionSession => ({
  id: `recording-player-${recordingId}`,
  connectionId: `recording-player-${recordingId}`,
  name: `Recording — ${recordingName}`,
  status: "connected",
  startTime: new Date(),
  protocol: RECORDING_PLAYER_PROTOCOL,
  hostname: "",
  recordingPlayer: { recordingId },
});

export const TOOL_LABELS: Record<ToolKey, string> = {
  performanceMonitor: "Performance Monitor",
  actionLog: "Action Log",
  importExport: "Import / Export",
  shortcutManager: "Shortcuts",
  proxyChain: "Proxy & VPN",
  internalProxy: "Session Manager",
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
  rdpSessions: "Session Manager",
  tagManager: "Tag Manager",
  tabGroupManager: "Tab Groups",
  connectionEditor: "Connection Editor",
  proxyProfileEditor: "Proxy Profile",
  proxyChainEditor: "Proxy Chain",
  sshTunnelEditor: "SSH Tunnel",
  shortcutCreator: "New Shortcut",
  vpnEditor: "VPN Connection",
  tunnelChainEditor: "Tunnel Chain Editor",
  tunnelProfileEditor: "Tunnel Profile",
  bulkEditor: "Bulk Editor",
  database: "Databases",
};

export const isToolProtocol = (protocol: string): boolean =>
  protocol.startsWith(TOOL_PROTOCOL_PREFIX);

export const getToolKeyFromProtocol = (protocol: string): ToolKey | null => {
  if (!protocol.startsWith(TOOL_PROTOCOL_PREFIX)) {
    return null;
  }

  const key = protocol.slice(TOOL_PROTOCOL_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(TOOL_LABELS, key)
    ? (key as ToolKey)
    : null;
};

export const getToolProtocol = (toolKey: ToolKey): string =>
  `${TOOL_PROTOCOL_PREFIX}${toolKey}`;

export const createToolSession = (
  toolKey: ToolKey,
  opts?: { connectionId?: string; name?: string; initialParentId?: string },
): ConnectionSession => ({
  id: generateId(),
  connectionId: opts?.connectionId ?? `tool-${toolKey}`,
  name: opts?.name ?? TOOL_LABELS[toolKey],
  status: "connected",
  startTime: new Date(),
  protocol: getToolProtocol(toolKey),
  hostname: "",
  ...(toolKey === "connectionEditor" &&
  !opts?.connectionId &&
  opts?.initialParentId
    ? { connectionEditorInitialParentId: opts.initialParentId }
    : {}),
});
