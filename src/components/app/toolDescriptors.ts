import {
  Activity,
  ArrowUpDown,
  BarChart3,
  Cpu,
  Database,
  Disc,
  FileCode,
  HardDrive,
  Keyboard,
  Layers,
  ListVideo,
  Network,
  Pencil,
  Power,
  Route,
  ScrollText,
  Server,
  Settings,
  Shield,
  Tag,
  Terminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { TOOL_LABELS, type ToolKey } from "./toolSession";

export interface ToolDescriptor<Key extends ToolKey = ToolKey> {
  key: Key;
  label: string;
  icon: LucideIcon;
  /** Database tools must never mount against an absent or different owner. */
  access: "app" | "database";
}

const defineTool = <Key extends ToolKey>(
  key: Key,
  icon: LucideIcon,
  access: ToolDescriptor["access"] = "database",
): ToolDescriptor<Key> => ({ key, label: TOOL_LABELS[key], icon, access });

/**
 * Canonical visual identity for every tool session.
 *
 * Launch controls and the resulting tab both consume this exhaustive record,
 * so adding a new `ToolKey` cannot silently fall back to an unrelated wrench.
 */
export const TOOL_DESCRIPTORS = Object.freeze({
  performanceMonitor: defineTool("performanceMonitor", BarChart3, "app"),
  actionLog: defineTool("actionLog", ScrollText),
  importExport: defineTool("importExport", ArrowUpDown),
  shortcutManager: defineTool("shortcutManager", Keyboard),
  proxyChain: defineTool("proxyChain", Network),
  internalProxy: defineTool("internalProxy", Server),
  wol: defineTool("wol", Power),
  bulkSsh: defineTool("bulkSsh", Terminal),
  serverStats: defineTool("serverStats", Server),
  opkssh: defineTool("opkssh", Shield),
  mcpServer: defineTool("mcpServer", Server),
  scriptManager: defineTool("scriptManager", FileCode, "app"),
  macroManager: defineTool("macroManager", ListVideo, "app"),
  recordingManager: defineTool("recordingManager", Disc, "app"),
  windowsBackup: defineTool("windowsBackup", HardDrive, "app"),
  diagnostics: defineTool("diagnostics", Activity),
  settings: defineTool("settings", Settings, "app"),
  rdpSessions: defineTool("rdpSessions", Cpu),
  tagManager: defineTool("tagManager", Tag),
  tabGroupManager: defineTool("tabGroupManager", Layers),
  connectionEditor: defineTool("connectionEditor", Pencil),
  proxyProfileEditor: defineTool("proxyProfileEditor", Network),
  proxyChainEditor: defineTool("proxyChainEditor", Waypoints),
  sshTunnelEditor: defineTool("sshTunnelEditor", Route),
  shortcutCreator: defineTool("shortcutCreator", Keyboard),
  vpnEditor: defineTool("vpnEditor", Shield),
  tunnelChainEditor: defineTool("tunnelChainEditor", Waypoints),
  tunnelProfileEditor: defineTool("tunnelProfileEditor", Route),
  bulkEditor: defineTool("bulkEditor", Pencil),
  database: defineTool("database", Database, "app"),
} satisfies { [Key in ToolKey]: ToolDescriptor<Key> });

export const getToolDescriptor = (key: ToolKey): ToolDescriptor =>
  TOOL_DESCRIPTORS[key];

export const getToolIcon = (key: ToolKey): LucideIcon =>
  TOOL_DESCRIPTORS[key].icon;
