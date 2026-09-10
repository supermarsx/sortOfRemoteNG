/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, { useEffect, useMemo } from "react";
import { LockKeyhole } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import { ConnectionSession } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";
import { proxyCollectionManager } from "../../utils/connection/proxyCollectionManager";
import {
  getToolKeyFromProtocol,
  ToolKey,
  RDP_INTERNALS_PROTOCOL,
  RECORDING_PLAYER_PROTOCOL,
  TRUST_CENTER_PROTOCOL,
  ICON_EXPLORER_PROTOCOL,
  CONNECTION_RECYCLE_BIN_PROTOCOL,
  createToolSession,
} from "./toolSession";
import { useTrustCenterSession } from "../../hooks/security/useTrustCenterSession";
import type { SettingsTabId } from "../SettingsDialog/settingsConstants";
import { getToolDescriptor } from "./toolDescriptors";
import EmptyState from "../ui/display/EmptyState";
import { DOCUMENTS_PROTOCOL } from "../../hooks/documents/useDocumentSession";

const DocumentsWorkspace = dynamic(
  () => import("../documents/DocumentsWorkspace"),
  { ssr: false },
);

const PerformanceMonitor = dynamic(
  () =>
    import("../monitoring/PerformanceMonitor").then(
      (module) => module.PerformanceMonitor,
    ),
  { ssr: false },
);
const TrustCenterTab = dynamic(() => import("../security/TrustCenterTab"), {
  ssr: false,
});
const IconExplorerTab = dynamic(() => import("../icons/IconExplorerTab"), {
  ssr: false,
});
const ConnectionRecycleBinTab = dynamic(
  () => import("../connection/ConnectionRecycleBinTab"),
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
  () =>
    import("./ShortcutManagerDialog").then(
      (module) => module.ShortcutManagerDialog,
    ),
  { ssr: false },
);
const ShortcutCreator = dynamic(
  () =>
    import("./ShortcutManagerDialog").then((module) => module.ShortcutCreator),
  { ssr: false },
);
const ProxyChainMenu = dynamic(() => import("../network/ProxyChainMenu"), {
  ssr: false,
});
const SessionManager = dynamic(
  () =>
    import("../session/sessionManager/SessionManager").then(
      (module) => module.SessionManager,
    ),
  { ssr: false },
);
const WOLQuickTool = dynamic(
  () => import("../network/WOLQuickTool").then((module) => module.WOLQuickTool),
  { ssr: false },
);
const BulkSSHCommander = dynamic(
  () =>
    import("../ssh/BulkSSHCommander").then((module) => module.BulkSSHCommander),
  { ssr: false },
);
const ServerStatsPanel = dynamic(
  () =>
    import("../ssh/ServerStatsPanel").then((module) => module.ServerStatsPanel),
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
  () =>
    import("../recording/ScriptManager").then((module) => module.ScriptManager),
  { ssr: false },
);
const MacroManager = dynamic(() => import("../recording/MacroManager"), {
  ssr: false,
});
const RecordingManager = dynamic(
  () => import("../recording/RecordingManager"),
  { ssr: false },
);
const WindowsBackupPanel = dynamic(() => import("../sync/WindowsBackupPanel"), {
  ssr: false,
});
const ConnectionDiagnostics = dynamic(
  () =>
    import("../connection/ConnectionDiagnostics").then(
      (m) => m.ConnectionDiagnostics,
    ),
  { ssr: false },
);
const SettingsTabContent = dynamic(
  () => import("../SettingsDialog/index").then((m) => m.SettingsTabContent),
  { ssr: false },
);
const ImportExport = dynamic(
  () => import("../ImportExport").then((m) => m.ImportExport),
  { ssr: false },
);
const TagManagerDialog = dynamic(
  () =>
    import("../connection/TagManagerDialog").then((m) => m.TagManagerDialog),
  { ssr: false },
);
const TabGroupManager = dynamic(
  () => import("../session/TabGroupManager").then((m) => m.TabGroupManager),
  { ssr: false },
);
const ConnectionEditor = dynamic(
  () =>
    import("../connection/ConnectionEditor").then((m) => m.ConnectionEditor),
  { ssr: false },
);
const ProxyProfileEditor = dynamic(
  () =>
    import("../network/ProxyProfileEditor").then((m) => m.ProxyProfileEditor),
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
const VpnEditor = dynamic(() => import("../network/VpnEditor"), { ssr: false });
const TunnelChainEditorPanel = dynamic(
  () => import("../network/proxyChainMenu/TunnelChainEditorPanel"),
  { ssr: false },
);
const TunnelProfileEditorPanel = dynamic(
  () => import("../network/proxyChainMenu/TunnelProfileEditorPanel"),
  { ssr: false },
);
const BulkConnectionEditor = dynamic(
  () =>
    import("../connection/BulkConnectionEditor").then(
      (m) => m.BulkConnectionEditor,
    ),
  { ssr: false },
);
const DatabasePanel = dynamic(
  () => import("../database/DatabasePanel").then((m) => m.DatabasePanel),
  { ssr: false },
);

const RDPInternalsTab = dynamic(
  () =>
    import("../rdp/RDPInternalsTab").then((module) => module.RDPInternalsTab),
  { ssr: false },
);
const RecordingPlayerTab = dynamic(
  () =>
    import("../recording/RecordingPlayerTab").then(
      (module) => module.RecordingPlayerTab,
    ),
  { ssr: false },
);

interface ToolTabViewerProps {
  session: ConnectionSession;
  onClose: () => void;
  onActivateSession?: (sessionId: string) => void;
  onCloseManagedSession?: (sessionId: string) => void;
  /** RDP panel extras — provided by SessionViewer from App-level hooks */
  onReattachSession?: (sessionId: string, connectionId?: string) => void;
  onDetachToWindow?: (sessionId: string) => void;
  onReconnect?: (
    connection: import("../../types/connection/connection").Connection,
  ) => void;
  onEditConnection?: (
    connection: import("../../types/connection/connection").Connection,
  ) => void;
  /** Open the requested database (id, optional password). */
  onDatabaseSelect?: (
    databaseId: string,
    password?: string,
  ) => Promise<void> | void;
  /** Close the currently-open database (and lock its cached password). */
  onDatabaseClose?: () => Promise<void> | void;
  onBeforeCurrentLock?: () => Promise<void>;
  onOpenSettings?: (tab?: SettingsTabId) => void;
  /** Settings tab to deep-link to when this is the `tool:settings` tab. */
  settingsInitialTab?: SettingsTabId;
  /** Bump to re-apply an unchanged `settingsInitialTab`. */
  settingsInitialTabNonce?: number;
}

/**
 * Renders the appropriate tool component inside a session tab.
 * Used by SessionViewer when the session protocol starts with "tool:".
 */
export const ToolTabViewer: React.FC<ToolTabViewerProps> = ({
  session,
  onClose,
  onActivateSession,
  onCloseManagedSession,
  onReattachSession,
  onDetachToWindow,
  onReconnect,
  onEditConnection,
  onDatabaseSelect,
  onDatabaseClose,
  onBeforeCurrentLock,
  onOpenSettings,
  settingsInitialTab,
  settingsInitialTabNonce,
}) => {
  const { t } = useTranslation();
  const { state, dispatch, databaseAvailability } = useConnections();
  const { settings } = useSettings();
  const { isActive } = useSessionRenderActivity();
  const toolKey = getToolKeyFromProtocol(session.protocol);
  const openTrustCenter = useTrustCenterSession(onActivateSession, session);
  const databaseDependent =
    (toolKey !== null && getToolDescriptor(toolKey).access === "database") ||
    session.protocol === TRUST_CENTER_PROTOCOL ||
    session.protocol === DOCUMENTS_PROTOCOL ||
    session.protocol === CONNECTION_RECYCLE_BIN_PROTOCOL;
  const explicitOwner =
    session.protocol === DOCUMENTS_PROTOCOL
      ? session.documentsWorkspace?.databaseId
      : session.protocol === CONNECTION_RECYCLE_BIN_PROTOCOL
        ? session.connectionRecycleBin?.databaseId
        : session.ownerDatabaseId;
  // A tool opened before any database exists may bind exactly once. Existing
  // owner metadata wins. Wait for the provider's guarded acknowledgement before
  // mounting private content; a viewer remount must not forget its first owner.
  useEffect(() => {
    if (
      !databaseDependent ||
      explicitOwner ||
      databaseAvailability?.status !== "ready" ||
      !databaseAvailability.databaseId
    )
      return;
    dispatch?.({
      type: "BIND_TOOL_DATABASE_OWNER",
      payload: {
        sessionId: session.id,
        databaseId: databaseAvailability.databaseId,
        generation: databaseAvailability.generation,
      },
    });
  }, [
    databaseDependent,
    session.id,
    explicitOwner,
    dispatch,
    databaseAvailability?.status,
    databaseAvailability?.databaseId,
    databaseAvailability?.generation,
  ]);
  const ownerDatabaseId = explicitOwner;
  const databaseReady =
    databaseAvailability?.status === "ready" &&
    !!ownerDatabaseId &&
    databaseAvailability.databaseId === ownerDatabaseId;
  const databaseMountKey = databaseDependent
    ? `${ownerDatabaseId}:${databaseAvailability?.generation}`
    : undefined;

  const activeRdpBackendIds = useMemo(
    () =>
      state.sessions
        .filter((s) => s.protocol === "rdp" && !s.layout?.isDetached)
        .map((s) => s.backendSessionId || s.connectionId)
        .filter(Boolean) as string[],
    [state.sessions],
  );

  if (databaseDependent && !databaseReady) {
    const status = databaseAvailability?.status;
    const differentOwner =
      ownerDatabaseId &&
      databaseAvailability?.databaseId &&
      ownerDatabaseId !== databaseAvailability.databaseId;
    const message = differentOwner
      ? "A different database is open"
      : status === "suspended"
        ? "Database locked"
        : status === "loading"
          ? "Loading database"
          : status === "error"
            ? "Database unavailable"
            : "Open a database to use this tool";
    return (
      <div
        data-testid="tool-database-gate"
        role="status"
        className="flex h-full min-h-0 items-center justify-center overflow-auto p-6"
      >
        <EmptyState
          icon={LockKeyhole}
          message={message}
          hint={
            session.layout?.isDetached && !onDatabaseSelect
              ? "Return or reattach this tool to the main window, then open or unlock its owning database there. This detached window cannot open databases."
              : differentOwner
                ? "This tab belongs to its original database. Reopen that database to continue; this tool will not use another database's connections."
                : status === "loading"
                  ? "The tool will become available when its database is ready."
                  : "Open or unlock the database from Databases. This tab will become available when access is restored."
          }
          className="max-w-md text-center"
        >
          {onActivateSession && onDatabaseSelect ? (
            <button
              type="button"
              className="sor-btn sor-btn-secondary mt-4"
              onClick={() => {
                const windowId = session.layout?.isDetached
                  ? session.layout.windowId
                  : undefined;
                const existing = state.sessions.find(
                  (candidate) =>
                    candidate.protocol === "tool:database" &&
                    !!candidate.layout?.isDetached ===
                      !!session.layout?.isDetached &&
                    candidate.layout?.windowId === windowId,
                );
                if (existing) {
                  onActivateSession(existing.id);
                  return;
                }
                const candidate = {
                  ...createToolSession("database"),
                  tabGroupId: session.tabGroupId,
                  ...(session.layout?.isDetached
                    ? { layout: { ...session.layout } }
                    : {}),
                };
                dispatch({ type: "ADD_SESSION", payload: candidate });
                onActivateSession(candidate.id);
              }}
            >
              Open Databases
            </button>
          ) : onOpenSettings && onDatabaseSelect ? (
            <button
              type="button"
              className="sor-btn sor-btn-secondary mt-4"
              onClick={() => onOpenSettings("security")}
            >
              Open security settings
            </button>
          ) : null}
        </EmptyState>
      </div>
    );
  }

  if (session.protocol === RDP_INTERNALS_PROTOCOL) {
    return <RDPInternalsTab session={session} onClose={onClose} />;
  }
  if (session.protocol === ICON_EXPLORER_PROTOCOL) {
    return (
      <FeatureErrorBoundary title="Icon Explorer could not be displayed">
        <IconExplorerTab />
      </FeatureErrorBoundary>
    );
  }
  if (session.protocol === CONNECTION_RECYCLE_BIN_PROTOCOL) {
    return (
      <FeatureErrorBoundary title="The recycle bin could not be displayed">
        <ConnectionRecycleBinTab
          key={databaseMountKey}
          databaseId={session.connectionRecycleBin?.databaseId ?? ""}
        />
      </FeatureErrorBoundary>
    );
  }
  if (session.protocol === DOCUMENTS_PROTOCOL && session.documentsWorkspace) {
    return (
      <FeatureErrorBoundary title="The document workspace could not be displayed">
        <DocumentsWorkspace
          key={databaseMountKey}
          sessionId={session.id}
          request={session.documentsWorkspace}
          onOpenConnection={onReconnect}
          onOpenSecurity={
            onOpenSettings ? () => onOpenSettings("security") : undefined
          }
        />
      </FeatureErrorBoundary>
    );
  }
  if (session.protocol === TRUST_CENTER_PROTOCOL)
    return (
      <TrustCenterTab
        key={databaseMountKey}
        onClose={onClose}
        showClose={false}
        onOpenTrustSettings={
          onOpenSettings ? () => onOpenSettings("trust") : undefined
        }
      />
    );
  if (
    session.protocol === RECORDING_PLAYER_PROTOCOL &&
    session.recordingPlayer
  ) {
    return (
      <RecordingPlayerTab recordingId={session.recordingPlayer.recordingId} />
    );
  }
  if (!toolKey) return null;

  // Tools render as modal dialogs (fixed inset-0 + backdrop). Inside a tab,
  // the .tool-tab-embedded class strips the backdrop, makes the outer wrapper
  // fill the tab, and forces the inner dialog to fill it too.
  return (
    <div
      key={databaseMountKey}
      className="tool-tab-embedded relative h-full min-h-0 min-w-0 max-w-full overflow-hidden"
    >
      {toolKey === "performanceMonitor" && (
        <PerformanceMonitor isOpen onClose={onClose} />
      )}
      {toolKey === "actionLog" && <ActionLogViewer isOpen onClose={onClose} />}
      {toolKey === "shortcutManager" && (
        <ShortcutManagerDialog isOpen onClose={onClose} />
      )}
      {toolKey === "proxyChain" && <ProxyChainMenu isOpen onClose={onClose} />}
      {toolKey === "internalProxy" && (
        <SessionManager
          isVisible={isActive}
          connections={state.connections}
          activeBackendSessionIds={activeRdpBackendIds}
          onClose={onClose}
          onReattachSession={onReattachSession}
          onDetachToWindow={onDetachToWindow}
          onReconnect={onReconnect}
          onCloseSession={onCloseManagedSession}
          thumbnailsEnabled={settings.rdpSessionThumbnailsEnabled}
          thumbnailPolicy={settings.rdpSessionThumbnailPolicy}
          thumbnailInterval={settings.rdpSessionThumbnailInterval}
        />
      )}
      {toolKey === "wol" && <WOLQuickTool isOpen onClose={onClose} />}
      {toolKey === "bulkSsh" && <BulkSSHCommander isOpen onClose={onClose} />}
      {toolKey === "serverStats" && (
        <ServerStatsPanel isOpen onClose={onClose} />
      )}
      {toolKey === "opkssh" && <OpksshPanel isOpen onClose={onClose} />}
      {toolKey === "mcpServer" && <McpServerPanel isOpen onClose={onClose} />}
      {toolKey === "scriptManager" && (
        <ScriptManager isOpen onClose={onClose} />
      )}
      {toolKey === "macroManager" && <MacroManager isOpen onClose={onClose} />}
      {toolKey === "recordingManager" && (
        <RecordingManager
          isOpen
          onClose={onClose}
          onActivateSession={onActivateSession}
        />
      )}
      {toolKey === "windowsBackup" && (
        <WindowsBackupPanel isOpen onClose={onClose} />
      )}
      {toolKey === "diagnostics" &&
        (() => {
          const conn = state.connections.find(
            (c) => c.id === session.connectionId,
          );
          return conn ? (
            <ConnectionDiagnostics connection={conn} onClose={onClose} />
          ) : null;
        })()}
      {toolKey === "settings" && (
        <SettingsTabContent
          onOpenTrustCenter={onActivateSession ? openTrustCenter : undefined}
          onDatabaseSelect={onDatabaseSelect}
          onDatabaseClose={onDatabaseClose}
          onBeforeCurrentLock={onBeforeCurrentLock}
          onClose={onClose}
          initialTab={settingsInitialTab}
          initialTabNonce={settingsInitialTabNonce}
        />
      )}
      {toolKey === "importExport" && (
        <div className="h-full overflow-y-auto bg-[var(--color-surface)] p-6">
          <ImportExport isOpen embedded onClose={onClose} />
        </div>
      )}
      {toolKey === "tagManager" && (
        <TagManagerDialog isOpen onClose={onClose} />
      )}
      {toolKey === "tabGroupManager" && (
        <TabGroupManager isOpen onClose={onClose} />
      )}
      {toolKey === "database" && (
        <DatabasePanel
          onClose={onClose}
          onDatabaseSelect={onDatabaseSelect}
          onDatabaseClose={onDatabaseClose}
          onBeforeCurrentLock={onBeforeCurrentLock}
        />
      )}
      {toolKey === "bulkEditor" && (
        <BulkConnectionEditor
          isOpen
          onClose={onClose}
          onEditConnection={onEditConnection}
        />
      )}
      {toolKey === "connectionEditor" && (
        <FeatureErrorBoundary
          boundaryKey={session.connectionId}
          title={t(
            "errorBoundary.connectionEditorCrashed",
            "Connection Editor crashed",
          )}
          message={t(
            "errorBoundary.connectionEditorCrashedDescription",
            "The connection editor hit a render error. You can retry without restarting the app.",
          )}
        >
          <ConnectionEditor
            initialParentId={session.connectionEditorInitialParentId}
            connection={state.connections.find(
              (c) => c.id === session.connectionId,
            )}
            isOpen
            onClose={onClose}
            onConnect={onReconnect}
          />
        </FeatureErrorBoundary>
      )}
      {toolKey === "rdpSessions" && (
        <SessionManager
          isVisible={isActive}
          connections={state.connections}
          activeBackendSessionIds={activeRdpBackendIds}
          onClose={onClose}
          onReattachSession={onReattachSession}
          onDetachToWindow={onDetachToWindow}
          onReconnect={onReconnect}
          onCloseSession={onCloseManagedSession}
          thumbnailsEnabled={settings.rdpSessionThumbnailsEnabled}
          thumbnailPolicy={settings.rdpSessionThumbnailPolicy}
          thumbnailInterval={settings.rdpSessionThumbnailInterval}
        />
      )}
      {toolKey === "shortcutCreator" && (
        <ShortcutCreator isOpen onClose={onClose} />
      )}
      {toolKey === "proxyProfileEditor" && (
        <ProxyProfileEditor isOpen onClose={onClose} onSave={() => onClose()} />
      )}
      {toolKey === "proxyChainEditor" &&
        (() => {
          // A `tool-` prefixed connectionId is createToolSession's sentinel for
          // "no connection" — i.e. New Chain. Anything else is a chain id.
          const editingChain = session.connectionId?.startsWith("tool-")
            ? null
            : (proxyCollectionManager.getChain(session.connectionId) ?? null);
          return (
            <ProxyChainEditor
              isOpen
              onClose={onClose}
              onSave={async (chainData) => {
                try {
                  if (editingChain) {
                    await proxyCollectionManager.updateChain(
                      editingChain.id,
                      chainData,
                    );
                  } else {
                    await proxyCollectionManager.createChain(
                      chainData.name,
                      chainData.layers,
                      {
                        description: chainData.description,
                        tags: chainData.tags,
                      },
                    );
                  }
                  onClose();
                } catch (error) {
                  console.error("Failed to save proxy chain:", error);
                }
              }}
              editingChain={editingChain}
            />
          );
        })()}
      {toolKey === "sshTunnelEditor" && (
        <SSHTunnelDialog
          isOpen
          onClose={onClose}
          onSave={() => onClose()}
          sshConnections={state.connections.filter((c) => c.protocol === "ssh")}
        />
      )}
      {toolKey === "vpnEditor" && (
        <VpnEditor isOpen onClose={onClose} onSave={() => onClose()} />
      )}
      {toolKey === "tunnelChainEditor" && (
        <TunnelChainEditorPanel
          isOpen
          onClose={onClose}
          onSave={() => onClose()}
          editingChainId={
            session.connectionId?.startsWith("tool-")
              ? undefined
              : session.connectionId
          }
        />
      )}
      {toolKey === "tunnelProfileEditor" && (
        <TunnelProfileEditorPanel
          isOpen
          onClose={onClose}
          onSave={() => onClose()}
          editingProfileId={
            session.connectionId?.startsWith("tool-")
              ? undefined
              : session.connectionId
          }
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
