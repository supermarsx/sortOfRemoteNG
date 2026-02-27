import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Monitor, Zap, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Connection, ConnectionSession, TabLayout } from "./types/connection";
import { CloudSyncProvider, GlobalSettings, defaultCloudSyncConfig } from "./types/settings";
import { SettingsManager } from "./utils/settingsManager";
import { StatusChecker } from "./utils/statusChecker";
import { CollectionManager } from "./utils/collectionManager";
import { CollectionNotFoundError, InvalidPasswordError } from "./utils/errors";
import { SecureStorage } from "./utils/storage";
import { useSessionManager } from "./hooks/useSessionManager";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { ConnectionProvider } from "./contexts/ConnectionProvider";
import { useConnections } from "./contexts/useConnections";
import { ToastProvider } from "./contexts/ToastContext";
import { Sidebar } from "./components/Sidebar";
import { SessionTabs } from "./components/SessionTabs";
import { SessionViewer } from "./components/SessionViewer";
import { TabLayoutManager } from "./components/TabLayoutManager";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SplashScreen } from "./components/SplashScreen";
import { RdpSessionPanel } from "./components/RdpSessionPanel";
import { generateId } from "./utils/id";
import { useTooltipSystem } from "./hooks/useTooltipSystem";
import { useWindowControls } from "./hooks/useWindowControls";
import { useWindowTheme } from "./hooks/useWindowTheme";
import { useWindowPersistence } from "./hooks/useWindowPersistence";
import { useDetachedSessionEvents } from "./hooks/useDetachedSessionEvents";
import { AppToolbar } from "./components/AppToolbar";
import { AppDialogs } from "./components/AppDialogs";
import { useResizeHandlers } from "./hooks/useResizeHandlers";
import { useSessionDetach } from "./hooks/useSessionDetach";

/**
 * Core application component responsible for rendering the main layout and
 * managing global application state.
 */
const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const { state, dispatch, loadData, saveData } = useConnections();
  const settingsManager = SettingsManager.getInstance();
  const [editingConnection, setEditingConnection] = useState<
    Connection | undefined
  >(undefined); // connection currently being edited
  const [showConnectionEditor, setShowConnectionEditor] = useState(false); // connection editor visibility
  const [showQuickConnect, setShowQuickConnect] = useState(false); // quick connect dialog visibility
  const [showPasswordDialog, setShowPasswordDialog] = useState(false); // password dialog visibility
  const [showCollectionSelector, setShowCollectionSelector] = useState(false); // collection selector visibility
  const [showSettings, setShowSettings] = useState(false); // settings dialog visibility
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importExportInitialTab, setImportExportInitialTab] = useState<'export' | 'import'>('export');
  const [showShortcutManager, setShowShortcutManager] = useState(false);
  const [showProxyMenu, setShowProxyMenu] = useState(false);
  const [showInternalProxyManager, setShowInternalProxyManager] = useState(false);
  const [rdpPanelOpen, setRdpPanelOpen] = useState(false);
  const [rdpPanelWidth, setRdpPanelWidth] = useState(380);
  // isRdpPanelResizing is in useResizeHandlers hook
  const [showWol, setShowWol] = useState(false);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showBulkSSH, setShowBulkSSH] = useState(false);
  const [showScriptManager, setShowScriptManager] = useState(false);
  const [showMacroManager, setShowMacroManager] = useState(false);
  const [showRecordingManager, setShowRecordingManager] = useState(false);
  const [diagnosticsConnection, setDiagnosticsConnection] = useState<Connection | null>(null);
  const [pendingLaunchConnectionId, setPendingLaunchConnectionId] = useState<
    string | null
  >(null);
  const [tabLayout, setTabLayout] = useState<TabLayout>(() => ({
    mode: "tabs",
    sessions: [],
  }));
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock"
  >("setup"); // current mode for password dialog
  const [passwordError, setPasswordError] = useState(""); // password dialog error message
  const [sidebarWidth, setSidebarWidth] = useState(320); // sidebar width in pixels
  // isResizing state is in useResizeHandlers hook
  const [sidebarPosition, setSidebarPosition] = useState<"left" | "right">(
    "left",
  ); // sidebar position
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
  }); // confirm dialog state
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [appSettings, setAppSettings] = useState(() =>
    settingsManager.getSettings(),
  );
  // windowSaveTimeout and sidebarSaveTimeout are in useWindowPersistence hook
  const lastWorkAtRef = useRef<number>(Date.now());
  const hasUnsavedWorkRef = useRef(false);
  const [hasStoragePassword, setHasStoragePassword] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [appReady, setAppReady] = useState(false);
  const closingMainRef = useRef(false);
  const pendingCloseRef = useRef<(() => void) | null>(null);
  const awaitingCloseConfirmRef = useRef(false);

  const statusChecker = StatusChecker.getInstance();
  const collectionManager = CollectionManager.getInstance();

  const {
    activeSessionId,
    setActiveSessionId,
    handleConnect,
    handleQuickConnect,
    handleSessionClose,
    restoreSession,
    confirmDialog,
  } = useSessionManager();

  const { isInitialized } = useAppLifecycle({
    handleConnect,
    restoreSession,
    setShowCollectionSelector,
    setShowPasswordDialog,
    setPasswordDialogMode,
  });

  // Extracted hooks
  const {
    isAlwaysOnTop, isWindowPermissionError,
    handleMinimize, handleToggleTransparency, handleToggleAlwaysOnTop,
    handleRepatriateWindow, handleMaximize, handleOpenDevtools, handleClose,
  } = useWindowControls(appSettings, settingsManager);
  useTooltipSystem();
  useWindowTheme(appSettings, isWindowPermissionError);
  useWindowPersistence(
    appSettings, settingsManager, isInitialized, isWindowPermissionError,
    sidebarWidth, setSidebarWidth, sidebarPosition, setSidebarPosition,
    state.sidebarCollapsed, dispatch,
  );
  useDetachedSessionEvents(handleSessionClose, state.sessions, dispatch, setActiveSessionId);
  const { handleMouseDown, handleRdpPanelMouseDown } = useResizeHandlers(
    sidebarPosition, setSidebarWidth, setRdpPanelWidth, layoutRef,
  );

  // Show window immediately so splash screen is visible
  useEffect(() => {
    const showWindow = async () => {
      try {
        const currentWindow = getCurrentWindow();
        // Center the window first, then show it
        await currentWindow.center();
        await currentWindow.show();
        await currentWindow.setFocus();
      } catch {
        // Not in Tauri environment, ignore
      }
    };
    showWindow();
  }, []);

  // Suppress autocomplete on all inputs when the setting is disabled
  useEffect(() => {
    if (appSettings.enableAutocomplete) return;
    const attr = 'autocomplete';
    const applyToAll = () => {
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        if (!el.getAttribute(attr) || el.getAttribute(attr) !== 'off') {
          el.setAttribute(attr, 'off');
          // Chrome ignores autocomplete="off" on some fields — use a non-standard
          // value to ensure the browser doesn't auto-fill.
          el.setAttribute('data-lpignore', 'true');
          el.setAttribute('data-form-type', 'other');
        }
      });
    };
    applyToAll();
    const observer = new MutationObserver(() => applyToAll());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [appSettings.enableAutocomplete]);

  // Track when app is fully initialized
  useEffect(() => {
    if (isInitialized && !appReady) {
      setAppReady(true);
    }
  }, [isInitialized, appReady]);

  // Restore frontend tabs for backend RDP sessions that survived a reload.
  // Runs once on startup — checks list_rdp_sessions for connected sessions
  // that don't have a matching frontend tab, and creates them.
  const rdpRestoredRef = useRef(false);
  useEffect(() => {
    if (!appReady || rdpRestoredRef.current) return;
    rdpRestoredRef.current = true;

    (async () => {
      try {
        const backendSessions = await invoke<Array<{
          id: string;
          connection_id?: string;
          host: string;
          port: number;
          connected: boolean;
          desktop_width: number;
          desktop_height: number;
        }>>('list_rdp_sessions');

        const connectedSessions = backendSessions.filter(s => s.connected);
        if (connectedSessions.length === 0) return;

        for (const bs of connectedSessions) {
          // Skip if a frontend session already exists for this backend session
          const existing = state.sessions.find(
            s => s.protocol === 'rdp' && (
              s.connectionId === bs.connection_id ||
              s.backendSessionId === bs.id
            )
          );
          if (existing) continue;

          const connection = bs.connection_id
            ? state.connections.find(c => c.id === bs.connection_id)
            : state.connections.find(c =>
                c.hostname === bs.host && (c.port || 3389) === bs.port && c.protocol === 'rdp'
              );

          const newSession: ConnectionSession = {
            id: generateId(),
            connectionId: connection?.id || bs.connection_id || bs.id,
            name: connection?.name || `${bs.host}:${bs.port}`,
            status: 'connected',
            startTime: new Date(),
            protocol: 'rdp',
            hostname: bs.host,
            reconnectAttempts: 0,
            maxReconnectAttempts: 3,
          };

          dispatch({ type: 'ADD_SESSION', payload: newSession });
          // RDPClient will mount and auto-detect the existing backend session
          // via list_rdp_sessions → attach_rdp_session, receiving the full
          // framebuffer immediately.
        }
      } catch {
        // Backend may not be ready yet — not an error
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady]);

  const handleQuickConnectWithHistory = useCallback(
    (payload: {
      hostname: string;
      protocol: string;
      username?: string;
      password?: string;
      domain?: string;
      authType?: "password" | "key";
      privateKey?: string;
      passphrase?: string;
      basicAuthUsername?: string;
      basicAuthPassword?: string;
      httpVerifySsl?: boolean;
    }) => {
      if (appSettings.quickConnectHistoryEnabled) {
        const entry = {
          hostname: payload.hostname,
          protocol: payload.protocol,
          username: payload.username,
          authType: payload.authType,
        };
        const current = appSettings.quickConnectHistory ?? [];
        const next = [
          entry,
          ...current.filter(
            (item) =>
              item.hostname !== entry.hostname ||
              item.protocol !== entry.protocol ||
              item.username !== entry.username ||
              item.authType !== entry.authType,
          ),
        ].slice(0, 12);
        settingsManager
          .saveSettings({ quickConnectHistory: next }, { silent: true })
          .catch(console.error);
      }
      handleQuickConnect(payload);
    },
    [
      appSettings.quickConnectHistory,
      appSettings.quickConnectHistoryEnabled,
      handleQuickConnect,
      settingsManager,
    ],
  );

  const clearQuickConnectHistory = useCallback(() => {
    settingsManager
      .saveSettings({ quickConnectHistory: [] }, { silent: true })
      .catch(console.error);
  }, [settingsManager]);

  const launchArgsHandledRef = useRef(false);

  const visibleSessions = useMemo(
    () => state.sessions.filter((session) => !session.layout?.isDetached),
    [state.sessions],
  );

  const { handleSessionDetach, handleReattachRdpSession } = useSessionDetach(
    state.sessions, state.connections, visibleSessions,
    activeSessionId, dispatch, setActiveSessionId,
  );

  /** Backend RDP session IDs that have an active frontend viewer tab. */
  const activeRdpBackendIds = useMemo(
    () => state.sessions
      .filter((s) => s.protocol === 'rdp')
      .map((s) => s.backendSessionId || s.connectionId)
      .filter(Boolean) as string[],
    [state.sessions],
  );

  const buildTabLayout = useCallback(
    (mode: TabLayout["mode"], sessions: ConnectionSession[]): TabLayout => {
      const orderedSessions = activeSessionId
        ? [
            ...sessions.filter((session) => session.id === activeSessionId),
            ...sessions.filter((session) => session.id !== activeSessionId),
          ]
        : sessions;

      const buildGridLayout = (cols: number, rows?: number) => {
        const totalRows =
          (rows ?? Math.ceil(orderedSessions.length / cols)) || 1;
        const width = 100 / cols;
        const height = 100 / totalRows;
        return orderedSessions.map((session, index) => ({
          sessionId: session.id,
          position: {
            x: (index % cols) * width,
            y: Math.floor(index / cols) * height,
            width,
            height,
          },
        }));
      };

      switch (mode) {
        case "splitVertical": {
          const cols = 2;
          const rows = Math.ceil(orderedSessions.length / cols) || 1;
          return { mode, sessions: buildGridLayout(cols, rows) };
        }
        case "splitHorizontal": {
          const rows = 2;
          const cols = Math.ceil(orderedSessions.length / rows) || 1;
          return { mode, sessions: buildGridLayout(cols, rows) };
        }
        case "grid2":
          return { mode, sessions: buildGridLayout(2, 1).slice(0, 2) };
        case "grid4":
          return { mode, sessions: buildGridLayout(2, 2).slice(0, 4) };
        case "grid6":
          return { mode, sessions: buildGridLayout(3, 2).slice(0, 6) };
        case "sideBySide":
          return { mode, sessions: buildGridLayout(2) };
        case "mosaic": {
          const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
          return { mode, sessions: buildGridLayout(cols) };
        }
        case "miniMosaic": {
          const cols = Math.ceil(Math.sqrt(orderedSessions.length)) || 1;
          return { mode, sessions: buildGridLayout(cols) };
        }
        default:
          return { mode: "tabs", sessions: buildGridLayout(1, 1) };
      }
    },
    [activeSessionId],
  );

  useEffect(() => {
    setTabLayout((current) => {
      const currentIds = new Set(
        current.sessions.map((item) => item.sessionId),
      );
      const visibleIds = new Set(visibleSessions.map((session) => session.id));
      const hasDiff =
        current.sessions.some((item) => !visibleIds.has(item.sessionId)) ||
        visibleSessions.some((session) => !currentIds.has(session.id));
      if (!hasDiff) {
        return current;
      }
      return buildTabLayout(current.mode, visibleSessions);
    });
  }, [visibleSessions, buildTabLayout]);

  useEffect(() => {
    if (
      activeSessionId &&
      !visibleSessions.some((session) => session.id === activeSessionId)
    ) {
      setActiveSessionId(visibleSessions[0]?.id);
    }
  }, [activeSessionId, visibleSessions, setActiveSessionId]);

  const showAlert = useCallback((message: string) => {
    setDialogState({
      isOpen: true,
      message,
      onConfirm: () => setDialogState((prev) => ({ ...prev, isOpen: false })),
    });
  }, []);

  /**
   * Select a collection and load its data, handling common errors.
   *
   * @param collectionId - ID of the collection to select.
   * @param password - Optional password for encrypted collections.
   */
  const handleCollectionSelect = useCallback(
    async (collectionId: string, password?: string): Promise<void> => {
      try {
        await collectionManager.selectCollection(collectionId, password);
        await loadData();
        setShowCollectionSelector(false);
        settingsManager.logAction(
          "info",
          "Collection selected",
          undefined,
          `Collection: ${collectionManager.getCurrentCollection()?.name}`,
        );
        
        // Save the last opened collection ID for auto-open feature
        const currentSettings = settingsManager.getSettings();
        if (currentSettings.autoOpenLastCollection) {
          await settingsManager.saveSettings({
            ...currentSettings,
            lastOpenedCollectionId: collectionId,
          }, { silent: true });
        }
      } catch (error) {
        console.error("Failed to select collection:", error);
        if (error instanceof CollectionNotFoundError) {
          showAlert("Collection not found");
        } else if (error instanceof InvalidPasswordError) {
          showAlert("Invalid or missing password");
        } else {
          showAlert("Failed to access collection. Please check your password.");
        }
      }
    },
    [
      collectionManager,
      loadData,
      setShowCollectionSelector,
      settingsManager,
      showAlert,
    ],
  );

  /** Open the connection editor to create a new connection. */
  const handleNewConnection = (): void => {
    setEditingConnection(undefined);
    setShowConnectionEditor(true);
  };

  const handleEditConnection = (connection: Connection) => {
    setEditingConnection(connection);
    setShowConnectionEditor(true);
  };

  const handleDeleteConnection = (connection: Connection) => {
    const settings = settingsManager.getSettings();
    const confirmMessage =
      connection.warnOnClose || settings.warnOnClose
        ? t("dialogs.confirmDelete")
        : null;

    if (!confirmMessage) {
      dispatch({ type: "DELETE_CONNECTION", payload: connection.id });
      statusChecker.stopChecking(connection.id);
      settingsManager.logAction(
        "info",
        "Connection deleted",
        connection.id,
        `Connection "${connection.name}" deleted`,
      );
    } else {
      showConfirm(confirmMessage, () => {
        dispatch({ type: "DELETE_CONNECTION", payload: connection.id });
        statusChecker.stopChecking(connection.id);
        settingsManager.logAction(
          "info",
          "Connection deleted",
          connection.id,
          `Connection "${connection.name}" deleted`,
        );
      });
    }
  };

  const handleDiagnostics = useCallback((connection: Connection) => {
    setDiagnosticsConnection(connection);
    setShowDiagnostics(true);
  }, []);

  const handleDisconnectConnection = useCallback(
    async (connection: Connection) => {
      const session = state.sessions.find(
        (item) => item.connectionId === connection.id,
      );
      if (!session) {
        return;
      }
      await handleSessionClose(session.id);
    },
    [handleSessionClose, state.sessions],
  );

  // handleSessionDetach and handleReattachRdpSession are in useSessionDetach hook

  /**
   * Process a submitted password for unlocking or securing data storage.
   *
   * @param password - User provided password.
   */
  const handlePasswordSubmit = async (password: string): Promise<void> => {
    try {
      setPasswordError("");
      SecureStorage.setPassword(password);

      if (passwordDialogMode === "unlock") {
        await loadData();
      } else {
        await saveData();
      }

      setShowPasswordDialog(false);
      settingsManager.logAction(
        "info",
        "Storage unlocked",
        undefined,
        "Data storage unlocked successfully",
      );
    } catch (error) {
      setPasswordError(
        passwordDialogMode === "unlock"
          ? t("dialogs.invalidPassword")
          : "Failed to secure data",
      );
      SecureStorage.clearPassword();
      settingsManager.logAction(
        "error",
        "Storage unlock failed",
        undefined,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };

  const handlePasswordCancel = () => {
    if (passwordDialogMode === "setup") {
      if (!collectionManager.getCurrentCollection()) {
        showAlert("No collection selected.");
        setShowPasswordDialog(false);
        setPasswordError("");
        return;
      }
      saveData().catch(console.error);
    }
    setShowPasswordDialog(false);
    setPasswordError("");
  };

  const handleShowPasswordDialog = async () => {
    if (await SecureStorage.isStorageEncrypted()) {
      if (SecureStorage.isStorageUnlocked()) {
        setPasswordDialogMode("setup");
      } else {
        setPasswordDialogMode("unlock");
      }
    } else {
      setPasswordDialogMode("setup");
    }
    setShowPasswordDialog(true);
  };

  const showConfirm = (
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
  ) => {
    setDialogState({
      isOpen: true,
      message,
      onConfirm,
      onCancel,
    });
  };

  // isWindowPermissionError is in useWindowControls hook

  const closeConfirmDialog = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
  };

  const toggleSidebarPosition = () => {
    setSidebarPosition((prev) => (prev === "left" ? "right" : "left"));
  };

  // Sidebar + RDP panel resize handlers are in useResizeHandlers hook

  useEffect(() => {
    let isMounted = true;
    settingsManager
      .loadSettings()
      .then((settings) => {
        if (isMounted) {
          setAppSettings(settings);
        }
      })
      .catch(console.error);

    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<GlobalSettings>).detail;
      if (detail) {
        setAppSettings(detail);
      }
    };

    window.addEventListener("settings-updated", handleSettingsUpdated);
    return () => {
      isMounted = false;
      window.removeEventListener("settings-updated", handleSettingsUpdated);
    };
  }, [settingsManager]);

  const performCloudSync = useCallback(
    async (provider?: CloudSyncProvider) => {
      const currentConfig = appSettings.cloudSync ?? defaultCloudSyncConfig;
      const enabledProviders = currentConfig.enabledProviders ?? [];

      if (!currentConfig.enabled || enabledProviders.length === 0) {
        return;
      }

      const targetProviders = provider
        ? enabledProviders.includes(provider)
          ? [provider]
          : []
        : enabledProviders;

      if (targetProviders.length === 0) {
        return;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const nextProviderStatus: GlobalSettings["cloudSync"]["providerStatus"] = {
        ...currentConfig.providerStatus,
      };

      targetProviders.forEach((target) => {
        nextProviderStatus[target] = {
          ...nextProviderStatus[target],
          enabled: true,
          lastSyncTime: nowSeconds,
          lastSyncStatus: "success",
          lastSyncError: undefined,
        };
      });

      const updatedCloudSync: GlobalSettings["cloudSync"] = {
        ...currentConfig,
        providerStatus: nextProviderStatus,
        lastSyncTime: nowSeconds,
        lastSyncStatus: "success",
        lastSyncError: undefined,
      };

      setAppSettings((prev) => ({ ...prev, cloudSync: updatedCloudSync }));
      await settingsManager.saveSettings(
        { cloudSync: updatedCloudSync },
        { silent: true },
      );
    },
    [appSettings, settingsManager],
  );

  useEffect(() => {
    let isMounted = true;
    SecureStorage.isStorageEncrypted()
      .then((encrypted) => {
        if (isMounted) {
          setHasStoragePassword(encrypted);
        }
      })
      .catch(console.error);
    return () => {
      isMounted = false;
    };
  }, [showPasswordDialog]);

  useEffect(() => {
    hasUnsavedWorkRef.current = true;
    lastWorkAtRef.current = Date.now();
  }, [state.connections, state.sessions]);

  useEffect(() => {
    if (!appSettings.autoSaveEnabled) return;
    const intervalMs =
      Math.max(1, appSettings.autoSaveIntervalMinutes || 1) * 60 * 1000;

    const interval = setInterval(() => {
      if (!hasUnsavedWorkRef.current) return;
      const elapsed = Date.now() - lastWorkAtRef.current;
      if (elapsed < intervalMs) return;
      if (!collectionManager.getCurrentCollection()) return;

      saveData()
        .then(() => {
          hasUnsavedWorkRef.current = false;
        })
        .catch(console.error);
    }, 10000);

    return () => clearInterval(interval);
  }, [
    appSettings.autoSaveEnabled,
    appSettings.autoSaveIntervalMinutes,
    collectionManager,
    saveData,
  ]);

  useEffect(() => {
    if (!appSettings) return;
    const root = document.documentElement;
    
    // Determine glow color: either from color scheme or custom setting
    let glowColor = appSettings.backgroundGlowColor || "#2563eb";
    if (appSettings.backgroundGlowFollowsColorScheme) {
      // Get the primary color from CSS variable set by theme manager
      const computedPrimary = getComputedStyle(root).getPropertyValue("--color-primary").trim();
      if (computedPrimary) {
        glowColor = computedPrimary;
      }
    }
    
    root.style.setProperty("--app-glow-color", glowColor);
    root.style.setProperty(
      "--app-glow-opacity",
      `${appSettings.backgroundGlowOpacity ?? 0}`,
    );
    root.style.setProperty(
      "--app-glow-radius",
      `${appSettings.backgroundGlowRadius ?? 520}px`,
    );
    root.style.setProperty(
      "--app-glow-blur",
      `${appSettings.backgroundGlowBlur ?? 140}px`,
    );
  }, [
    appSettings,
    appSettings.backgroundGlowBlur,
    appSettings.backgroundGlowColor,
    appSettings.backgroundGlowFollowsColorScheme,
    appSettings.backgroundGlowOpacity,
    appSettings.backgroundGlowRadius,
    appSettings.colorScheme,
  ]);

  // Tooltip system is in useTooltipSystem hook

  // Always-on-top check is in useWindowControls hook

  useEffect(() => {
    if (!isInitialized || launchArgsHandledRef.current) return;
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    launchArgsHandledRef.current = true;
    (async () => {
      try {
        const args = await invoke<{
          collection_id?: string | null;
          connection_id?: string | null;
        }>("get_launch_args");

        if (args.collection_id) {
          await handleCollectionSelect(args.collection_id);
        }

        if (args.connection_id) {
          setPendingLaunchConnectionId(args.connection_id);
        }
      } catch (error) {
        console.error("Failed to read launch args:", error);
      }
    })();
  }, [handleCollectionSelect, isInitialized]);

  useEffect(() => {
    if (!pendingLaunchConnectionId) return;
    if (state.connections.length === 0) return;
    const connection = state.connections.find(
      (item) => item.id === pendingLaunchConnectionId,
    );
    if (connection) {
      handleConnect(connection);
    }
    setPendingLaunchConnectionId(null);
  }, [handleConnect, pendingLaunchConnectionId, state.connections]);

  // Detached session events are in useDetachedSessionEvents hook
  // Window theme/transparency effect is in useWindowTheme hook

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTauri = Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    );
    if (!isTauri) return;
    const currentWindow = getCurrentWindow();
    let isCancelled = false;
    let unlisten: (() => void) | null = null;

    const performClose = async () => {
      if (closingMainRef.current) return;
      closingMainRef.current = true;
      try {
        const windows = await getAllWindows();
        await Promise.all(
          windows
            .filter((win) => win.label !== currentWindow.label)
            .map((win) => win.close().catch(() => undefined)),
        );
      } catch (error) {
        console.error("Failed to close detached windows:", error);
      }
      currentWindow.close().catch(() => undefined);
    };

    currentWindow
      .onCloseRequested(async (event) => {
        // If we're already in the process of closing, allow it
        if (closingMainRef.current) return;
        
        // If we're awaiting confirmation, don't re-trigger
        if (awaitingCloseConfirmRef.current) {
          event.preventDefault();
          return;
        }
        
        // Check if we should warn the user
        const settings = settingsManager.getSettings();
        const hasActiveSessions = state.sessions.length > 0;

        if ((settings.warnOnClose || settings.warnOnExit) && hasActiveSessions) {
          // Prevent close and show confirmation dialog
          event.preventDefault();
          awaitingCloseConfirmRef.current = true;
          pendingCloseRef.current = performClose;
          setDialogState({
            isOpen: true,
            message: t("dialogs.confirmExit", "You have active sessions. Are you sure you want to close?"),
            onConfirm: () => {
              awaitingCloseConfirmRef.current = false;
              pendingCloseRef.current?.();
              pendingCloseRef.current = null;
            },
            onCancel: () => {
              awaitingCloseConfirmRef.current = false;
              pendingCloseRef.current = null;
            },
          });
        } else {
          // No warning needed - close detached windows first, then allow close
          await performClose();
        }
      })
      .then((stop) => {
        if (isCancelled) {
          try { stop(); } catch { /* ignore */ }
        } else {
          unlisten = stop;
        }
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
      try { unlisten?.(); } catch { /* ignore */ }
    };
  }, [settingsManager, state.sessions.length, t]);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>("[title]");
    elements.forEach((element) => {
      if (element.dataset.tooltip) return;
      const title = element.getAttribute("title");
      if (!title) return;
      element.setAttribute("data-tooltip", title);
      element.removeAttribute("title");
    });
  }, [
    showSettings,
    showQuickConnect,
    showConnectionEditor,
    showCollectionSelector,
    showPerformanceMonitor,
    showActionLog,
    showImportExport,
    showPasswordDialog,
    state.sessions.length,
  ]);

  // Window/sidebar persistence is in useWindowPersistence hook
  // Window control handlers are in useWindowControls hook

  const renderSidebar = (position: "left" | "right") => {
    if (sidebarPosition !== position) return null;
    const resizerEdge = position === "left" ? "right-0" : "left-0";

    return (
      <div
        className="relative flex-shrink-0 z-10"
        style={{ width: state.sidebarCollapsed ? "48px" : `${sidebarWidth}px` }}
      >
        <Sidebar
          sidebarPosition={sidebarPosition}
          onToggleSidebarPosition={toggleSidebarPosition}
          onNewConnection={handleNewConnection}
          onEditConnection={handleEditConnection}
          onDeleteConnection={handleDeleteConnection}
          onConnect={handleConnect}
          onDisconnect={handleDisconnectConnection}
          onDiagnostics={handleDiagnostics}
          onSessionDetach={handleSessionDetach}
          onShowPasswordDialog={handleShowPasswordDialog}
          enableConnectionReorder={appSettings.enableConnectionReorder}
          onOpenImport={() => {
            setImportExportInitialTab('import');
            setShowImportExport(true);
          }}
        />
        {!state.sidebarCollapsed && (
          <div
            className={`absolute top-0 ${resizerEdge} w-1 h-full cursor-col-resize hover:w-1.5 bg-gray-700/30 hover:bg-blue-500/60 transition-all duration-150`}
            onMouseDown={handleMouseDown}
          />
        )}
      </div>
    );
  };

  return (
    <div
      className={`h-full text-white flex flex-col overflow-hidden app-shell ${
        appSettings.backgroundGlowEnabled ? "app-glow" : ""
      } ${
        appSettings.windowTransparencyEnabled
          ? "app-transparent bg-transparent"
          : "bg-gray-900"
      } ${!appSettings.animationsEnabled ? "animations-disabled" : ""} ${
        appSettings.reduceMotion ? "reduce-motion" : ""
      }`}
      style={
        {
          "--animation-duration": `${appSettings.animationDuration || 200}ms`,
        } as React.CSSProperties
      }
    >
      {/* Splash Screen */}
      {showSplash && (
        <SplashScreen
          isLoading={!isInitialized}
          onLoadComplete={() => setShowSplash(false)}
        />
      )}
      <AppToolbar
        appSettings={appSettings}
        isAlwaysOnTop={isAlwaysOnTop}
        rdpPanelOpen={rdpPanelOpen}
        showErrorLog={showErrorLog}
        collectionManager={collectionManager}
        connections={state.connections}
        setShowQuickConnect={setShowQuickConnect}
        setShowCollectionSelector={setShowCollectionSelector}
        setShowSettings={setShowSettings}
        setRdpPanelOpen={setRdpPanelOpen}
        setShowInternalProxyManager={setShowInternalProxyManager}
        setShowProxyMenu={setShowProxyMenu}
        setShowShortcutManager={setShowShortcutManager}
        setShowWol={setShowWol}
        setShowBulkSSH={setShowBulkSSH}
        setShowScriptManager={setShowScriptManager}
        setShowMacroManager={setShowMacroManager}
        setShowRecordingManager={setShowRecordingManager}
        setShowPerformanceMonitor={setShowPerformanceMonitor}
        setShowActionLog={setShowActionLog}
        setShowErrorLog={setShowErrorLog}
        handleToggleTransparency={handleToggleTransparency}
        handleToggleAlwaysOnTop={handleToggleAlwaysOnTop}
        handleRepatriateWindow={handleRepatriateWindow}
        handleMinimize={handleMinimize}
        handleMaximize={handleMaximize}
        handleClose={handleClose}
        handleOpenDevtools={handleOpenDevtools}
        handleShowPasswordDialog={handleShowPasswordDialog}
        performCloudSync={performCloudSync}
      />

      <div className="flex flex-1 overflow-hidden" ref={layoutRef}>
        {renderSidebar("left")}

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <SessionTabs
            activeSessionId={activeSessionId}
            onSessionSelect={setActiveSessionId}
            onSessionClose={handleSessionClose}
            onSessionDetach={handleSessionDetach}
            enableReorder={appSettings.enableTabReorder}
            middleClickCloseTab={appSettings.middleClickCloseTab}
          />

          {/* Session viewer */}
          <div className="flex-1 overflow-hidden">
            {visibleSessions.length > 0 ? (
              <TabLayoutManager
                sessions={visibleSessions}
                activeSessionId={activeSessionId}
                layout={tabLayout}
                onLayoutChange={setTabLayout}
                onSessionSelect={setActiveSessionId}
                onSessionClose={handleSessionClose}
                onSessionDetach={handleSessionDetach}
                renderSession={(session) => <SessionViewer session={session} />}
                showTabBar={false}
                middleClickCloseTab={appSettings.middleClickCloseTab}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                {!appSettings.hideQuickStartMessage && (
                  <>
                    <Monitor size={64} className="mb-4" />
                    <h2 className="text-xl font-medium mb-2">
                      {appSettings.welcomeScreenTitle || `Welcome to ${t("app.title")}`}
                    </h2>
                    <p className="text-center max-w-md mb-6 whitespace-pre-wrap">
                      {appSettings.welcomeScreenMessage || 
                        `Manage your remote connections efficiently. Create new connections or select an existing one from the sidebar to get started.`}
                    </p>
                  </>
                )}
                {!appSettings.hideQuickStartButtons && (
                  <div className="flex space-x-4">
                    <button
                      onClick={handleNewConnection}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors flex items-center space-x-2"
                    >
                      <Plus size={16} />
                      <span>{t("connections.new")} Connection</span>
                    </button>
                    <button
                      onClick={() => setShowQuickConnect(true)}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors flex items-center space-x-2"
                    >
                      <Zap size={16} />
                      <span>{t("connections.quickConnect")}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RDP Sessions Panel (right side) - only in panel mode */}
        {rdpPanelOpen && appSettings.rdpSessionDisplayMode === 'panel' && (
          <div
            className="relative flex-shrink-0 z-10 h-full overflow-hidden"
            style={{ width: `${rdpPanelWidth}px` }}
          >
            <RdpSessionPanel
              isVisible={rdpPanelOpen}
              connections={state.connections}
              activeBackendSessionIds={activeRdpBackendIds}
              onClose={() => setRdpPanelOpen(false)}
              onReattachSession={handleReattachRdpSession}
              onDetachToWindow={(sessionId) => {
                const frontendSession = state.sessions.find(
                  s => s.backendSessionId === sessionId || s.id === sessionId
                );
                if (frontendSession) {
                  handleSessionDetach(frontendSession.id);
                }
              }}
              thumbnailsEnabled={appSettings.rdpSessionThumbnailsEnabled}
              thumbnailPolicy={appSettings.rdpSessionThumbnailPolicy}
              thumbnailInterval={appSettings.rdpSessionThumbnailInterval}
            />
            {/* Resize handle on left edge */}
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:w-1.5 bg-gray-700/30 hover:bg-blue-500/60 transition-all duration-150"
              onMouseDown={handleRdpPanelMouseDown}
            />
          </div>
        )}

        {renderSidebar("right")}
      </div>

      <AppDialogs
        appSettings={appSettings}
        showCollectionSelector={showCollectionSelector}
        showConnectionEditor={showConnectionEditor}
        showQuickConnect={showQuickConnect}
        showPasswordDialog={showPasswordDialog}
        showSettings={showSettings}
        showImportExport={showImportExport}
        showPerformanceMonitor={showPerformanceMonitor}
        showActionLog={showActionLog}
        showShortcutManager={showShortcutManager}
        showProxyMenu={showProxyMenu}
        showInternalProxyManager={showInternalProxyManager}
        showWol={showWol}
        showBulkSSH={showBulkSSH}
        showScriptManager={showScriptManager}
        showMacroManager={showMacroManager}
        showRecordingManager={showRecordingManager}
        showDiagnostics={showDiagnostics}
        showErrorLog={showErrorLog}
        rdpPanelOpen={rdpPanelOpen}
        setShowCollectionSelector={setShowCollectionSelector}
        setShowConnectionEditor={setShowConnectionEditor}
        setShowQuickConnect={setShowQuickConnect}
        setShowSettings={setShowSettings}
        setShowImportExport={setShowImportExport}
        setShowPerformanceMonitor={setShowPerformanceMonitor}
        setShowActionLog={setShowActionLog}
        setShowShortcutManager={setShowShortcutManager}
        setShowProxyMenu={setShowProxyMenu}
        setShowInternalProxyManager={setShowInternalProxyManager}
        setShowWol={setShowWol}
        setShowBulkSSH={setShowBulkSSH}
        setShowScriptManager={setShowScriptManager}
        setShowMacroManager={setShowMacroManager}
        setShowRecordingManager={setShowRecordingManager}
        setShowDiagnostics={setShowDiagnostics}
        setShowErrorLog={setShowErrorLog}
        setRdpPanelOpen={setRdpPanelOpen}
        editingConnection={editingConnection}
        passwordDialogMode={passwordDialogMode}
        passwordError={passwordError}
        importExportInitialTab={importExportInitialTab}
        diagnosticsConnection={diagnosticsConnection}
        setDiagnosticsConnection={setDiagnosticsConnection}
        hasStoragePassword={hasStoragePassword}
        dialogState={dialogState}
        closeConfirmDialog={closeConfirmDialog}
        confirmDialog={confirmDialog}
        handlePasswordSubmit={handlePasswordSubmit}
        handlePasswordCancel={handlePasswordCancel}
        handleQuickConnectWithHistory={handleQuickConnectWithHistory}
        clearQuickConnectHistory={clearQuickConnectHistory}
        handleCollectionSelect={handleCollectionSelect}
        handleReattachRdpSession={handleReattachRdpSession}
        handleSessionDetach={handleSessionDetach}
        sessions={state.sessions}
        connections={state.connections}
        activeRdpBackendIds={activeRdpBackendIds}
        settingsManager={settingsManager}
        collectionManager={collectionManager}
      />
    </div>
  );
};

const App: React.FC = () => (
  <ToastProvider>
    <ConnectionProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </ConnectionProvider>
  </ToastProvider>
);

export default App;
