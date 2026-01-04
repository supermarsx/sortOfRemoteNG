import React, { useState } from "react";
import { Monitor, Zap, Menu, Globe, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Connection } from "./types/connection";
import { SecureStorage } from "./utils/storage";
import { SettingsManager } from "./utils/settingsManager";
import { StatusChecker } from "./utils/statusChecker";
import { CollectionManager } from "./utils/collectionManager";
import { CollectionNotFoundError, InvalidPasswordError } from "./utils/errors";
import { useSessionManager } from "./hooks/useSessionManager";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
  const [passwordError, setPasswordError] = useState<string>(""); // error message for password dialog

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
        alert("Collection not found");
      } else if (error instanceof InvalidPasswordError) {
        alert("Invalid or missing password");
      } else {
        alert("Failed to access collection. Please check your password.");
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

    if (!confirmMessage || confirm(confirmMessage)) {
      dispatch({ type: "DELETE_CONNECTION", payload: connection.id });
      statusChecker.stopChecking(connection.id);
      settingsManager.logAction(
        "info",
        "Connection deleted",
        connection.id,
        `Connection "${connection.name}" deleted`,
      );
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

          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <Globe size={12} />
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent border-none text-gray-400 text-xs focus:outline-none"
            >
              <option value="en">English</option>
              <option value="es">Español (España)</option>
              <option value="fr">Français (France)</option>
              <option value="de">Deutsch (Deutschland)</option>
              <option value="pt-PT">Português (Portugal)</option>
            </select>
          </div>

          <button
            onClick={() => setShowCollectionSelector(true)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Switch Collection"
          >
            <Menu size={16} />
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
        <Sidebar
          onNewConnection={handleNewConnection}
          onEditConnection={handleEditConnection}
          onDeleteConnection={handleDeleteConnection}
          onConnect={handleConnect}
          onShowPasswordDialog={handleShowPasswordDialog}
        />

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
      {confirmDialog}
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
