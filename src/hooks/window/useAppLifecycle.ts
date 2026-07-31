import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "../../contexts/useConnections";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { StatusChecker } from "../../utils/connection/statusChecker";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { ThemeManager } from "../../utils/settings/themeManager";
import { SecureStorage } from "../../utils/storage/storage";
import {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import i18n, { loadLanguage, resolveSupportedLanguage } from "../../i18n";
import { IndexedDbService } from "../../utils/storage/indexedDbService";
import {
  isRestorableConnectionSession,
  realConnectionCount,
} from "../../utils/session/sessionClassification";
import {
  parsePersistedConnectionSession,
  serializePersistedConnectionSession,
  MAX_PERSISTED_SESSIONS,
  MAX_PERSISTED_SESSION_STORAGE_CHARS,
  type PersistedConnectionSession,
} from "../../utils/session/sessionPersistence";
import { hasSessionVpnCleanupQuarantine } from "../../utils/session/sessionLifecycle";

import { SAFE_MODE_KEY } from "../../components/app/CriticalErrorScreen";

const CLEAN_EXIT_KEY = "mremote-clean-exit";
const LAST_SESSION_KEY = "mremote-last-session-time";
const ACTIVE_SESSIONS_KEY = "mremote-active-sessions";
const INVALID_ACTIVE_SESSIONS_KEY = "mremote-invalid-active-sessions";
const SESSION_RESTORE_CONCURRENCY = 4;

const stringifySessionSnapshot = (
  rows: PersistedConnectionSession[],
): string => {
  if (rows.length > MAX_PERSISTED_SESSIONS) {
    throw new Error("Saved session count exceeds the safety limit.");
  }
  const serialized = JSON.stringify(rows);
  if (serialized.length > MAX_PERSISTED_SESSION_STORAGE_CHARS) {
    throw new Error("Saved session payload exceeds the safety limit.");
  }
  return serialized;
};

/** Read and consume the safe-mode flag set by the BSOD recovery screen. */
function consumeSafeMode(): "once" | "permanent" | null {
  const raw = localStorage.getItem(SAFE_MODE_KEY);
  if (!raw) return null;
  if (raw === "once") {
    localStorage.removeItem(SAFE_MODE_KEY);
    return "once";
  }
  if (raw === "permanent") return "permanent";
  localStorage.removeItem(SAFE_MODE_KEY);
  return null;
}

/**
 * Options for {@link useAppLifecycle}.
 * @property handleConnect - Invoked to initiate a connection.
 * @property restoreSession - Invoked to restore a saved session.
 * @property setShowDatabasePanel - Toggles the collection selector dialog.
 * @property setShowPasswordDialog - Toggles the password dialog visibility.
 * @property setPasswordDialogMode - Sets the password dialog mode.
 */
interface Options {
  handleConnect: (connection: Connection) => void;
  restoreSession?: (
    sessionData: PersistedConnectionSession,
    connection: Connection,
  ) => Promise<void>;
  setShowDatabasePanel: (value: boolean) => void;
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
  setShowDatabasePanel,
  setShowPasswordDialog,
  setPasswordDialogMode,
}: Options) => {
  const { t, i18n } = useTranslation();
  const { state, loadData } = useConnections();

  const settingsManager = SettingsManager.getInstance();
  const statusChecker = StatusChecker.getInstance();
  const databaseManager = DatabaseManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  const [isInitialized, setIsInitialized] = useState(false);
  const [initProgress, setInitProgress] = useState(0);
  const [initStatus, setInitStatus] = useState("Initializing...");
  const [didUnexpectedClose, setDidUnexpectedClose] = useState(false);
  const [criticalError, setCriticalError] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const hasReconnected = useRef(false);
  const initStarted = useRef(false);
  const initializedRef = useRef(false);
  const mountedRef = useRef(true);
  const safeModeRef = useRef<"once" | "permanent" | null>(null);
  const reconnectingSessions = useRef<Set<string>>(new Set());
  const restoreInProgressRef = useRef(false);
  const failedRecoveryRowsRef = useRef<PersistedConnectionSession[]>([]);
  const delayedRestoreCancelsRef = useRef<Set<() => void>>(new Set());

  /** Maximum time (ms) allowed for initialization before BSOD. */
  const INIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  const initializeApp = useCallback(async () => {
    if (initStarted.current) return;
    initStarted.current = true;

    const safeMode = consumeSafeMode();
    safeModeRef.current = safeMode;
    if (safeMode) {
      console.warn(`Safe mode active: ${safeMode}`);
    }

    try {
      // Phase 1: Settings (must come first — everything else depends on it)
      setInitStatus("Loading settings...");
      console.log("Initializing app...");
      await settingsManager.initialize();
      if (!mountedRef.current) return;
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
            settings.useCustomAccent ? settings.primaryAccentColor : undefined,
          );
          console.log("Theme manager initialized");
        }),
      );

      // Text direction (RTL) — apply before/independent of language load.
      if (typeof document !== "undefined") {
        document.documentElement.dir = settings.rtlLayout ? "rtl" : "ltr";
      }

      // Language loading. When auto-detect is on the runtime language follows
      // the OS/browser locale; the explicit `settings.language` pick is left
      // untouched so turning auto-detect off restores it.
      const effectiveLanguage = settings.autoDetectOsLanguage
        ? resolveSupportedLanguage(
            typeof navigator !== "undefined" ? navigator.language : "en",
          )
        : settings.language;
      if (
        effectiveLanguage &&
        effectiveLanguage !== i18n.language &&
        typeof i18n.changeLanguage === "function"
      ) {
        parallelTasks.push(
          (async () => {
            try {
              if (effectiveLanguage !== "en-US") {
                await loadLanguage(effectiveLanguage);
              }
              await i18n.changeLanguage(effectiveLanguage);
              console.log(`Language changed to: ${effectiveLanguage}`);
            } catch (error) {
              console.warn("Failed to change language:", error);
            }
          })(),
        );
      }

      // Unexpected close detection (IndexedDB reads/writes) — skipped in safe mode
      if (settings.detectUnexpectedClose && !safeMode) {
        parallelTasks.push(
          (async () => {
            const localCleanExit =
              localStorage.getItem(CLEAN_EXIT_KEY) === "true";
            const [dbCleanExit, lastSession] = await Promise.all([
              IndexedDbService.getItem<boolean>(CLEAN_EXIT_KEY),
              IndexedDbService.getItem<number>(LAST_SESSION_KEY),
            ]);

            const wasCleanExit = localCleanExit || dbCleanExit;
            if (mountedRef.current && lastSession !== null && !wasCleanExit) {
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
      if (!mountedRef.current) return;
      setInitProgress(60);

      // Phase 2.5: One-shot IndexedDB → file migration. Idempotent
      // and cheap on the no-op fast path (just probes the index).
      // Must run BEFORE Phase 3's collection load so the new file-
      // backed `databases_list` is the source of truth before
      // `databaseManager.getAllDatabases()` is called.
      if (!safeMode) {
        try {
          const { migrateIndexedDbToFiles } =
            await import("../../utils/connection/indexedDbMigration");
          const report = await migrateIndexedDbToFiles();
          if (report.migrated > 0 || report.failed > 0) {
            settingsManager.logAction(
              report.failed > 0 ? "warn" : "info",
              "Database migration: IndexedDB → files",
              undefined,
              `migrated=${report.migrated} alreadyOnDisk=${report.alreadyOnDisk} failed=${report.failed}`,
            );
          }
          if (report.failed > 0) {
            console.warn(
              `Database migration: ${report.failed} entries did not move:`,
              report.failures,
            );
          }
        } catch (e) {
          // Migration is best-effort. A failure here must not break
          // boot — the user's existing IndexedDB data is still
          // reachable through the legacy code path.
          console.warn("Database migration skipped:", e);
        }
      }

      // Phase 3: Collection loading — skipped in safe mode (show collection selector instead)
      setInitStatus("Loading connections...");
      if (safeMode) {
        console.log("Safe mode: skipping auto-open collection");
        setShowDatabasePanel(true);
      } else if (
        settings.autoOpenLastCollection &&
        settings.lastOpenedCollectionId
      ) {
        try {
          const collections = await databaseManager.getAllDatabases();
          const lastCollection = collections.find(
            (c) => c.id === settings.lastOpenedCollectionId,
          );

          if (lastCollection) {
            if (lastCollection.isEncrypted) {
              console.log(
                `Last collection "${lastCollection.name}" requires password, showing selector`,
              );
              setShowDatabasePanel(true);
            } else {
              await databaseManager.selectDatabase(lastCollection.id);
              await loadData();
              console.log(
                `Auto-opened last collection: ${lastCollection.name}`,
              );
              settingsManager.logAction(
                "info",
                "Collection auto-opened",
                undefined,
                `Auto-opened last collection: ${lastCollection.name}`,
              );
            }
          } else {
            console.log(
              "Last opened collection no longer exists, showing selector",
            );
            setShowDatabasePanel(true);
          }
        } catch (error) {
          console.warn("Failed to auto-open last collection:", error);
          setShowDatabasePanel(true);
        }
      }
      if (!mountedRef.current) return;
      setInitProgress(100);
      setInitStatus("Ready!");

      initializedRef.current = true;
      setIsInitialized(true);
      console.log("App initialized successfully");
      settingsManager.logAction(
        "info",
        "Application initialized",
        undefined,
        "sortOfRemoteNG started successfully",
      );
    } catch (error) {
      if (!mountedRef.current) return;
      console.error("Failed to initialize application:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      setCriticalError({
        title: "INITIALIZATION_FAILURE",
        detail: `The application failed to initialize.\n\n${msg}${error instanceof Error && error.stack ? `\n\n${error.stack}` : ""}`,
      });
      settingsManager.logAction(
        "error",
        "Application initialization failed",
        undefined,
        msg,
      );
    }
  }, [
    settingsManager,
    themeManager,
    i18n,
    loadData,
    setShowDatabasePanel,
    databaseManager,
  ]);

  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      const settings = settingsManager.getSettings();

      // Mark as clean exit when user intentionally closes
      if (settings.detectUnexpectedClose) {
        // Use synchronous localStorage as IndexedDB won't complete in time
        localStorage.setItem(CLEAN_EXIT_KEY, "true");
      }

      // Only real connections trigger the warn-on-exit prompt —
      // a Settings or Wake-on-LAN tab being open does not justify
      // interrupting the exit flow.
      if (settings.warnOnExit && realConnectionCount(state.sessions) > 0) {
        e.preventDefault();
        e.returnValue = t("dialogs.confirmExit");
        return t("dialogs.confirmExit");
      }
    },
    [settingsManager, state.sessions, t],
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
    mountedRef.current = true;
    initializeApp();

    // BSOD timeout — if init hasn't completed in 5 minutes, something is fatally wrong
    const timeout = setTimeout(() => {
      // Already initialized or never started — nothing to do
      if (initializedRef.current || !initStarted.current) return;
      setCriticalError((prev) => {
        if (prev) return prev;
        return {
          title: "INITIALIZATION_TIMEOUT",
          detail:
            "The application failed to initialize within the expected time (5 minutes).\n\n" +
            "This may indicate a corrupted database, a deadlocked background process, " +
            "or missing system resources.\n\nTry restarting the application. If the problem " +
            "persists, clear the application data or reinstall.",
        };
      });
    }, INIT_TIMEOUT_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: one-time initialization
  }, []);

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);

    const settings = settingsManager.getSettings();
    const singleWindowInterval =
      settings.singleWindowMode && !safeModeRef.current
        ? setInterval(checkSingleWindow, 5000)
        : null;

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (singleWindowInterval) {
        clearInterval(singleWindowInterval);
      }
      statusChecker.cleanup();
    };
  }, [handleBeforeUnload, checkSingleWindow, settingsManager, statusChecker]);

  useEffect(() => {
    if (isInitialized) {
      const currentDatabase = databaseManager.getCurrentDatabase();
      if (!currentDatabase) {
        setShowDatabasePanel(true);
      } else if (
        currentDatabase.isEncrypted &&
        !SecureStorage.isStorageUnlocked()
      ) {
        setPasswordDialogMode("unlock");
        setShowPasswordDialog(true);
      }
    }
  }, [
    isInitialized,
    databaseManager,
    setShowDatabasePanel,
    setShowPasswordDialog,
    setPasswordDialogMode,
  ]);

  useEffect(() => {
    const delayedRestoreCancels = delayedRestoreCancelsRef.current;
    const settings = settingsManager.getSettings();
    sessionStorage.removeItem(INVALID_ACTIVE_SESSIONS_KEY);
    if (
      settings.reconnectOnReload &&
      !safeModeRef.current &&
      isInitialized &&
      state.connections.length > 0
    ) {
      const savedSessions = sessionStorage.getItem(ACTIVE_SESSIONS_KEY);
      if (
        !savedSessions ||
        hasReconnected.current ||
        restoreInProgressRef.current
      ) {
        return;
      }

      let cancelled = false;
      restoreInProgressRef.current = true;

      const scheduleRestore = (
        sessionData: PersistedConnectionSession,
        connection: Connection,
      ): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          let settled = false;

          const cancel = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            delayedRestoreCancels.delete(cancel);
            reconnectingSessions.current.delete(sessionData.id);
            reject(new Error("Delayed session restoration was cancelled."));
          };

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            delayedRestoreCancels.delete(cancel);

            void (async () => {
              if (cancelled || !mountedRef.current) {
                throw new Error("Session restoration was cancelled.");
              }
              if (restoreSession) {
                await restoreSession(sessionData, connection);
                return;
              }
              if (hasSessionVpnCleanupQuarantine(sessionData)) {
                throw new Error(
                  "A quarantined session requires a restore-capable lifecycle owner.",
                );
              }
              // Await an async implementation even though the compatibility
              // surface permits a synchronous handleConnect callback.
              await Promise.resolve(handleConnect(connection));
            })()
              .then(resolve, reject)
              .finally(() => {
                reconnectingSessions.current.delete(sessionData.id);
              });
          }, 1000);

          delayedRestoreCancels.add(cancel);
        });

      const restoreSavedSessions = async () => {
        try {
          if (savedSessions.length > MAX_PERSISTED_SESSION_STORAGE_CHARS) {
            sessionStorage.removeItem(ACTIVE_SESSIONS_KEY);
            sessionStorage.removeItem(INVALID_ACTIVE_SESSIONS_KEY);
            throw new Error("Saved session payload exceeds the safety limit.");
          }
          const rawSessions: unknown = JSON.parse(savedSessions);
          if (
            !Array.isArray(rawSessions) ||
            rawSessions.length > MAX_PERSISTED_SESSIONS
          ) {
            throw new Error("Saved session payload is not an array.");
          }

          const invalidSessionReasons: string[] = [];
          const retryRows: PersistedConnectionSession[] = [];
          const candidates: Array<{
            sessionData: PersistedConnectionSession;
            connection: Connection;
          }> = [];

          rawSessions.forEach((rawSession, index) => {
            const parsed = parsePersistedConnectionSession(rawSession);
            if (!parsed.valid) {
              if (invalidSessionReasons.length < 32) {
                invalidSessionReasons.push(
                  `Row ${index + 1}: ${parsed.reason}`,
                );
              }
              console.error(
                "Refusing to restore unsafe saved session:",
                parsed.reason,
              );
              return;
            }

            const sessionData = parsed.session;
            const connection = state.connections.find(
              (candidate) => candidate.id === sessionData.connectionId,
            );
            if (
              !connection ||
              reconnectingSessions.current.has(sessionData.id)
            ) {
              retryRows.push(sessionData);
              return;
            }

            reconnectingSessions.current.add(sessionData.id);
            candidates.push({ sessionData, connection });
          });

          const outcomes: PromiseSettledResult<void>[] = [];
          for (
            let offset = 0;
            offset < candidates.length;
            offset += SESSION_RESTORE_CONCURRENCY
          ) {
            outcomes.push(
              ...(await Promise.allSettled(
                candidates
                  .slice(offset, offset + SESSION_RESTORE_CONCURRENCY)
                  .map(({ sessionData, connection }) =>
                    scheduleRestore(sessionData, connection),
                  ),
              )),
            );
          }
          if (cancelled || !mountedRef.current) {
            return;
          }

          outcomes.forEach((outcome, index) => {
            if (outcome.status === "fulfilled") {
              return;
            }
            const failed = candidates[index].sessionData;
            retryRows.push(failed);
            console.error(
              `Failed to restore session "${failed.name}" (${failed.id}):`,
              "reconnection failed",
            );
            settingsManager.logAction(
              "error",
              "Session restore failed",
              failed.connectionId,
              `${failed.name}: reconnection failed`,
            );
          });

          failedRecoveryRowsRef.current = retryRows;
          if (retryRows.length > 0) {
            sessionStorage.setItem(
              ACTIVE_SESSIONS_KEY,
              stringifySessionSnapshot(
                retryRows.slice(0, MAX_PERSISTED_SESSIONS),
              ),
            );
          } else {
            sessionStorage.removeItem(ACTIVE_SESSIONS_KEY);
          }

          if (invalidSessionReasons.length > 0) {
            sessionStorage.setItem(
              INVALID_ACTIVE_SESSIONS_KEY,
              JSON.stringify({
                count: invalidSessionReasons.length,
                reasons: invalidSessionReasons,
              }),
            );
          } else {
            sessionStorage.removeItem(INVALID_ACTIVE_SESSIONS_KEY);
          }
          hasReconnected.current = true;
        } catch (error) {
          if (!cancelled && mountedRef.current) {
            console.error("Failed to restore saved sessions safely.");
            hasReconnected.current = true;
          }
        } finally {
          if (!cancelled) {
            restoreInProgressRef.current = false;
          }
        }
      };

      void restoreSavedSessions().catch(() => {
        if (!cancelled && mountedRef.current) {
          console.error("Unexpected safe session restoration failure.");
        }
      });

      return () => {
        cancelled = true;
        restoreInProgressRef.current = false;
        for (const cancel of [...delayedRestoreCancels]) {
          cancel();
        }
      };
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
    sessionStorage.removeItem(INVALID_ACTIVE_SESSIONS_KEY);
    // Remote connections and integration panels are worth restoring across a
    // reload. Tool tabs (`tool:*`) and Windows management panels
    // (`winmgmt:*`) are stateless app surfaces — re-opening them
    // recreates them from scratch, so persisting their state would
    // just bloat sessionStorage with garbage that the next launch
    // would discard anyway.
    const restorable = state.sessions.filter(isRestorableConnectionSession);
    if (!settings.reconnectOnReload) {
      failedRecoveryRowsRef.current = [];
      sessionStorage.removeItem(ACTIVE_SESSIONS_KEY);
      sessionStorage.removeItem(INVALID_ACTIVE_SESSIONS_KEY);
      return;
    }

    const hasPendingRecoverySnapshot =
      !hasReconnected.current &&
      sessionStorage.getItem(ACTIVE_SESSIONS_KEY) !== null;
    if (restoreInProgressRef.current || hasPendingRecoverySnapshot) {
      return;
    }

    try {
      const sessionData = restorable
        .slice(-MAX_PERSISTED_SESSIONS)
        .map(serializePersistedConnectionSession);
      const liveSessionIds = new Set(sessionData.map((session) => session.id));
      failedRecoveryRowsRef.current = failedRecoveryRowsRef.current.filter(
        (session) => !liveSessionIds.has(session.id),
      );
      const merged = new Map<string, PersistedConnectionSession>();
      failedRecoveryRowsRef.current.forEach((session) => {
        merged.set(session.id, session);
      });
      sessionData.forEach((session) => {
        merged.set(session.id, session);
      });
      const nextSnapshot = [...merged.values()].slice(-MAX_PERSISTED_SESSIONS);

      if (nextSnapshot.length > 0) {
        sessionStorage.setItem(
          ACTIVE_SESSIONS_KEY,
          stringifySessionSnapshot(nextSnapshot),
        );
      } else {
        sessionStorage.removeItem(ACTIVE_SESSIONS_KEY);
      }
    } catch (error) {
      // Preserve the last known-safe snapshot rather than overwriting it
      // with ownership data that cannot be cleaned deterministically.
      console.error("Refusing to persist unsafe active session:", error);
    }
  }, [state.sessions, settingsManager]);

  return {
    isInitialized,
    initProgress,
    initStatus,
    didUnexpectedClose,
    dismissUnexpectedClose: () => setDidUnexpectedClose(false),
    criticalError,
  };
};
