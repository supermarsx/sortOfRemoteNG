import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnections } from '../contexts/ConnectionContext';
import { SettingsManager } from '../utils/settings';
import { StatusChecker } from '../utils/statusChecker';
import { CollectionManager } from '../utils/collectionManager';
import { ThemeManager } from '../utils/themeManager';
import { SecureStorage } from '../utils/storage';
import { Connection, ConnectionSession } from '../types/connection';

interface Options {
  handleConnect: (connection: Connection) => void;
  setShowCollectionSelector: (value: boolean) => void;
  setShowPasswordDialog: (value: boolean) => void;
  setPasswordDialogMode: (mode: 'setup' | 'unlock') => void;
}

export const useAppLifecycle = ({
  handleConnect,
  setShowCollectionSelector,
  setShowPasswordDialog,
  setPasswordDialogMode,
}: Options) => {
  const { t, i18n } = useTranslation();
  const { state } = useConnections();

  const settingsManager = SettingsManager.getInstance();
  const statusChecker = StatusChecker.getInstance();
  const collectionManager = CollectionManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  const [isInitialized, setIsInitialized] = useState(false);
  const hasReconnected = useRef(false);
  const reconnectingSessions = useRef<Set<string>>(new Set());

  const initializeApp = async () => {
    try {
      await settingsManager.initialize();

      await themeManager.loadSavedTheme();
      themeManager.injectThemeCSS();

      const settings = settingsManager.getSettings();
      if (settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }

      setIsInitialized(true);
      settingsManager.logAction(
        'info',
        'Application initialized',
        undefined,
        'sortOfRemoteNG started successfully',
      );
    } catch (error) {
      console.error('Failed to initialize application:', error);
      settingsManager.logAction(
        'error',
        'Application initialization failed',
        undefined,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  };

  useEffect(() => {
    initializeApp();

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const settings = settingsManager.getSettings();
      if (settings.warnOnExit && state.sessions.length > 0) {
        e.preventDefault();
        e.returnValue = t('dialogs.confirmExit');
        return t('dialogs.confirmExit');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    const checkSingleWindow = async () => {
      if (!(await settingsManager.checkSingleWindow())) {
        alert('Another sortOfRemoteNG window is already open. Only one instance is allowed.');
        window.close();
      }
    };

    const singleWindowInterval = setInterval(checkSingleWindow, 5000);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(singleWindowInterval);
      statusChecker.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialized) {
      const currentCollection = collectionManager.getCurrentCollection();
      if (!currentCollection) {
        setShowCollectionSelector(true);
      } else if (currentCollection.isEncrypted && !SecureStorage.isStorageUnlocked()) {
        setPasswordDialogMode('unlock');
        setShowPasswordDialog(true);
      }
    }
  }, [isInitialized]);

  useEffect(() => {
    const settings = settingsManager.getSettings();
    if (settings.reconnectOnReload && isInitialized && state.connections.length > 0) {
      const savedSessions = sessionStorage.getItem('mremote-active-sessions');
      if (savedSessions && !hasReconnected.current) {
        try {
          const sessions: ConnectionSession[] = JSON.parse(savedSessions);
          sessionStorage.removeItem('mremote-active-sessions');

          sessions.forEach(sessionData => {
            const connection = state.connections.find(c => c.id === sessionData.connectionId);
            if (connection && !reconnectingSessions.current.has(connection.id)) {
              reconnectingSessions.current.add(connection.id);
              setTimeout(() => {
                handleConnect(connection);
                reconnectingSessions.current.delete(connection.id);
              }, 1000);
            }
          });
        } catch (error) {
          console.error('Failed to restore sessions:', error);
        }
        hasReconnected.current = true;
      }
    }
  }, [isInitialized, state.connections, handleConnect]);

  useEffect(() => {
    const settings = settingsManager.getSettings();
    if (settings.reconnectOnReload && state.sessions.length > 0) {
      const sessionData = state.sessions.map(session => ({
        connectionId: session.connectionId,
        name: session.name,
      }));
      sessionStorage.setItem('mremote-active-sessions', JSON.stringify(sessionData));
    } else if (state.sessions.length === 0) {
      sessionStorage.removeItem('mremote-active-sessions');
    }
  }, [state.sessions]);

  return { isInitialized };
};

