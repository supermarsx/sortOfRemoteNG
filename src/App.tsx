import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Monitor,
  Zap,
  Globe,
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
  FileText,
  Droplet,
  DropletOff,
  Keyboard,
  Network,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Connection } from "./types/connection";
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
import { Sidebar } from "./components/Sidebar";
import { ConnectionEditor } from "./components/ConnectionEditor";
import { SessionTabs } from "./components/SessionTabs";
import { SessionViewer } from "./components/SessionViewer";
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
import { loadLanguage } from "./i18n";

/**
 * Core application component responsible for rendering the main layout and
 * managing global application state.
 */
const AppContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { state, dispatch, loadData, saveData } = useConnections();
  const settingsManager = SettingsManager.getInstance();
  const [editingConnection, setEditingConnection] = useState<Connection | undefined>(
    undefined,
  ); // connection currently being edited
  const [showConnectionEditor, setShowConnectionEditor] = useState(false); // connection editor visibility
  const [showQuickConnect, setShowQuickConnect] = useState(false); // quick connect dialog visibility
  const [showPasswordDialog, setShowPasswordDialog] = useState(false); // password dialog visibility
  const [showCollectionSelector, setShowCollectionSelector] = useState(false); // collection selector visibility
  const [showSettings, setShowSettings] = useState(false); // settings dialog visibility
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showShortcutManager, setShowShortcutManager] = useState(false);
  const [showProxyMenu, setShowProxyMenu] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock"
  >("setup"); // current mode for password dialog
  const [passwordError, setPasswordError] = useState(""); // password dialog error message
  const [sidebarWidth, setSidebarWidth] = useState(320); // sidebar width in pixels
  const [isResizing, setIsResizing] = useState(false); // whether sidebar is being resized
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left'); // sidebar position
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
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [appSettings, setAppSettings] = useState(() => settingsManager.getSettings());
  const windowSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const sidebarSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastWorkAtRef = useRef<number>(Date.now());
  const hasUnsavedWorkRef = useRef(false);
  const [hasStoragePassword, setHasStoragePassword] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const statusChecker = StatusChecker.getInstance();
  const collectionManager = CollectionManager.getInstance();

  const {
    activeSessionId,
    setActiveSessionId,
    activeSession,
    handleConnect,
    handleQuickConnect,
    handleSessionClose,
    confirmDialog,
  } = useSessionManager();

  const { isInitialized } = useAppLifecycle({
    handleConnect,
    setShowCollectionSelector,
    setShowPasswordDialog,
    setPasswordDialogMode,
  });

  const languageOptions = [
    { value: "en", label: "English" },
    { value: "es", label: "Espanol (Espana)" },
    { value: "fr", label: "Francais (France)" },
    { value: "de", label: "Deutsch (Deutschland)" },
    { value: "pt-PT", label: "Portugues (Portugal)" },
  ];

  const handleLanguageChange = async (language: string) => {
    try {
      if (language !== "en") {
        await loadLanguage(language);
      }
      await i18n.changeLanguage(language);
      await settingsManager.saveSettings({ language });
    } catch (error) {
      console.error("Failed to change language:", error);
    } finally {
      setShowLanguageMenu(false);
    }
  };

  /**
   * Select a collection and load its data, handling common errors.
   *
   * @param collectionId - ID of the collection to select.
   * @param password - Optional password for encrypted collections.
   */
  const handleCollectionSelect = async (
    collectionId: string,
    password?: string,
  ): Promise<void> => {
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
  };

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

  const showConfirm = (message: string, onConfirm: () => void, onCancel?: () => void) => {
    setDialogState({
      isOpen: true,
      message,
      onConfirm,
      onCancel,
    });
  };

  const showAlert = (message: string) => {
    setDialogState({
      isOpen: true,
      message,
      onConfirm: () => setDialogState(prev => ({ ...prev, isOpen: false })),
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
    setDialogState(prev => ({ ...prev, isOpen: false }));
  };

  const toggleSidebarPosition = () => {
    setSidebarPosition(prev => (prev === 'left' ? 'right' : 'left'));
  };

  // Sidebar resize handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const layoutRect = layoutRef.current?.getBoundingClientRect();
    const layoutLeft = layoutRect?.left ?? 0;
    const layoutWidth = layoutRect?.width ?? window.innerWidth;
    const newWidth = sidebarPosition === 'left' 
      ? Math.max(200, Math.min(600, e.clientX - layoutLeft))
      : Math.max(200, Math.min(600, layoutLeft + layoutWidth - e.clientX));
    setSidebarWidth(newWidth);
  }, [isResizing, sidebarPosition]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
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
    if (!showLanguageMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target as Node)) {
        setShowLanguageMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showLanguageMenu]);

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
    const intervalMs = Math.max(1, appSettings.autoSaveIntervalMinutes || 1) * 60 * 1000;

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
    root.style.setProperty("--app-glow-color", appSettings.backgroundGlowColor || "#2563eb");
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
    appSettings.backgroundGlowOpacity,
    appSettings.backgroundGlowRadius,
  ]);

  useEffect(() => {
    const tooltip = document.createElement("div");
    tooltip.className = "app-tooltip";
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
    window.isAlwaysOnTop()
      .then(setIsAlwaysOnTop)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!appSettings) return;
    const window = getCurrentWindow();
    const targetOpacity = appSettings.windowTransparencyEnabled
      ? Math.min(1, Math.max(0.4, appSettings.windowTransparencyOpacity || 1))
      : 1;
    window.setOpacity(targetOpacity).catch((error) => {
      if (!isWindowPermissionError(error)) {
        console.error("Failed to set window opacity:", error);
      }
    });
  }, [
    appSettings,
    appSettings.windowTransparencyEnabled,
    appSettings.windowTransparencyOpacity,
    isWindowPermissionError,
  ]);

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
      dispatch({ type: "SET_SIDEBAR_COLLAPSED", payload: appSettings.sidebarCollapsed });
    }
  }, [appSettings, dispatch]);

  useEffect(() => {
    if (!isInitialized) return;

    const window = getCurrentWindow();

    if (appSettings.persistWindowSize && appSettings.windowSize) {
      const { width, height } = appSettings.windowSize;
      window.setSize(new LogicalSize(width, height)).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error(error);
        }
      });
    }

    if (appSettings.persistWindowPosition && appSettings.windowPosition) {
      const { x, y } = appSettings.windowPosition;
      window.setPosition(new LogicalPosition(x, y)).catch((error) => {
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
        if (appSettings.persistWindowSize) {
          const logicalSize = size.toLogical(scaleFactor);
          updates.windowSize = { width: logicalSize.width, height: logicalSize.height };
        }
        if (appSettings.persistWindowPosition) {
          const logicalPosition = position.toLogical(scaleFactor);
          updates.windowPosition = { x: logicalPosition.x, y: logicalPosition.y };
        }

        if (Object.keys(updates).length > 0) {
          await settingsManager.saveSettings(updates);
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
      window.onResized(() => {
        queueSave();
      }).then((unlisten) => {
        unlistenResize = unlisten;
      }).catch(console.error);
    }

    if (appSettings.persistWindowPosition && (window as any).onMoved) {
      window.onMoved(() => {
        queueSave();
      }).then((unlisten) => {
        unlistenMove = unlisten;
      }).catch(console.error);
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
        settingsManager.saveSettings(updates).catch(console.error);
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
    await settingsManager.saveSettings({ windowTransparencyEnabled: nextValue });
  };

  const handleToggleAlwaysOnTop = async () => {
    const window = getCurrentWindow();
    const nextValue = !isAlwaysOnTop;
    await window.setAlwaysOnTop(nextValue);
    setIsAlwaysOnTop(nextValue);
  };

  const handleMaximize = async () => {
    const window = getCurrentWindow();
    await window.toggleMaximize();
  };

  const handleOpenDevtools = async () => {
    await invoke("open_devtools");
  };

  const handleClose = async () => {
    const window = getCurrentWindow();
    await window.close();
  };

  const renderSidebar = (position: 'left' | 'right') => {
    if (sidebarPosition !== position) return null;
    const resizerEdge = position === 'left' ? 'right-0' : 'left-0';

    return (
      <div
        className="relative flex-shrink-0"
        style={{ width: state.sidebarCollapsed ? '48px' : `${sidebarWidth}px` }}
      >
        <Sidebar
          sidebarPosition={sidebarPosition}
          onToggleSidebarPosition={toggleSidebarPosition}
          onNewConnection={handleNewConnection}
          onEditConnection={handleEditConnection}
          onDeleteConnection={handleDeleteConnection}
          onConnect={handleConnect}
          onShowPasswordDialog={handleShowPasswordDialog}
          enableConnectionReorder={appSettings.enableConnectionReorder}
        />
        {!state.sidebarCollapsed && (
          <div
            className={`absolute top-0 ${resizerEdge} w-2 h-full cursor-col-resize bg-gray-700/50 hover:bg-blue-500 transition-all duration-200 group`}
            onMouseDown={handleMouseDown}
          >
            <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-0.5 bg-gray-500 group-hover:bg-blue-400 transition-colors duration-200"></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`h-full bg-gray-900 text-white flex flex-col overflow-hidden app-shell ${
        appSettings.backgroundGlowEnabled ? "app-glow" : ""
      }`}
    >
      {!isInitialized && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="text-white">Initializing...</div></div>}
      {/* Top bar */}
      <div
        className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 select-none"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-3">
          <Monitor size={18} className="text-blue-400" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">{t("app.title")}</div>
            <div className="text-[10px] text-gray-500 uppercase">{t("app.subtitle")}</div>
          </div>
          {collectionManager.getCurrentCollection() && (
            <span className="text-[10px] text-blue-300 bg-blue-900/30 px-2 py-1 rounded">
              {collectionManager.getCurrentCollection()?.name}
            </span>
          )}
        </div>

        {/* Window Controls */}
        <div className="flex items-center space-x-1">
          <button
            onClick={handleToggleTransparency}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={appSettings.windowTransparencyEnabled ? "Disable transparency" : "Enable transparency"}
          >
            {appSettings.windowTransparencyEnabled ? <Droplet size={14} /> : <DropletOff size={14} />}
          </button>
          <button
            onClick={handleToggleAlwaysOnTop}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title={isAlwaysOnTop ? "Unpin window" : "Pin window"}
          >
            <Pin size={14} className={isAlwaysOnTop ? "rotate-45 text-blue-400" : ""} />
          </button>
          <button
            onClick={handleMinimize}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-red-600 rounded transition-colors text-gray-400 hover:text-white"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Secondary actions bar */}
      <div className="h-9 bg-gray-800/80 border-b border-gray-700 flex items-center justify-between px-3 select-none">
        <div className="flex items-center space-x-1">
          {appSettings.showQuickConnectIcon && (
            <button
              onClick={() => setShowQuickConnect(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title={t("connections.quickConnect")}
            >
              <Zap size={14} />
            </button>
          )}
          {appSettings.showCollectionSwitcherIcon && (
            <button
              onClick={() => setShowCollectionSelector(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Switch Collection"
            >
              <Database size={14} />
            </button>
          )}
          {appSettings.showImportExportIcon && (
            <button
              onClick={() => setShowImportExport(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Import/Export"
            >
              <FileText size={14} />
            </button>
          )}
          {appSettings.showSettingsIcon && (
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
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
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Proxy & VPN"
            >
              <Network size={14} />
            </button>
          )}
          {appSettings.showShortcutManagerIcon && (
            <button
              onClick={() => setShowShortcutManager(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Shortcut Manager"
            >
              <Keyboard size={14} />
            </button>
          )}
          {appSettings.showPerformanceMonitorIcon && (
            <button
              onClick={() => setShowPerformanceMonitor(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Performance Monitor"
            >
              <BarChart3 size={14} />
            </button>
          )}
          {appSettings.showActionLogIcon && (
            <button
              onClick={() => setShowActionLog(true)}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Action Log"
            >
              <ScrollText size={14} />
            </button>
          )}
          {appSettings.showDevtoolsIcon && (
            <button
              onClick={handleOpenDevtools}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Open dev console"
            >
              <Terminal size={14} />
            </button>
          )}
          {appSettings.showSecurityIcon && (
            <button
              onClick={handleShowPasswordDialog}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
              title="Security"
            >
              <Shield size={14} />
            </button>
          )}
          {appSettings.showLanguageSelectorIcon && (
            <div className="relative" ref={languageMenuRef}>
              <button
                onClick={() => setShowLanguageMenu((prev) => !prev)}
                className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-300 hover:text-white"
                title="Change language"
              >
                <Globe size={14} />
              </button>
              {showLanguageMenu && (
                <div className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg py-2 z-20">
                  {languageOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        handleLanguageChange(option.value);
                      }}
                      className={`flex items-center w-full px-3 py-2 text-sm transition-colors ${
                        i18n.language === option.value
                          ? "text-white bg-blue-700/40"
                          : "text-gray-200 hover:bg-gray-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" ref={layoutRef}>
        {renderSidebar('left')}

        <div className="flex-1 flex flex-col">
          <SessionTabs
            activeSessionId={activeSessionId}
            onSessionSelect={setActiveSessionId}
            onSessionClose={handleSessionClose}
            enableReorder={appSettings.enableTabReorder}
          />

          {/* Session viewer */}
          <div className="flex-1 overflow-hidden">
            {activeSession ? (
              <SessionViewer session={activeSession} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Monitor size={64} className="mb-4" />
                <h2 className="text-xl font-medium mb-2">
                  Welcome to {t("app.title")}
                </h2>
                <p className="text-center max-w-md mb-6">
                  Manage your remote connections efficiently. Create new
                  connections or select an existing one from the sidebar to get
                  started.
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={handleNewConnection}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    {t("connections.new")} Connection
                  </button>
                  <button
                    onClick={() => setShowQuickConnect(true)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
                  >
                    {t("connections.quickConnect")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      {renderSidebar('right')}
      </div>

      {appSettings.autoLock.enabled && hasStoragePassword && (
        <AutoLockManager
          config={appSettings.autoLock}
          onConfigChange={(config) => settingsManager.saveSettings({ autoLock: config }).catch(console.error)}
          onLock={() => {
            settingsManager.logAction("info", "Auto lock", undefined, "Session locked due to inactivity");
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
        onConnect={handleQuickConnect}
      />

      <PasswordDialog
        isOpen={showPasswordDialog}
        mode={passwordDialogMode}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
        error={passwordError}
      />

      <ConfirmDialog
        isOpen={dialogState.isOpen}
        message={dialogState.message}
        onConfirm={() => {
          dialogState.onConfirm();
          closeConfirmDialog();
        }}
        onCancel={dialogState.onCancel ? () => {
          dialogState.onCancel!();
          closeConfirmDialog();
        } : closeConfirmDialog}
      />

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <ImportExport
        isOpen={showImportExport}
        onClose={() => setShowImportExport(false)}
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
    </div>
  );
};

const App: React.FC = () => (
  <ConnectionProvider>
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  </ConnectionProvider>
);

export default App;

