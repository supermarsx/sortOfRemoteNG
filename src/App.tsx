import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  Monitor,
  Zap,
  Terminal,
  Minus,
  Square,
  X,
  Pin,
  Settings,
  Database,
  BarChart3,
  ScrollText,
  Shield,
  Droplet,
  Keyboard,
  Network,
  Power,
  Bug,
  Plus,
  FileCode,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Connection, ConnectionSession, TabLayout } from "./types/connection";
import { GlobalSettings } from "./types/settings";
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
import { ConnectionEditor } from "./components/ConnectionEditor";
import { SessionTabs } from "./components/SessionTabs";
import { SessionViewer } from "./components/SessionViewer";
import { TabLayoutManager } from "./components/TabLayoutManager";
import { QuickConnect } from "./components/QuickConnect";
import { PasswordDialog } from "./components/PasswordDialog";
import { CollectionSelector } from "./components/CollectionSelector";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { PerformanceMonitor } from "./components/PerformanceMonitor";
import { ActionLogViewer } from "./components/ActionLogViewer";
import { ImportExport } from "./components/ImportExport";
import { AutoLockManager } from "./components/AutoLockManager";
import { ShortcutManagerDialog } from "./components/ShortcutManagerDialog";
import { ProxyChainMenu } from "./components/ProxyChainMenu";
import { WOLQuickTool } from "./components/WOLQuickTool";
import { SplashScreen } from "./components/SplashScreen";
import { ErrorLogBar } from "./components/ErrorLogBar";
import { ConnectionDiagnostics } from "./components/ConnectionDiagnostics";
import { BulkSSHCommander } from "./components/BulkSSHCommander";
import { ScriptManager } from "./components/ScriptManager";

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
  const [showWol, setShowWol] = useState(false);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showBulkSSH, setShowBulkSSH] = useState(false);
  const [showScriptManager, setShowScriptManager] = useState(false);
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
  const [isResizing, setIsResizing] = useState(false); // whether sidebar is being resized
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
  const windowSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const sidebarSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastWorkAtRef = useRef<number>(Date.now());
  const hasUnsavedWorkRef = useRef(false);
  const [hasStoragePassword, setHasStoragePassword] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [appReady, setAppReady] = useState(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const closingMainRef = useRef(false);
  const pendingCloseRef = useRef<(() => void) | null>(null);

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

  // Track when app is fully initialized
  useEffect(() => {
    if (isInitialized && !appReady) {
      setAppReady(true);
    }
  }, [isInitialized, appReady]);

  const handleQuickConnectWithHistory = useCallback(
    (payload: {
      hostname: string;
      protocol: string;
      username?: string;
      authType?: "password" | "key";
      password?: string;
      privateKey?: string;
      passphrase?: string;
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

  const handleSessionDetach = useCallback(
    async (sessionId: string) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      const connection = state.connections.find(
        (item) => item.id === session.connectionId,
      );
      const windowLabel = `detached-${session.id}`;

      // Request terminal buffer before detaching
      let terminalBuffer = "";
      try {
        const bufferPromise = new Promise<string>((resolve) => {
          const timeout = setTimeout(() => {
            console.log("Buffer request timed out for detach");
            resolve("");
          }, 1000); // Increased timeout
          
          listen<{ sessionId: string; buffer: string }>("terminal-buffer-response", (event) => {
            if (event.payload.sessionId === sessionId) {
              clearTimeout(timeout);
              console.log("Received buffer for detach:", event.payload.buffer?.length || 0, "chars");
              resolve(event.payload.buffer);
            }
          }).then(unlisten => {
            setTimeout(() => unlisten(), 1200);
          });
        });
        
        console.log("Requesting terminal buffer for detach:", sessionId);
        await emit("request-terminal-buffer", { sessionId });
        terminalBuffer = await bufferPromise;
        console.log("Got terminal buffer for detach:", terminalBuffer?.length || 0, "chars");
      } catch (error) {
        console.warn("Failed to get terminal buffer:", error);
      }

      try {
        const sessionWithBuffer = {
          ...session,
          terminalBuffer,
        };
        const payload = {
          session: sessionWithBuffer,
          connection: connection || null,
          savedAt: Date.now(),
        };
        localStorage.setItem(
          `detached-session-${session.id}`,
          JSON.stringify(payload),
        );
      } catch (error) {
        console.error("Failed to persist detached session payload:", error);
      }

      const url = `/detached?sessionId=${session.id}`;
      const windowTitle = session.name || "Detached Session";
      const isTauri =
        typeof window !== "undefined" &&
        Boolean(
          (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
        );

      if (isTauri) {
        try {
          const existingWindow = await WebviewWindow.getByLabel(windowLabel);
          if (existingWindow) {
            existingWindow.setFocus().catch(() => undefined);
          } else {
            new WebviewWindow(windowLabel, {
              url,
              title: windowTitle,
              width: 1200,
              height: 800,
              resizable: true,
              decorations: false,
            });
          }
        } catch (error) {
          console.error("Failed to detach session window:", error);
        }
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }

      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          ...session,
          layout: {
            x: session.layout?.x ?? 0,
            y: session.layout?.y ?? 0,
            width: session.layout?.width ?? 100,
            height: session.layout?.height ?? 100,
            zIndex: session.layout?.zIndex ?? 1,
            isDetached: true,
            windowId: windowLabel,
          },
        },
      });

      if (activeSessionId === sessionId) {
        const remaining = visibleSessions.filter(
          (item) => item.id !== sessionId,
        );
        setActiveSessionId(remaining[0]?.id);
      }
    },
    [
      activeSessionId,
      dispatch,
      setActiveSessionId,
      state.connections,
      state.sessions,
      visibleSessions,
    ],
  );

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

  const isWindowPermissionError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("not allowed") ||
      message.includes("allow-set-size") ||
      message.includes("allow-set-position")
    );
  }, []);

  const closeConfirmDialog = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
  };

  const toggleSidebarPosition = () => {
    setSidebarPosition((prev) => (prev === "left" ? "right" : "left"));
  };

  // Sidebar resize handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const layoutRect = layoutRef.current?.getBoundingClientRect();
      const layoutLeft = layoutRect?.left ?? 0;
      const layoutWidth = layoutRect?.width ?? window.innerWidth;
      const newWidth =
        sidebarPosition === "left"
          ? Math.max(200, Math.min(600, e.clientX - layoutLeft))
          : Math.max(200, Math.min(600, layoutLeft + layoutWidth - e.clientX));
      setSidebarWidth(newWidth);
    },
    [isResizing, sidebarPosition],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

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

  useEffect(() => {
    const tooltip = document.createElement("div");
    tooltip.className = "app-tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
    tooltipRef.current = tooltip;

    let activeTarget: HTMLElement | null = null;

    const positionTooltip = (target: HTMLElement) => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();
      const spacing = 8;

      let top = rect.top - tooltipRect.height - spacing;
      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;

      if (top < spacing) {
        top = rect.bottom + spacing;
      }
      left = Math.min(
        Math.max(spacing, left),
        window.innerWidth - tooltipRect.width - spacing,
      );
      top = Math.min(
        Math.max(spacing, top),
        window.innerHeight - tooltipRect.height - spacing,
      );

      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
    };

    const showTooltip = (target: HTMLElement) => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      const text = target.getAttribute("data-tooltip");
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.classList.add("is-visible");
      tooltipEl.style.display = "block";
      positionTooltip(target);
    };

    const hideTooltip = () => {
      const tooltipEl = tooltipRef.current;
      if (!tooltipEl) return;
      tooltipEl.classList.remove("is-visible");
      tooltipEl.style.display = "none";
    };

    const handlePointerOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tooltip]",
      );
      if (!target) return;
      if (activeTarget === target) return;
      activeTarget = target;
      showTooltip(target);
    };

    const handlePointerOut = (event: MouseEvent) => {
      if (!activeTarget) return;
      const related = event.relatedTarget as HTMLElement | null;
      if (related && activeTarget.contains(related)) {
        return;
      }
      activeTarget = null;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-tooltip]",
      );
      if (!target) return;
      activeTarget = target;
      showTooltip(target);
    };

    const handleFocusOut = () => {
      activeTarget = null;
      hideTooltip();
    };

    const handleWindowChange = () => {
      if (activeTarget) {
        positionTooltip(activeTarget);
      }
    };

    document.addEventListener("mouseover", handlePointerOver);
    document.addEventListener("mouseout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      document.removeEventListener("mouseover", handlePointerOver);
      document.removeEventListener("mouseout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      tooltipRef.current?.remove();
      tooltipRef.current = null;
    };
  }, []);

  useEffect(() => {
    const window = getCurrentWindow();
    window.isAlwaysOnTop().then(setIsAlwaysOnTop).catch(console.error);
  }, []);

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

  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;
    
    listen<{ sessionId?: string }>("detached-session-closed", (event) => {
      const sessionId = event.payload?.sessionId;
      if (!sessionId) return;
      handleSessionClose(sessionId).catch(console.error);
    })
      .then((stop) => {
        if (typeof stop === 'function') {
          if (isCancelled) {
            try { stop(); } catch { /* ignore */ }
          } else {
            unlistenFn = stop;
          }
        }
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
      try { unlistenFn?.(); } catch { /* ignore */ }
    };
  }, [handleSessionClose]);

  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__);
    if (!isTauri) return;

    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;
    
    listen<{ sessionId?: string; terminalBuffer?: string }>("detached-session-reattach", (event) => {
      const sessionId = event.payload?.sessionId;
      if (!sessionId) return;
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          ...session,
          terminalBuffer: event.payload.terminalBuffer || session.terminalBuffer,
          layout: {
            x: session.layout?.x ?? 0,
            y: session.layout?.y ?? 0,
            width: session.layout?.width ?? 800,
            height: session.layout?.height ?? 600,
            zIndex: session.layout?.zIndex ?? 1,
            isDetached: false,
            windowId: session.layout?.windowId,
          },
        },
      });
      setActiveSessionId(sessionId);
    })
      .then((stop) => {
        if (typeof stop === 'function') {
          if (isCancelled) {
            try { stop(); } catch { /* ignore */ }
          } else {
            unlistenFn = stop;
          }
        }
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
      try { unlistenFn?.(); } catch { /* ignore */ }
    };
  }, [dispatch, setActiveSessionId, state.sessions]);

  useEffect(() => {
    if (!appSettings) return;
    const window = getCurrentWindow();
    const targetOpacity = appSettings.windowTransparencyEnabled
      ? Math.min(1, Math.max(0, appSettings.windowTransparencyOpacity || 1))
      : 1;
    const root = document.documentElement;
    
    // Get the current theme colors from CSS variables (set by ThemeManager)
    const computedStyle = getComputedStyle(root);
    const background = computedStyle.getPropertyValue('--color-background').trim() || '#111827';
    const surface = computedStyle.getPropertyValue('--color-surface').trim() || '#1f2937';
    const border = computedStyle.getPropertyValue('--color-border').trim() || '#374151';
    
    // Helper to convert hex to rgba
    const hexToRgba = (hex: string, alpha: number): string => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (result) {
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
      return hex;
    };
    
    // Helper to extract RGB values from color
    const extractRgb = (color: string): { r: number; g: number; b: number } => {
      const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
      if (hex) {
        return {
          r: parseInt(hex[1], 16),
          g: parseInt(hex[2], 16),
          b: parseInt(hex[3], 16),
        };
      }
      const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (rgb) {
        return {
          r: parseInt(rgb[1]),
          g: parseInt(rgb[2]),
          b: parseInt(rgb[3]),
        };
      }
      return { r: 17, g: 24, b: 39 };
    };
    
    const alpha = appSettings.windowTransparencyEnabled ? targetOpacity : 1;
    
    // Apply transparency to theme-derived colors
    const bgRgb = extractRgb(background);
    const surfaceRgb = extractRgb(surface);
    const borderRgb = extractRgb(border);
    
    // Create shades based on theme background color
    root.style.setProperty("--app-surface-900", `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`);
    root.style.setProperty("--app-surface-800", `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, ${alpha})`);
    root.style.setProperty("--app-surface-700", `rgba(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b}, ${alpha})`);
    
    // Lighter shades (derived from surface color)
    root.style.setProperty("--app-surface-600", `rgba(${Math.min(255, surfaceRgb.r + 20)}, ${Math.min(255, surfaceRgb.g + 20)}, ${Math.min(255, surfaceRgb.b + 20)}, ${alpha})`);
    root.style.setProperty("--app-surface-500", `rgba(${Math.min(255, surfaceRgb.r + 40)}, ${Math.min(255, surfaceRgb.g + 40)}, ${Math.min(255, surfaceRgb.b + 40)}, ${alpha})`);
    
    // Darker shades (derived from background color)
    root.style.setProperty("--app-slate-950", `rgba(${Math.max(0, bgRgb.r - 15)}, ${Math.max(0, bgRgb.g - 18)}, ${Math.max(0, bgRgb.b - 16)}, ${alpha})`);
    root.style.setProperty("--app-slate-900", `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`);
    root.style.setProperty("--app-slate-800", `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, ${alpha})`);
    root.style.setProperty("--app-slate-700", `rgba(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b}, ${alpha})`);
    
    document.documentElement.style.backgroundColor =
      appSettings.windowTransparencyEnabled ? "transparent" : "";
    document.body.style.backgroundColor = appSettings.windowTransparencyEnabled
      ? "transparent"
      : "";
    const setBackgroundColor = window.setBackgroundColor;
    if (typeof setBackgroundColor === "function") {
      const alpha = Math.round(255 * targetOpacity);
      setBackgroundColor([bgRgb.r, bgRgb.g, bgRgb.b, alpha]).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error("Failed to set window background color:", error);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appSettings?.windowTransparencyEnabled,
    appSettings?.windowTransparencyOpacity,
    appSettings?.theme,
    appSettings?.colorScheme,
    isWindowPermissionError,
  ]);

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
        if (closingMainRef.current) return;
        event.preventDefault();
        
        // Check if we should warn the user
        const settings = settingsManager.getSettings();
        const hasActiveSessions = state.sessions.length > 0;
        
        if (settings.warnOnClose && hasActiveSessions) {
          // Store the close function and show confirmation dialog
          pendingCloseRef.current = performClose;
          setDialogState({
            isOpen: true,
            message: t("dialogs.confirmExit", "You have active sessions. Are you sure you want to close?"),
            onConfirm: () => {
              pendingCloseRef.current?.();
              pendingCloseRef.current = null;
            },
            onCancel: () => {
              pendingCloseRef.current = null;
            },
          });
        } else {
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

  useEffect(() => {
    if (!appSettings) return;

    if (appSettings.persistSidebarWidth && appSettings.sidebarWidth) {
      setSidebarWidth(appSettings.sidebarWidth);
    }

    if (appSettings.persistSidebarPosition && appSettings.sidebarPosition) {
      setSidebarPosition(appSettings.sidebarPosition);
    }

    if (
      appSettings.persistSidebarCollapsed &&
      typeof appSettings.sidebarCollapsed === "boolean"
    ) {
      dispatch({
        type: "SET_SIDEBAR_COLLAPSED",
        payload: appSettings.sidebarCollapsed,
      });
    }
  }, [appSettings, dispatch]);

  useEffect(() => {
    if (!isInitialized) return;

    const window = getCurrentWindow();

    // Minimum window size constraints
    const MIN_WIDTH = 800;
    const MIN_HEIGHT = 600;

    if (appSettings.persistWindowSize && appSettings.windowSize) {
      const { width, height } = appSettings.windowSize;
      // Validate and enforce minimum size
      const validWidth = Math.max(width || MIN_WIDTH, MIN_WIDTH);
      const validHeight = Math.max(height || MIN_HEIGHT, MIN_HEIGHT);
      window.setSize(new LogicalSize(validWidth, validHeight)).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error(error);
        }
      });
    }

    if (appSettings.persistWindowPosition && appSettings.windowPosition) {
      const { x, y } = appSettings.windowPosition;
      // Allow negative coordinates for multi-monitor setups
      const validX = x ?? 0;
      const validY = y ?? 0;
      window.setPosition(new LogicalPosition(validX, validY)).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error(error);
        }
      });
    }
  }, [
    appSettings.persistWindowSize,
    appSettings.persistWindowPosition,
    appSettings.windowSize,
    appSettings.windowPosition,
    isInitialized,
    isWindowPermissionError,
  ]);

  useEffect(() => {
    if (!isInitialized) return;

    const window = getCurrentWindow();
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    const saveWindowState = async () => {
      try {
        const [size, position, scaleFactor] = await Promise.all([
          window.innerSize(),
          window.outerPosition(),
          window.scaleFactor(),
        ]);

        const updates: Partial<GlobalSettings> = {};
        const isMaximized = await window.isMaximized();
        if (isMaximized) {
          return;
        }
        if (appSettings.persistWindowSize) {
          const logicalSize = size.toLogical(scaleFactor);
          updates.windowSize = {
            width: logicalSize.width,
            height: logicalSize.height,
          };
        }
        if (appSettings.persistWindowPosition) {
          const logicalPosition = position.toLogical(scaleFactor);
          updates.windowPosition = {
            x: logicalPosition.x,
            y: logicalPosition.y,
          };
        }

        if (Object.keys(updates).length > 0) {
          await settingsManager.saveSettings(updates, { silent: true });
        }
      } catch (error) {
        console.error("Failed to persist window state:", error);
      }
    };

    const queueSave = () => {
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
      }
      windowSaveTimeout.current = setTimeout(() => {
        saveWindowState().catch(console.error);
      }, 500);
    };

    if (appSettings.persistWindowSize && (window as any).onResized) {
      window
        .onResized(() => {
          queueSave();
        })
        .then((unlisten) => {
          unlistenResize = unlisten;
        })
        .catch(console.error);
    }

    if (appSettings.persistWindowPosition && (window as any).onMoved) {
      window
        .onMoved(() => {
          queueSave();
        })
        .then((unlisten) => {
          unlistenMove = unlisten;
        })
        .catch(console.error);
    }

    return () => {
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
      }
      if (unlistenResize) {
        unlistenResize();
      }
      if (unlistenMove) {
        unlistenMove();
      }
    };
  }, [
    appSettings.persistWindowSize,
    appSettings.persistWindowPosition,
    isInitialized,
    settingsManager,
  ]);

  useEffect(() => {
    if (!appSettings) return;

    if (
      !appSettings.persistSidebarWidth &&
      !appSettings.persistSidebarPosition &&
      !appSettings.persistSidebarCollapsed
    ) {
      return;
    }

    if (sidebarSaveTimeout.current) {
      clearTimeout(sidebarSaveTimeout.current);
    }

    sidebarSaveTimeout.current = setTimeout(() => {
      const updates: Partial<GlobalSettings> = {};
      if (appSettings.persistSidebarWidth) {
        updates.sidebarWidth = sidebarWidth;
      }
      if (appSettings.persistSidebarPosition) {
        updates.sidebarPosition = sidebarPosition;
      }
      if (appSettings.persistSidebarCollapsed) {
        updates.sidebarCollapsed = state.sidebarCollapsed;
      }

      if (Object.keys(updates).length > 0) {
        settingsManager.saveSettings(updates, { silent: true }).catch(console.error);
      }
    }, 300);

    return () => {
      if (sidebarSaveTimeout.current) {
        clearTimeout(sidebarSaveTimeout.current);
      }
    };
  }, [
    appSettings,
    sidebarWidth,
    sidebarPosition,
    state.sidebarCollapsed,
    settingsManager,
  ]);

  const handleMinimize = async () => {
    const window = getCurrentWindow();
    await window.minimize();
  };

  const handleToggleTransparency = async () => {
    const nextValue = !appSettings.windowTransparencyEnabled;
    await settingsManager.saveSettings({
      windowTransparencyEnabled: nextValue,
    }, { silent: true });
  };

  const handleToggleAlwaysOnTop = async () => {
    const window = getCurrentWindow();
    const nextValue = !isAlwaysOnTop;
    await window.setAlwaysOnTop(nextValue);
    setIsAlwaysOnTop(nextValue);
  };

  const handleMaximize = async () => {
    const window = getCurrentWindow();
    const isMaximized = await window.isMaximized();
    if (isMaximized) {
      await window.unmaximize();
      if (appSettings.persistWindowSize && appSettings.windowSize) {
        const { width, height } = appSettings.windowSize;
        await window.setSize(new LogicalSize(width, height));
      }
      return;
    }
    await window.maximize();
  };

  const handleOpenDevtools = async () => {
    await invoke("open_devtools");
  };

  const handleClose = async () => {
    const window = getCurrentWindow();
    await window.close();
  };

  const renderSidebar = (position: "left" | "right") => {
    if (sidebarPosition !== position) return null;
    const resizerEdge = position === "left" ? "right-0" : "left-0";

    return (
      <div
        className="relative flex-shrink-0"
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
      {/* Top bar */}
      <div
        className="h-12 app-bar border-b flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-blue-400" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              {t("app.title")}
            </div>
            <div className="text-[10px] text-gray-500 uppercase">
              {t("app.subtitle")}
            </div>
          </div>
          {collectionManager.getCurrentCollection() && (
            <span className="text-[10px] text-blue-300 bg-blue-900/30 px-2 py-1 rounded">
              {collectionManager.getCurrentCollection()?.name}
            </span>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center space-x-1">
          {(appSettings.showTransparencyToggle ?? true) && (
            <button
              onClick={handleToggleTransparency}
              className="app-bar-button p-2"
              data-tooltip={
                appSettings.windowTransparencyEnabled
                  ? "Disable transparency"
                  : "Enable transparency"
              }
            >
              {appSettings.windowTransparencyEnabled ? (
                <Droplet size={14} />
              ) : (
                <Droplet size={14} className="opacity-40" />
              )}
            </button>
          )}
          <button
            onClick={handleToggleAlwaysOnTop}
            className="app-bar-button p-2"
            title={isAlwaysOnTop ? "Unpin window" : "Pin window"}
          >
            <Pin
              size={14}
              className={isAlwaysOnTop ? "rotate-45 text-blue-400" : ""}
            />
          </button>
          <button
            onClick={handleMinimize}
            className="app-bar-button p-2"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="app-bar-button p-2"
            title="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="app-bar-button app-bar-button-danger p-2"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Secondary actions bar */}
      <div className="h-9 app-bar-secondary border-b flex items-center justify-between px-3 select-none">
        <div className="flex items-center space-x-1">
          {appSettings.showQuickConnectIcon && (
            <button
              onClick={() => setShowQuickConnect(true)}
              className="app-bar-button p-2"
              title={t("connections.quickConnect")}
            >
              <Zap size={14} />
            </button>
          )}
          {appSettings.showCollectionSwitcherIcon && (
            <button
              onClick={() => setShowCollectionSelector(true)}
              className="app-bar-button p-2"
              title="Switch Collection"
            >
              <Database size={14} />
            </button>
          )}
          {appSettings.showSettingsIcon && (
            <button
              onClick={() => setShowSettings(true)}
              className="app-bar-button p-2"
              title="Settings"
            >
              <Settings size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1">
          {appSettings.showProxyMenuIcon && (
            <button
              onClick={() => setShowProxyMenu(true)}
              className="app-bar-button p-2"
              title="Proxy & VPN"
            >
              <Network size={14} />
            </button>
          )}
          {appSettings.showShortcutManagerIcon && (
            <button
              onClick={() => setShowShortcutManager(true)}
              className="app-bar-button p-2"
              title="Shortcut Manager"
            >
              <Keyboard size={14} />
            </button>
          )}
          {appSettings.showWolIcon && (
            <button
              onClick={() => setShowWol(true)}
              className="app-bar-button p-2"
              title="Wake-on-LAN"
            >
              <Power size={14} />
            </button>
          )}
          {appSettings.showBulkSSHIcon && (
            <button
              onClick={() => setShowBulkSSH(true)}
              className="app-bar-button p-2"
              title={t('bulkSsh.title', 'Bulk SSH Commander')}
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showScriptManagerIcon && (
            <button
              onClick={() => setShowScriptManager(true)}
              className="app-bar-button p-2"
              title={t('scriptManager.title', 'Script Manager')}
            >
              <FileCode size={14} />
            </button>
          )}
          {appSettings.showPerformanceMonitorIcon && (
            <button
              onClick={() => setShowPerformanceMonitor(true)}
              className="app-bar-button p-2"
              title="Performance Monitor"
            >
              <BarChart3 size={14} />
            </button>
          )}
          {appSettings.showActionLogIcon && (
            <button
              onClick={() => setShowActionLog(true)}
              className="app-bar-button p-2"
              title="Action Log"
            >
              <ScrollText size={14} />
            </button>
          )}
          {appSettings.showErrorLogBar && (
            <button
              onClick={() => setShowErrorLog(!showErrorLog)}
              className={`app-bar-button p-2 ${showErrorLog ? "text-red-400" : ""}`}
              title="Toggle Error Log"
            >
              <Bug size={14} />
            </button>
          )}
          {appSettings.showDevtoolsIcon && (
            <button
              onClick={handleOpenDevtools}
              className="app-bar-button p-2"
              title="Open dev console"
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showSecurityIcon && (
            <button
              onClick={handleShowPasswordDialog}
              className="app-bar-button p-2"
              title="Security"
            >
              <Shield size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" ref={layoutRef}>
        {renderSidebar("left")}

        <div className="flex-1 flex flex-col">
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
                      Welcome to {t("app.title")}
                    </h2>
                    <p className="text-center max-w-md mb-6">
                      Manage your remote connections efficiently. Create new
                      connections or select an existing one from the sidebar to get
                      started.
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

        {renderSidebar("right")}
      </div>

      {appSettings.autoLock.enabled && hasStoragePassword && (
        <AutoLockManager
          config={appSettings.autoLock}
          onConfigChange={(config) =>
            settingsManager
              .saveSettings({ autoLock: config }, { silent: true })
              .catch(console.error)
          }
          onLock={() => {
            settingsManager.logAction(
              "info",
              "Auto lock",
              undefined,
              "Session locked due to inactivity",
            );
          }}
        />
      )}

      {/* Dialogs */}
      <CollectionSelector
        isOpen={showCollectionSelector}
        onCollectionSelect={handleCollectionSelect}
        onClose={() => setShowCollectionSelector(false)}
      />

      <ConnectionEditor
        connection={editingConnection}
        isOpen={showConnectionEditor}
        onClose={() => setShowConnectionEditor(false)}
      />

      <QuickConnect
        isOpen={showQuickConnect}
        onClose={() => setShowQuickConnect(false)}
        historyEnabled={appSettings.quickConnectHistoryEnabled}
        history={appSettings.quickConnectHistory ?? []}
        onClearHistory={clearQuickConnectHistory}
        onConnect={handleQuickConnectWithHistory}
      />

      <PasswordDialog
        isOpen={showPasswordDialog}
        mode={passwordDialogMode}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
        error={passwordError}
        noCollectionSelected={!collectionManager.getCurrentCollection()}
      />

      <ConfirmDialog
        isOpen={dialogState.isOpen}
        message={dialogState.message}
        onConfirm={() => {
          dialogState.onConfirm();
          closeConfirmDialog();
        }}
        onCancel={
          dialogState.onCancel
            ? () => {
                dialogState.onCancel!();
                closeConfirmDialog();
              }
            : closeConfirmDialog
        }
      />

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <ImportExport
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
        initialTab={importExportInitialTab}
      />

      <PerformanceMonitor
        isOpen={showPerformanceMonitor}
        onClose={() => setShowPerformanceMonitor(false)}
      />

      <ActionLogViewer
        isOpen={showActionLog}
        onClose={() => setShowActionLog(false)}
      />

      <ShortcutManagerDialog
        isOpen={showShortcutManager}
        onClose={() => setShowShortcutManager(false)}
      />

      <ProxyChainMenu
        isOpen={showProxyMenu}
        onClose={() => setShowProxyMenu(false)}
      />

      <WOLQuickTool isOpen={showWol} onClose={() => setShowWol(false)} />

      <BulkSSHCommander
        isOpen={showBulkSSH}
        onClose={() => setShowBulkSSH(false)}
      />

      <ScriptManager
        isOpen={showScriptManager}
        onClose={() => setShowScriptManager(false)}
      />

      {showDiagnostics && diagnosticsConnection && (
        <ConnectionDiagnostics
          connection={diagnosticsConnection}
          onClose={() => {
            setShowDiagnostics(false);
            setDiagnosticsConnection(null);
          }}
        />
      )}

      {/* Error Log Bar - togglable console error catcher */}
      <ErrorLogBar
        isVisible={showErrorLog || appSettings.showErrorLogBar}
        onToggle={() => setShowErrorLog(!showErrorLog)}
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
