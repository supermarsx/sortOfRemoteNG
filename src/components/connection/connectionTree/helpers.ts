import type { LucideIcon } from "lucide-react";
import type { Connection } from "../../../types/connection/connection";
import { findDescriptor } from "../../../types/integrations/registry";
import {
  CONNECTION_ICON_REGISTRY,
  getConnectionIconDefinition,
  type ConnectionIconKey,
} from "../../../utils/icons/connectionIconCatalog";
import {
  GENERIC_CONNECTION_ICON_KEY,
  getConnectionIntegrationKey,
  getProtocolDefaultIconKey,
  resolveEffectiveConnectionIcon,
} from "../../../utils/icons/resolveConnectionIcon";

export const getProtocolIcon = (protocol: string): LucideIcon => {
  const key =
    getProtocolDefaultIconKey(protocol) ?? GENERIC_CONNECTION_ICON_KEY;
  return getConnectionIconDefinition(key)!.icon;
};

/** Backward-compatible component registry, now backed by the full catalog. */
export const iconRegistry: Readonly<Record<ConnectionIconKey, LucideIcon>> =
  CONNECTION_ICON_REGISTRY;

export const getConnectionIconResolution = (connection: Connection) => {
  const integrationKey = getConnectionIntegrationKey(connection);
  const descriptor = integrationKey
    ? findDescriptor(integrationKey)
    : undefined;
  return resolveEffectiveConnectionIcon(connection, descriptor);
};

export const getConnectionIcon = (connection: Connection): LucideIcon =>
  getConnectionIconResolution(connection).icon;

export const getStatusColor = (status?: string) => {
  switch (status) {
    case "connected":
      return "text-success";
    case "connecting":
      return "text-warning";
    case "error":
      return "text-error";
    default:
      return "text-[var(--color-textSecondary)]";
  }
};

/* ── ConnectionTreeItem ────────────────────────────────────────── */

export interface ConnectionTreeItemProps {
  connection: Connection;
  level: number;
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onCopyHostname: (connection: Connection) => void;
  onRename: (connection: Connection) => void;
  onExport: (connection: Connection) => void;
  onConnectWithOptions: (connection: Connection) => void;
  onConnectWithoutCredentials: (connection: Connection) => void;
  onExecuteScripts: (connection: Connection, sessionId?: string) => void;
  onDiagnostics?: (connection: Connection) => void;
  onDetachSession?: (sessionId: string) => void;
  onDuplicate: (
    connection: Connection,
    options?: { includeCredentials?: boolean },
  ) => void | Promise<Connection | undefined>;
  onCheckConnection?: (connection: Connection) => void;
  onWindowsTool?: (connection: Connection, tool: string) => void;
  onConnectAll?: (folder: Connection) => void;
  onConnectAllRecursive?: (folder: Connection) => void;
  enableReorder: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dropPosition: "before" | "after" | "inside" | null;
  onDragStart: (connectionId: string) => void;
  onDragOver: (
    connectionId: string,
    position: "before" | "after" | "inside",
  ) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (
    connectionId: string,
    position: "before" | "after" | "inside",
  ) => void;
  singleClickConnect?: boolean;
  singleClickDisconnect?: boolean;
  doubleClickRename?: boolean;
  /**
   * When true, clicking anywhere on a folder row toggles expand
   * (not just the chevron). Matches the natural file-browser
   * gesture. Defaults to true via SettingsManager defaults.
   */
  folderSingleClickToggle?: boolean;
  /**
   * When true, double-clicking a folder row toggles expand/collapse.
   * This is especially useful when folderSingleClickToggle is off.
   */
  folderDoubleClickToggle?: boolean;
}
