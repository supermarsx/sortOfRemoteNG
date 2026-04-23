
import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MenuSurface from "../../ui/overlays/MenuSurface";
import { useConnections } from "../../../contexts/useConnections";
import { useSettings } from "../../../contexts/SettingsContext";
import type { Connection } from "../../../types/connection/connection";
import {
  Activity, ChevronRight, ClipboardList, Cog, Copy, Cpu, Edit,
  ExternalLink, FileDown, FileText, FolderOpen, HardDrive, KeyRound, Monitor, Play,
  PlayCircle, Power, Send, SlidersHorizontal, Star, Terminal, Trash2, UserX, Wifi,
} from "lucide-react";

const SUBMENU_ITEM_SELECTOR = [
  '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
  "button:not([disabled]):not([role])",
  "[href]:not([role])",
  '[tabindex]:not([tabindex="-1"]):not([role])',
].join(", ");

const focusFirstSubmenuItem = (panel: HTMLElement | null) => {
  const first = panel?.querySelector<HTMLElement>(SUBMENU_ITEM_SELECTOR);
  first?.focus();
};

function TreeItemMenu({
  connection, activeSession, showMenu, menuPosition, triggerRef, onClose,
  onConnect, onDisconnect, onEdit, onDelete, onCopyHostname, onRename,
  onExport, onConnectWithOptions, onConnectWithoutCredentials,
  onExecuteScripts, onDiagnostics, onDetachSession, onDuplicate, onCheckConnection, onWindowsTool,
  onConnectAll, onConnectAllRecursive,
}: {
  connection: Connection;
  activeSession: { id: string; status: string } | undefined;
  showMenu: boolean;
  menuPosition: { x: number; y: number } | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onConnect: (c: Connection) => void;
  onDisconnect: (c: Connection) => void;
  onEdit: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onCopyHostname: (c: Connection) => void;
  onRename: (c: Connection) => void;
  onExport: (c: Connection) => void;
  onConnectWithOptions: (c: Connection) => void;
  onConnectWithoutCredentials: (c: Connection) => void;
  onExecuteScripts: (c: Connection, sessionId?: string) => void;
  onDiagnostics?: (c: Connection) => void;
  onDetachSession?: (sessionId: string) => void;
  onDuplicate: (
    c: Connection,
    options?: { includeCredentials?: boolean },
  ) => void | Promise<Connection | undefined>;
  onCheckConnection?: (c: Connection) => void;
  onWindowsTool?: (c: Connection, tool: string) => void;
  onConnectAll?: (folder: Connection) => void;
  onConnectAllRecursive?: (folder: Connection) => void;
}) {
  const { dispatch } = useConnections();
  const { settings } = useSettings();
  const { t } = useTranslation();
  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); onClose(); };
  const enableWinrm = connection.enableWinrmTools ?? settings.enableWinrmTools ?? true;
  const [connectInWindowOpen, setConnectInWindowOpen] = useState(false);
  const [windowsToolsOpen, setWindowsToolsOpen] = useState(false);
  const [detachedWindows, setDetachedWindows] = useState<Array<{ label: string; title: string }>>([]);
  const connectInWindowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const connectInWindowPanelRef = useRef<HTMLDivElement | null>(null);
  const windowsToolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const windowsToolsPanelRef = useRef<HTMLDivElement | null>(null);
  const connectInWindowTriggerId = useId();
  const connectInWindowPanelId = useId();
  const windowsToolsTriggerId = useId();
  const windowsToolsPanelId = useId();

  const handleSubmenuTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    panelRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
    requestAnimationFrame(() => {
      focusFirstSubmenuItem(panelRef.current);
    });
  };

  const handleSubmenuPanelKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    setOpen: React.Dispatch<React.SetStateAction<boolean>>,
    triggerRef: React.RefObject<HTMLButtonElement | null>,
  ) => {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Fetch detached windows when menu opens
  useEffect(() => {
    if (!showMenu) return;
    import("@tauri-apps/api/window").then(({ getAllWindows }) =>
      getAllWindows().then(async (wins) => {
        const detached = wins.filter(w => w.label !== "main" && w.label.startsWith("detached-"));
        const entries = await Promise.all(
          detached.map(async (w) => {
            const title = await w.title().catch(() => w.label);
            return { label: w.label, title: title || w.label };
          })
        );
        setDetachedWindows(entries);
      })
    ).catch(() => setDetachedWindows([]));
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu) {
      setConnectInWindowOpen(false);
      setWindowsToolsOpen(false);
    }
  }, [showMenu]);

  return (
    <MenuSurface
      isOpen={showMenu}
      onClose={onClose}
      position={menuPosition}
      ignoreRefs={[triggerRef]}
      className="min-w-[140px]"
      dataTestId="connection-tree-item-menu"
      ariaLabel="Connection actions"
    >
      {connection.isGroup && (
        <button
          onClick={act(() => onConnectAll?.(connection))}
          className="sor-menu-item"
        >
          <PlayCircle size={14} className="mr-2" />
          Connect All in Folder
        </button>
      )}
      {connection.isGroup && (
        <button
          onClick={act(() => onConnectAllRecursive?.(connection))}
          className="sor-menu-item"
        >
          <FolderOpen size={14} className="mr-2" />
          Connect All (Including Sub-folders)
        </button>
      )}
      {connection.isGroup && <div className="sor-menu-divider" />}
      {!connection.isGroup && (
        <button onClick={act(() => activeSession ? onDisconnect(connection) : onConnect(connection))} className="sor-menu-item">
          {activeSession ? <Power size={14} className="mr-2" /> : <Play size={14} className="mr-2" />}
          {activeSession ? "Disconnect" : "Connect"}
        </button>
      )}
      {!connection.isGroup && !activeSession && (
        <>
          <button onClick={act(() => {
            // Connect then immediately detach to a new window
            onConnect(connection);
            // Defer detach to let the session be created first
            setTimeout(() => {
              import("@tauri-apps/api/event").then(({ emit }) => {
                emit("connect-in-new-window", { connectionId: connection.id });
              });
            }, 500);
          })} className="sor-menu-item">
            <ExternalLink size={14} className="mr-2" />Connect in New Window
          </button>
          {detachedWindows.length > 0 && (
            <div
              className="sor-menu-submenu"
              data-submenu-open={connectInWindowOpen ? "true" : "false"}
              onMouseEnter={() => setConnectInWindowOpen(true)}
              onMouseLeave={() => setConnectInWindowOpen(false)}
              onBlurCapture={(event) => {
                const next = event.relatedTarget as Node | null;
                if (!event.currentTarget.contains(next)) {
                  setConnectInWindowOpen(false);
                }
              }}
            >
              <button
                id={connectInWindowTriggerId}
                ref={connectInWindowTriggerRef}
                className="sor-menu-item"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={connectInWindowOpen}
                aria-controls={connectInWindowPanelId}
                onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, setConnectInWindowOpen, connectInWindowPanelRef)}
              >
                <Send size={14} className="mr-2" />
                Connect in Window
                <ChevronRight size={12} className="ml-auto opacity-50" />
              </button>
              <div
                id={connectInWindowPanelId}
                ref={connectInWindowPanelRef}
                className="sor-menu-submenu-panel"
                role="menu"
                tabIndex={-1}
                aria-labelledby={connectInWindowTriggerId}
                onKeyDown={(event) => handleSubmenuPanelKeyDown(event, setConnectInWindowOpen, connectInWindowTriggerRef)}
              >
                {detachedWindows.map(w => (
                  <button
                    key={w.label}
                    role="menuitem"
                    onClick={act(() => {
                      onConnect(connection);
                      setTimeout(() => {
                        import("@tauri-apps/api/event").then(({ emit }) => {
                          emit("connect-in-window", { connectionId: connection.id, targetWindow: w.label });
                        });
                      }, 500);
                    })}
                    className="sor-menu-item"
                  >
                    <Monitor size={14} className="mr-2" />
                    {w.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {!connection.isGroup && (
        <>
          <button onClick={act(() => onConnectWithOptions(connection))} className="sor-menu-item">
            <SlidersHorizontal size={14} className="mr-2" />Connect with options
          </button>
          <button onClick={act(() => onConnectWithoutCredentials(connection))} className="sor-menu-item">
            <UserX size={14} className="mr-2" />Connect without credentials
          </button>
          <button onClick={act(() => onExecuteScripts(connection, activeSession?.id))} className="sor-menu-item">
            <Play size={14} className="mr-2" />Execute scripts
          </button>
          {onDiagnostics && <button onClick={act(() => onDiagnostics(connection))} className="sor-menu-item">
            <Activity size={14} className="mr-2" />Diagnostics
          </button>}
          {activeSession && onDetachSession && (
            <button onClick={act(() => onDetachSession(activeSession.id))} className="sor-menu-item">
              <ExternalLink size={14} className="mr-2" />Detach window
            </button>
          )}
        </>
      )}
      {/* Windows Management submenu */}
      {!connection.isGroup && enableWinrm && (connection.osType === 'windows' || (!connection.osType && connection.protocol === 'rdp')) && (
        <>
          <div className="sor-menu-divider" />
          <div
            className="sor-menu-submenu"
            data-submenu-open={windowsToolsOpen ? "true" : "false"}
            onMouseEnter={() => setWindowsToolsOpen(true)}
            onMouseLeave={() => setWindowsToolsOpen(false)}
            onBlurCapture={(event) => {
              const next = event.relatedTarget as Node | null;
              if (!event.currentTarget.contains(next)) {
                setWindowsToolsOpen(false);
              }
            }}
          >
            <button
              id={windowsToolsTriggerId}
              ref={windowsToolsTriggerRef}
              className="sor-menu-item"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={windowsToolsOpen}
              aria-controls={windowsToolsPanelId}
              onKeyDown={(event) => handleSubmenuTriggerKeyDown(event, setWindowsToolsOpen, windowsToolsPanelRef)}
            >
              <Monitor size={14} className="mr-2" />
              Windows Management
              <ChevronRight size={12} className="ml-auto opacity-50" />
            </button>
            <div
              id={windowsToolsPanelId}
              ref={windowsToolsPanelRef}
              className="sor-menu-submenu-panel"
              role="menu"
              tabIndex={-1}
              aria-labelledby={windowsToolsTriggerId}
              onKeyDown={(event) => handleSubmenuPanelKeyDown(event, setWindowsToolsOpen, windowsToolsTriggerRef)}
            >
              <div className="sor-menu-submenu-label">Remote Tools</div>
              <button onClick={act(() => onWindowsTool?.(connection, 'services'))} className="sor-menu-item" role="menuitem">
                <Cog size={14} className="mr-2" />Services
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'processes'))} className="sor-menu-item" role="menuitem">
                <Cpu size={14} className="mr-2" />Processes
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'eventlog'))} className="sor-menu-item" role="menuitem">
                <FileText size={14} className="mr-2" />Event Viewer
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'registry'))} className="sor-menu-item" role="menuitem">
                <HardDrive size={14} className="mr-2" />Registry
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'tasks'))} className="sor-menu-item" role="menuitem">
                <ClipboardList size={14} className="mr-2" />Scheduled Tasks
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'perfmon'))} className="sor-menu-item" role="menuitem">
                <Activity size={14} className="mr-2" />Performance
              </button>
              <div className="sor-menu-divider" />
              <button onClick={act(() => onWindowsTool?.(connection, 'powershell'))} className="sor-menu-item" role="menuitem">
                <Terminal size={14} className="mr-2" />PowerShell
              </button>
              <button onClick={act(() => onWindowsTool?.(connection, 'sysinfo'))} className="sor-menu-item" role="menuitem">
                <Monitor size={14} className="mr-2" />System Info
              </button>
            </div>
          </div>
        </>
      )}
      {!connection.isGroup && <div className="sor-menu-divider" />}
      <button onClick={act(() => onEdit(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Edit
      </button>
      <button onClick={act(() => onRename(connection))} className="sor-menu-item">
        <Edit size={14} className="mr-2" />Rename
      </button>
      {!connection.isGroup && (
        <button
          onClick={act(() => dispatch({ type: "UPDATE_CONNECTION", payload: { ...connection, favorite: !connection.favorite } }))}
          className="sor-menu-item"
        >
          <Star
            size={12}
            className={`mr-2 ${connection.favorite ? "text-warning" : "text-[var(--color-textSecondary)]"}`}
            fill={connection.favorite ? "currentColor" : "none"}
          />
          {connection.favorite ? "Remove favorite" : "Add to favorites"}
        </button>
      )}
      {!connection.isGroup && (
        <button onClick={act(() => onCopyHostname(connection))} className="sor-menu-item">
          <Copy size={14} className="mr-2" />Copy hostname
        </button>
      )}
      {!connection.isGroup && (
        <button onClick={act(() => onExport(connection))} className="sor-menu-item">
          <FileDown size={14} className="mr-2" />Export to file
        </button>
      )}
      <button onClick={act(() => { void onDuplicate(connection); })} className="sor-menu-item">
        <Copy size={14} className="mr-2" />{t('connections.clone')}
      </button>
      <button onClick={act(() => { void onDuplicate(connection, { includeCredentials: true }); })} className="sor-menu-item">
        <KeyRound size={14} className="mr-2" />{t('connections.cloneWithCredentials')}
      </button>
      {!connection.isGroup && onCheckConnection && (
        <button onClick={act(() => onCheckConnection(connection))} className="sor-menu-item">
          <Wifi size={14} className="mr-2" />{t('connections.checkConnection')}
        </button>
      )}
      <div className="sor-menu-divider" />
      <button onClick={act(() => onDelete(connection))} className="sor-menu-item sor-menu-item-danger">
        <Trash2 size={14} className="mr-2" />Delete
      </button>
    </MenuSurface>
  );
}

export default TreeItemMenu;
