/* eslint-disable react-refresh/only-export-components */
import React from "react";
import dynamic from "next/dynamic";
import { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import {
  getToolKeyFromProtocol,
  ToolKey,
} from "./toolSession";

const PerformanceMonitor = dynamic(
  () =>
    import("../monitoring/PerformanceMonitor").then(
      (module) => module.PerformanceMonitor,
    ),
  { ssr: false },
);
const ActionLogViewer = dynamic(
  () =>
    import("../monitoring/ActionLogViewer").then(
      (module) => module.ActionLogViewer,
    ),
  { ssr: false },
);
const ShortcutManagerDialog = dynamic(
  () => import("./ShortcutManagerDialog").then((module) => module.ShortcutManagerDialog),
  { ssr: false },
);
const ProxyChainMenu = dynamic(
  () => import("../network/ProxyChainMenu"),
  { ssr: false },
);
const InternalProxyManager = dynamic(
  () =>
    import("../network/InternalProxyManager").then(
      (module) => module.InternalProxyManager,
    ),
  { ssr: false },
);
const WOLQuickTool = dynamic(
  () =>
    import("../network/WOLQuickTool").then((module) => module.WOLQuickTool),
  { ssr: false },
);
const BulkSSHCommander = dynamic(
  () => import("../ssh/BulkSSHCommander").then((module) => module.BulkSSHCommander),
  { ssr: false },
);
const ServerStatsPanel = dynamic(
  () => import("../ssh/ServerStatsPanel").then((module) => module.ServerStatsPanel),
  { ssr: false },
);
const OpksshPanel = dynamic(
  () => import("../ssh/OpksshPanel").then((module) => module.OpksshPanel),
  { ssr: false },
);
const McpServerPanel = dynamic(
  () => import("../ssh/McpServerPanel").then((module) => module.McpServerPanel),
  { ssr: false },
);
const ScriptManager = dynamic(
  () => import("../recording/ScriptManager").then((module) => module.ScriptManager),
  { ssr: false },
);
const MacroManager = dynamic(
  () => import("../recording/MacroManager"),
  { ssr: false },
);
const RecordingManager = dynamic(
  () => import("../recording/RecordingManager"),
  { ssr: false },
);
const WindowsBackupPanel = dynamic(
  () => import("../sync/WindowsBackupPanel"),
  { ssr: false },
);
const ConnectionDiagnostics = dynamic(
  () => import("../connection/ConnectionDiagnostics").then((m) => m.ConnectionDiagnostics),
  { ssr: false },
);
const SettingsTabContent = dynamic(
  () => import("../SettingsDialog").then((m) => m.SettingsTabContent),
  { ssr: false },
);

interface ToolTabViewerProps {
  session: ConnectionSession;
  onClose: () => void;
}

/**
 * Renders the appropriate tool component inside a session tab.
 * Used by SessionViewer when the session protocol starts with "tool:".
 */
export const ToolTabViewer: React.FC<ToolTabViewerProps> = ({ session, onClose }) => {
  const { state } = useConnections();
  const toolKey = getToolKeyFromProtocol(session.protocol);
  if (!toolKey) return null;

  // Tools render as modal dialogs (fixed inset-0 + backdrop). Inside a tab,
  // the .tool-tab-embedded class strips the backdrop, makes the outer wrapper
  // fill the tab, and forces the inner dialog to fill it too.
  return (
    <div className="tool-tab-embedded h-full relative overflow-hidden">
      {toolKey === 'performanceMonitor' && <PerformanceMonitor isOpen onClose={onClose} />}
      {toolKey === 'actionLog' && <ActionLogViewer isOpen onClose={onClose} />}
      {toolKey === 'shortcutManager' && <ShortcutManagerDialog isOpen onClose={onClose} />}
      {toolKey === 'proxyChain' && <ProxyChainMenu isOpen onClose={onClose} />}
      {toolKey === 'internalProxy' && <InternalProxyManager isOpen onClose={onClose} />}
      {toolKey === 'wol' && <WOLQuickTool isOpen onClose={onClose} />}
      {toolKey === 'bulkSsh' && <BulkSSHCommander isOpen onClose={onClose} />}
      {toolKey === 'serverStats' && <ServerStatsPanel isOpen onClose={onClose} />}
      {toolKey === 'opkssh' && <OpksshPanel isOpen onClose={onClose} />}
      {toolKey === 'mcpServer' && <McpServerPanel isOpen onClose={onClose} />}
      {toolKey === 'scriptManager' && <ScriptManager isOpen onClose={onClose} />}
      {toolKey === 'macroManager' && <MacroManager isOpen onClose={onClose} />}
      {toolKey === 'recordingManager' && <RecordingManager isOpen onClose={onClose} />}
      {toolKey === 'windowsBackup' && <WindowsBackupPanel isOpen onClose={onClose} />}
      {toolKey === 'diagnostics' && (() => {
        const conn = state.connections.find(c => c.id === session.connectionId);
        return conn ? <ConnectionDiagnostics connection={conn} onClose={onClose} /> : null;
      })()}
      {toolKey === 'settings' && <SettingsTabContent onClose={onClose} />}
    </div>
  );
};

export {
  getToolKeyFromProtocol,
  TOOL_LABELS,
  TOOL_PROTOCOL_PREFIX,
  createToolSession,
  getToolProtocol,
  isToolProtocol,
} from "./toolSession";
export type { ToolKey } from "./toolSession";
