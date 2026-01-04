import React, { useState, useCallback, useEffect } from "react";
import { Monitor, Zap, Menu, Globe, Minus, Square, X, ChevronRight } from "lucide-react";
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

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {!isInitialized && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div className="text-white">Initializing...</div></div>}
      {/* Top bar */}
      <div 
        className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4"
        data-tauri-drag-region
      >
        <div className="flex items-center space-x-3">
          <Monitor size={20} className="text-blue-400" />
          <span className="font-semibold">{t("app.title")}</span>
          <span className="text-sm text-gray-400">{t("app.subtitle")}</span>
          {collectionManager.getCurrentCollection() && (
            <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded">
              {collectionManager.getCurrentCollection()?.name}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowQuickConnect(true)}
            className="flex items-center space-x-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm"
          >
            <Zap size={14} />
            <span>{t("connections.quickConnect")}</span>
          </button>

          <div className="flex items-center space-x-1 text-xs">
            <Globe size={12} className="text-gray-400" />
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:bg-gray-600 transition-colors"
            >
              <option value="en" className="bg-gray-700 text-white">English</option>
              <option value="es" className="bg-gray-700 text-white">Español (España)</option>
              <option value="fr" className="bg-gray-700 text-white">Français (France)</option>
              <option value="de" className="bg-gray-700 text-white">Deutsch (Deutschland)</option>
              <option value="pt-PT" className="bg-gray-700 text-white">Português (Portugal)</option>
            </select>
          </div>

          <button
            onClick={() => setShowCollectionSelector(true)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Switch Collection"
          >
            <Menu size={16} />
          </button>

          <button
            onClick={() => setSidebarPosition(sidebarPosition === 'left' ? 'right' : 'left')}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title={`Move sidebar to ${sidebarPosition === 'left' ? 'right' : 'left'}`}
          >
            <ChevronRight size={16} className={sidebarPosition === 'right' ? 'rotate-180' : ''} />
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
        {sidebarPosition === 'left' && (
          <div 
            className="relative"
            style={{ width: state.sidebarCollapsed ? '48px' : `${sidebarWidth}px` }}
          >
            <Sidebar
              onNewConnection={handleNewConnection}
              onEditConnection={handleEditConnection}
              onDeleteConnection={handleDeleteConnection}
              onConnect={handleConnect}
              onShowPasswordDialog={handleShowPasswordDialog}
            />
            {!state.sidebarCollapsed && (
              <div
                className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors"
                onMouseDown={handleMouseDown}
              />
            )}
          </div>
        )}

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

        {sidebarPosition === 'right' && (
          <div 
            className="relative"
            style={{ width: state.sidebarCollapsed ? '48px' : `${sidebarWidth}px` }}
          >
            {!state.sidebarCollapsed && (
              <div
                className="absolute top-0 left-0 w-1 h-full cursor-col-resize bg-gray-600 hover:bg-blue-500 transition-colors"
                onMouseDown={handleMouseDown}
              />
            )}
            <Sidebar
              onNewConnection={handleNewConnection}
              onEditConnection={handleEditConnection}
              onDeleteConnection={handleDeleteConnection}
              onConnect={handleConnect}
              onShowPasswordDialog={handleShowPasswordDialog}
            />
          </div>
        )}
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
