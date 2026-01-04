import React, { useState, useCallback, useEffect, useRef } from "react";
import { Monitor, Zap, Menu, Globe, Minus, Square, X, ChevronRight, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Connection } from "./types/connection";
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

/**
 * Core application component responsible for rendering the main layout and
 * managing global application state.
 */
const AppContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { state, dispatch, loadData, saveData } = useConnections();
  const [editingConnection, setEditingConnection] = useState<Connection | undefined>(
    undefined,
  ); // connection currently being edited
  const [showConnectionEditor, setShowConnectionEditor] = useState(false); // connection editor visibility
  const [showQuickConnect, setShowQuickConnect] = useState(false); // quick connect dialog visibility
  const [showPasswordDialog, setShowPasswordDialog] = useState(false); // password dialog visibility
  const [showCollectionSelector, setShowCollectionSelector] = useState(false); // collection selector visibility
  const [showSettings, setShowSettings] = useState(false); // settings dialog visibility
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock"
  >("setup"); // current mode for password dialog
  const [passwordError, setPasswordError] = useState(""); // password dialog error message
  const [sidebarWidth, setSidebarWidth] = useState(320); // sidebar width in pixels
  const [isResizing, setIsResizing] = useState(false); // whether sidebar is being resized
  const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left'); // sidebar position
  const [windowWidth, setWindowWidth] = useState(window.innerWidth); // window width for responsive design
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

  const settingsManager = SettingsManager.getInstance();
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
    { value: "es", label: "Español (España)" },
    { value: "fr", label: "Français (France)" },
    { value: "de", label: "Deutsch (Deutschland)" },
    { value: "pt-PT", label: "Português (Portugal)" },
  ];

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
    const newWidth = sidebarPosition === 'left' 
      ? Math.max(200, Math.min(600, e.clientX))
      : Math.max(200, Math.min(600, window.innerWidth - e.clientX));
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

  // Track window width for responsive design
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const handleMinimize = async () => {
    const window = getCurrentWindow();
    await window.minimize();
  };

  const handleMaximize = async () => {
    const window = getCurrentWindow();
    await window.toggleMaximize();
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
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {!isInitialized && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="text-white">Initializing...</div></div>}
      {/* Top bar */}
      <div 
        className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4"
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

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowQuickConnect(true)}
            className={`flex items-center space-x-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors ${windowWidth < 768 ? 'px-2' : ''}`}
          >
            <Zap size={14} />
            {windowWidth >= 768 && <span>{t("connections.quickConnect")}</span>}
          </button>

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
                      i18n.changeLanguage(option.value);
                      setShowLanguageMenu(false);
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

          <button
            onClick={() => setShowCollectionSelector(true)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Switch Collection"
          >
            <Menu size={16} />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Settings"
          >
            <Settings size={16} />
          </button>

          {/* Window Controls */}
          <div className="flex items-center space-x-1 ml-2">
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
      </div>

      <div className="flex flex-1 overflow-hidden">
        {renderSidebar('left')}

        <div className="flex-1 flex flex-col">
          <SessionTabs
            activeSessionId={activeSessionId}
            onSessionSelect={setActiveSessionId}
            onSessionClose={handleSessionClose}
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
