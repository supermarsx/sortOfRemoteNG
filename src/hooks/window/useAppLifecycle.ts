import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../contexts/useConnections";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { StatusChecker } from "../../utils/connection/statusChecker";
import { CollectionManager } from "../../utils/connection/collectionManager";
import { ThemeManager } from "../../utils/settings/themeManager";
import { SecureStorage } from "../../utils/storage/storage";
import { Connection, ConnectionSession } from "../../types/connection/connection";
import i18n, { loadLanguage } from "../../i18n";
import { IndexedDbService } from "../../utils/storage/indexedDbService";

const CLEAN_EXIT_KEY = "mremote-clean-exit";
const LAST_SESSION_KEY = "mremote-last-session-time";

/**
 * Options for {@link useAppLifecycle}.
 * @property handleConnect - Invoked to initiate a connection.
 * @property restoreSession - Invoked to restore a saved session.
 * @property setShowCollectionSelector - Toggles the collection selector dialog.
 * @property setShowPasswordDialog - Toggles the password dialog visibility.
 * @property setPasswordDialogMode - Sets the password dialog mode.
 */
interface Options {
  handleConnect: (connection: Connection) => void;
  restoreSession?: (
    sessionData: {
      id: string;
      connectionId: string;
      name: string;
      protocol: string;
      hostname: string;
      status: string;
      backendSessionId?: string;
      shellId?: string;
      zoomLevel?: number;
      layout?: ConnectionSession["layout"];
      group?: string;
      startTime?: string;
      lastActivity?: string;
    },
    connection: Connection,
  ) => Promise<void>;
  setShowCollectionSelector: (value: boolean) => void;
  setShowPasswordDialog: (value: boolean) => void;
  setPasswordDialogMode: (mode: "setup" | "unlock") => void;
}

/**
 * Hook that initializes application settings and manages lifecycle events.
 *
 * Initialization steps:
 * 1. Initialize user settings and theme managers.
 * 2. Load saved theme and language preferences.
 * 3. Set up single-window checks and reconnect any stored sessions.
 *
 * @param options - {@link Options} for controlling lifecycle behaviors.
 * @returns An object containing the {@link isInitialized} flag.
 */
export const useAppLifecycle = ({
  handleConnect,
  restoreSession,
  setShowCollectionSelector,
  setShowPasswordDialog,
  setPasswordDialogMode,
}: Options) => {
  const { t, i18n } = useTranslation();
  const { state, loadData } = useConnections();

  const settingsManager = SettingsManager.getInstance();
  const statusChecker = StatusChecker.getInstance();
  const collectionManager = CollectionManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  const [isInitialized, setIsInitialized] = useState(false);
  const [initProgress, setInitProgress] = useState(0);
  const [initStatus, setInitStatus] = useState("Initializing...");
  const [didUnexpectedClose, setDidUnexpectedClose] = useState(false);
  const hasReconnected = useRef(false);
  const initStarted = useRef(false);
  const reconnectingSessions = useRef<Set<string>>(new Set());

  const initializeApp = useCallback(async () => {
    if (initStarted.current) return;
    initStarted.current = true;
    try {
      // Phase 1: Settings (must come first — everything else depends on it)
      setInitStatus("Loading settings...");
      console.log("Initializing app...");
      await settingsManager.initialize();
      const settings = settingsManager.getSettings();
      setInitProgress(25);
      console.log("Settings manager initialized");

      // Phase 2: Theme, language, and crash detection — all independent, run in parallel
      setInitStatus("Applying theme...");
      const parallelTasks: Promise<void>[] = [];

      // Theme loading
      parallelTasks.push(
        themeManager.loadSavedTheme().then(() => {
          themeManager.injectThemeCSS();
          themeManager.applyTheme(
            settings.theme,
            settings.colorScheme,
            settings.primaryAccentColor,
          );
          console.log("Theme manager initialized");
        }),
      );

      // Language loading
      if (
        settings.language &&
        settings.language !== i18n.language &&
        typeof i18n.changeLanguage === "function"
      ) {
        parallelTasks.push(
          (async () => {
            try {
              if (settings.language !== "en") {
                await loadLanguage(settings.language);
              }
              await i18n.changeLanguage(settings.language);
              console.log(`Language changed to: ${settings.language}`);
            } catch (error) {
              console.warn("Failed to change language:", error);
            }
          })(),
        );
      }

      // Unexpected close detection (IndexedDB reads/writes)
      if (settings.detectUnexpectedClose) {
        parallelTasks.push(
          (async () => {
            const localCleanExit = localStorage.getItem(CLEAN_EXIT_KEY) === "true";
            const [dbCleanExit, lastSession] = await Promise.all([
              IndexedDbService.getItem<boolean>(CLEAN_EXIT_KEY),
              IndexedDbService.getItem<number>(LAST_SESSION_KEY),
            ]);

            const wasCleanExit = localCleanExit || dbCleanExit;
            if (lastSession !== null && !wasCleanExit) {
              setDidUnexpectedClose(true);
              settingsManager.logAction(
                "warn",
                "Unexpected close detected",
                undefined,
                "The application was not closed properly in the previous session",
              );
            }

            localStorage.removeItem(CLEAN_EXIT_KEY);
            await Promise.all([
              IndexedDbService.setItem(CLEAN_EXIT_KEY, false),
              IndexedDbService.setItem(LAST_SESSION_KEY, Date.now()),
            ]);
          })(),
        );
      }

      await Promise.all(parallelTasks);
      setInitProgress(60);

      // Phase 3: Collection loading
      setInitStatus("Loading connections...");
      if (settings.autoOpenLastCollection && settings.lastOpenedCollectionId) {
        try {
          const collections = await collectionManager.getAllCollections();
          const lastCollection = collections.find(c => c.id === settings.lastOpenedCollectionId);

          if (lastCollection) {
            if (lastCollection.isEncrypted) {
              console.log(`Last collection "${lastCollection.name}" requires password, showing selector`);
              setShowCollectionSelector(true);
            } else {
              await collectionManager.selectCollection(lastCollection.id);
              await loadData();
              console.log(`Auto-opened last collection: ${lastCollection.name}`);
              settingsManager.logAction(
                "info",
                "Collection auto-opened",
                undefined,
                `Auto-opened last collection: ${lastCollection.name}`,
              );
            }
          } else {
            console.log("Last opened collection no longer exists, showing selector");
            setShowCollectionSelector(true);
          }
        } catch (error) {
          console.warn("Failed to auto-open last collection:", error);
          setShowCollectionSelector(true);
        }
      }
      setInitProgress(100);
      setInitStatus("Ready!");

      setIsInitialized(true);
      console.log("App initialized successfully");
      settingsManager.logAction(
        "info",
        "Application initialized",
        undefined,
        "sortOfRemoteNG started successfully",
      );
    } catch (error) {
      console.error("Failed to initialize application:", error);
      setInitProgress(100);
      setInitStatus("Ready!");
      setIsInitialized(true);
      settingsManager.logAction(
        "error",
        "Application initialization failed",
        undefined,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }, [settingsManager, themeManager, i18n, loadData, setShowCollectionSelector, collectionManager]);

  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      const settings = settingsManager.getSettings();
      
      // Mark as clean exit when user intentionally closes
      if (settings.detectUnexpectedClose) {
        // Use synchronous localStorage as IndexedDB won't complete in time
        localStorage.setItem(CLEAN_EXIT_KEY, "true");
      }
      
      if (settings.warnOnExit && state.sessions.length > 0) {
        e.preventDefault();
        e.returnValue = t("dialogs.confirmExit");
        return t("dialogs.confirmExit");
      }
    },
    [settingsManager, state.sessions.length, t],
  );

  const checkSingleWindow = useCallback(async () => {
    if (!(await settingsManager.checkSingleWindow())) {
      alert(
        "Another sortOfRemoteNG window is already open. Only one instance is allowed.",
      );
      window.close();
    }
  }, [settingsManager]);

  useEffect(() => {
    initializeApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);

    const settings = settingsManager.getSettings();
    const singleWindowInterval = settings.singleWindowMode
      ? setInterval(checkSingleWindow, 5000)
      : null;

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (singleWindowInterval) {
        clearInterval(singleWindowInterval);
      }
      statusChecker.cleanup();
    };
  }, [
    handleBeforeUnload,
    checkSingleWindow,
    settingsManager,
    statusChecker,
  ]);

  useEffect(() => {
    if (isInitialized) {
      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) {
        setShowCollectionSelector(true);
      } else if (
        currentCollection.isEncrypted &&
        !SecureStorage.isStorageUnlocked()
      ) {
        setPasswordDialogMode("unlock");
        setShowPasswordDialog(true);
      }
    }
  }, [
    isInitialized,
    collectionManager,
    setShowCollectionSelector,
    setShowPasswordDialog,
    setPasswordDialogMode,
  ]);

  useEffect(() => {
    const settings = settingsManager.getSettings();
    if (
      settings.reconnectOnReload &&
      isInitialized &&
      state.connections.length > 0
    ) {
      const savedSessions = sessionStorage.getItem("mremote-active-sessions");
      if (savedSessions && !hasReconnected.current) {
        try {
          const sessions: Array<{
            id: string;
            connectionId: string;
            name: string;
            protocol: string;
            hostname: string;
            status: string;
            backendSessionId?: string;
            shellId?: string;
            zoomLevel?: number;
            layout?: ConnectionSession["layout"];
            group?: string;
            startTime?: string;
            lastActivity?: string;
          }> = JSON.parse(savedSessions);
          sessionStorage.removeItem("mremote-active-sessions");

          sessions.forEach((sessionData) => {
            const connection = state.connections.find(
              (c) => c.id === sessionData.connectionId,
            );
            if (
              connection &&
              !reconnectingSessions.current.has(sessionData.id)
            ) {
              reconnectingSessions.current.add(sessionData.id);
              setTimeout(() => {
                // Use restoreSession to preserve session state when available
                if (restoreSession) {
                  restoreSession(sessionData, connection).finally(() => {
                    reconnectingSessions.current.delete(sessionData.id);
                  });
                } else {
                  // Fallback to handleConnect for new sessions
                  handleConnect(connection);
                  reconnectingSessions.current.delete(sessionData.id);
                }
              }, 1000);
            }
          });
        } catch (error) {
          console.error("Failed to restore sessions:", error);
        }
        hasReconnected.current = true;
      }
    }
  }, [
    isInitialized,
    state.connections,
    handleConnect,
    restoreSession,
    settingsManager,
  ]);

  useEffect(() => {
    const settings = settingsManager.getSettings();
    if (settings.reconnectOnReload && state.sessions.length > 0) {
      // Save full session state for restoration
      const sessionData = state.sessions.map((session) => ({
        id: session.id,
        connectionId: session.connectionId,
        name: session.name,
        protocol: session.protocol,
        hostname: session.hostname,
        status: session.status,
        backendSessionId: session.backendSessionId,
        shellId: session.shellId,
        zoomLevel: session.zoomLevel,
        layout: session.layout,
        group: session.group,
        startTime:
          session.startTime instanceof Date
            ? session.startTime.toISOString()
            : session.startTime,
        lastActivity:
          session.lastActivity instanceof Date
            ? session.lastActivity?.toISOString()
            : session.lastActivity,
      }));
      sessionStorage.setItem(
        "mremote-active-sessions",
        JSON.stringify(sessionData),
      );
    } else if (state.sessions.length === 0) {
      sessionStorage.removeItem("mremote-active-sessions");
    }
  }, [state.sessions, settingsManager]);

  return { isInitialized, initProgress, initStatus, didUnexpectedClose, dismissUnexpectedClose: () => setDidUnexpectedClose(false) };
};
