/* eslint-disable react-refresh/only-export-components */
import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";
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
const ShortcutCreator = dynamic(
  () => import("./ShortcutManagerDialog").then((module) => module.ShortcutCreator),
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
  () => import("../SettingsDialog/index").then((m) => m.SettingsTabContent),
  { ssr: false },
);
const RDPSessionPanelTab = dynamic(
  () => import("../rdp/RDPSessionPanel").then((m) => m.RDPSessionPanel),
  { ssr: false },
);
const TagManagerDialog = dynamic(
  () => import("../connection/TagManagerDialog").then((m) => m.TagManagerDialog),
  { ssr: false },
);
const TabGroupManager = dynamic(
  () => import("../session/TabGroupManager").then((m) => m.TabGroupManager),
  { ssr: false },
);
const ConnectionEditor = dynamic(
  () => import("../connection/ConnectionEditor").then((m) => m.ConnectionEditor),
  { ssr: false },
);
const ProxyProfileEditor = dynamic(
  () => import("../network/ProxyProfileEditor").then((m) => m.ProxyProfileEditor),
  { ssr: false },
);
const SSHTunnelDialog = dynamic(
  () => import("../ssh/SSHTunnelDialog").then((m) => m.SSHTunnelDialog),
  { ssr: false },
);
const ProxyChainEditor = dynamic(
  () => import("../network/ProxyChainEditor").then((m) => m.ProxyChainEditor),
  { ssr: false },
);
const VpnEditor = dynamic(
  () => import("../network/VpnEditor"),
  { ssr: false },
);
const TunnelChainEditorPanel = dynamic(
  () => import("../network/proxyChainMenu/TunnelChainEditorPanel"),
  { ssr: false },
);
const TunnelProfileEditorPanel = dynamic(
  () => import("../network/proxyChainMenu/TunnelProfileEditorPanel"),
  { ssr: false },
);

interface ToolTabViewerProps {
  session: ConnectionSession;
  onClose: () => void;
  /** RDP panel extras — provided by SessionViewer from App-level hooks */
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onReconnect?: (connection: import("../../types/connection/connection").Connection) => void;
}

/**
 * Renders the appropriate tool component inside a session tab.
 * Used by SessionViewer when the session protocol starts with "tool:".
 */
export const ToolTabViewer: React.FC<ToolTabViewerProps> = ({ session, onClose, onReattachSession, onDetachToWindow, onReconnect }) => {
  const { state } = useConnections();
  const { settings } = useSettings();
  const toolKey = getToolKeyFromProtocol(session.protocol);

  const activeRdpBackendIds = useMemo(
    () => state.sessions
      .filter((s) => s.protocol === 'rdp')
      .map((s) => s.backendSessionId || s.connectionId)
      .filter(Boolean) as string[],
    [state.sessions],
  );

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
      {toolKey === 'tagManager' && <TagManagerDialog isOpen onClose={onClose} />}
      {toolKey === 'tabGroupManager' && <TabGroupManager isOpen onClose={onClose} />}
      {toolKey === 'connectionEditor' && (
        <FeatureErrorBoundary
          boundaryKey={session.connectionId}
          title="Connection Editor crashed"
          message="The connection editor hit a render error. You can retry without restarting the app."
        >
          <ConnectionEditor
            connection={state.connections.find(c => c.id === session.connectionId)}
            isOpen
            onClose={onClose}
          />
        </FeatureErrorBoundary>
      )}
      {toolKey === 'rdpSessions' && (
        <RDPSessionPanelTab
          isVisible
          connections={state.connections}
          activeBackendSessionIds={activeRdpBackendIds}
          onClose={onClose}
          onReattachSession={onReattachSession}
          onDetachToWindow={onDetachToWindow}
          onReconnect={onReconnect}
          thumbnailsEnabled={settings.rdpSessionThumbnailsEnabled}
          thumbnailPolicy={settings.rdpSessionThumbnailPolicy}
          thumbnailInterval={settings.rdpSessionThumbnailInterval}
        />
      )}
      {toolKey === 'shortcutCreator' && <ShortcutCreator isOpen onClose={onClose} />}
      {toolKey === 'proxyProfileEditor' && <ProxyProfileEditor isOpen onClose={onClose} onSave={() => onClose()} />}
      {toolKey === 'proxyChainEditor' && <ProxyChainEditor isOpen onClose={onClose} onSave={() => onClose()} editingChain={null} />}
      {toolKey === 'sshTunnelEditor' && <SSHTunnelDialog isOpen onClose={onClose} onSave={() => onClose()} sshConnections={state.connections.filter(c => c.protocol === 'ssh')} />}
      {toolKey === 'vpnEditor' && <VpnEditor isOpen onClose={onClose} onSave={() => onClose()} />}
      {toolKey === 'tunnelChainEditor' && (
        <TunnelChainEditorPanel
          isOpen
          onClose={onClose}
          onSave={() => onClose()}
          editingChainId={session.connectionId?.startsWith('tool-') ? undefined : session.connectionId}
        />
      )}
      {toolKey === 'tunnelProfileEditor' && (
        <TunnelProfileEditorPanel
          isOpen
          onClose={onClose}
          onSave={() => onClose()}
          editingProfileId={session.connectionId?.startsWith('tool-') ? undefined : session.connectionId}
        />
      )}
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
