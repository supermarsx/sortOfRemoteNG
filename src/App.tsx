import React, { useState, useEffect, useRef } from 'react';
import { Monitor, Zap, Menu, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConnectionProvider, useConnections } from './contexts/ConnectionContext';
import { Sidebar } from './components/Sidebar';
import { ConnectionEditor } from './components/ConnectionEditor';
import { SessionTabs } from './components/SessionTabs';
import { SessionViewer } from './components/SessionViewer';
import { QuickConnect } from './components/QuickConnect';
import { PasswordDialog } from './components/PasswordDialog';
import { CollectionSelector } from './components/CollectionSelector';
import { Connection, ConnectionSession } from './types/connection';
import { SecureStorage } from './utils/storage';
import { SettingsManager } from './utils/settingsManager';
import { StatusChecker } from './utils/statusChecker';
import { ScriptEngine } from './utils/scriptEngine';
import { CollectionManager } from './utils/collectionManager';
import { ThemeManager } from './utils/themeManager';

const AppContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { state, dispatch, loadData, saveData } = useConnections();
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [showConnectionEditor, setShowConnectionEditor] = useState(false);
  const [showQuickConnect, setShowQuickConnect] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showCollectionSelector, setShowCollectionSelector] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<'setup' | 'unlock'>('setup');
  const [passwordError, setPasswordError] = useState<string>('');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [isInitialized, setIsInitialized] = useState(false);
  const [reconnectingSessions, setReconnectingSessions] = useState<Set<string>>(new Set());
  const hasReconnected = useRef<boolean>(false);

  const settingsManager = SettingsManager.getInstance();
  const statusChecker = StatusChecker.getInstance();
  const scriptEngine = ScriptEngine.getInstance();
  const collectionManager = CollectionManager.getInstance();
  const themeManager = ThemeManager.getInstance();

  // Initialize application
  useEffect(() => {
    initializeApp();
    
    // Handle page unload
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const settings = settingsManager.getSettings();
      if (settings.warnOnExit && state.sessions.length > 0) {
        e.preventDefault();
        e.returnValue = t('dialogs.confirmExit');
        return t('dialogs.confirmExit');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Single window mode check
    const checkSingleWindow = () => {
      if (!settingsManager.checkSingleWindow()) {
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
  }, []);

  // Check if we need to show collection selector or password dialog on startup
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

  // Reconnect sessions on reload if enabled (fixed to prevent loop)
  useEffect(() => {
    const settings = settingsManager.getSettings();
    if (settings.reconnectOnReload && isInitialized && state.connections.length > 0) {
      const savedSessions = sessionStorage.getItem('mremote-active-sessions');
      if (savedSessions && !hasReconnected.current) {
        try {
          const sessions = JSON.parse(savedSessions);
          // Clear the saved sessions to prevent reconnection loop
          sessionStorage.removeItem('mremote-active-sessions');

          sessions.forEach((sessionData: any) => {
            const connection = state.connections.find(c => c.id === sessionData.connectionId);
            if (connection && !reconnectingSessions.has(connection.id)) {
              setReconnectingSessions(prev => new Set(prev).add(connection.id));
              setTimeout(() => {
                handleConnect(connection);
                setReconnectingSessions(prev => {
                  const newSet = new Set(prev);
                  newSet.delete(connection.id);
                  return newSet;
                });
              }, 1000);
            }
          });
        } catch (error) {
          console.error('Failed to restore sessions:', error);
        }
        hasReconnected.current = true;
      }
    }
  }, [isInitialized, state.connections]);

  // Save active sessions for reconnection (only save when sessions change, not on reload)
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

  const initializeApp = async () => {
    try {
      await settingsManager.initialize();
      
      // Apply theme
      themeManager.loadSavedTheme();
      themeManager.injectThemeCSS();
      
      // Apply language setting
      const settings = settingsManager.getSettings();
      if (settings.language !== i18n.language) {
        i18n.changeLanguage(settings.language);
      }
      
      setIsInitialized(true);
      settingsManager.logAction('info', 'Application initialized', undefined, 'sortOfRemoteNG started successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      settingsManager.logAction('error', 'Application initialization failed', undefined, error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleCollectionSelect = async (collectionId: string, password?: string) => {
    try {
      await collectionManager.selectCollection(collectionId, password);
      await loadData();
      setShowCollectionSelector(false);
      settingsManager.logAction('info', 'Collection selected', undefined, `Collection: ${collectionManager.getCurrentCollection()?.name}`);
    } catch (error) {
      console.error('Failed to select collection:', error);
      alert('Failed to access collection. Please check your password.');
    }
  };

  const handleNewConnection = () => {
    setEditingConnection(null);
    setShowConnectionEditor(true);
  };

  const handleEditConnection = (connection: Connection) => {
    setEditingConnection(connection);
    setShowConnectionEditor(true);
  };

  const handleDeleteConnection = (connection: Connection) => {
    const settings = settingsManager.getSettings();
    const confirmMessage = connection.warnOnClose || settings.warnOnClose 
      ? t('dialogs.confirmDelete') 
      : null;
    
    if (!confirmMessage || confirm(confirmMessage)) {
      dispatch({ type: 'DELETE_CONNECTION', payload: connection.id });
      statusChecker.stopChecking(connection.id);
      settingsManager.logAction('info', 'Connection deleted', connection.id, `Connection "${connection.name}" deleted`);
    }
  };

  const connectSession = async (session: ConnectionSession, connection: Connection) => {
    const settings = settingsManager.getSettings();
    const startTime = Date.now();

    settingsManager.logAction('info', 'Connection initiated', connection.id, `Connecting to ${connection.hostname}:${connection.port}`);

    try {
      await scriptEngine.executeScriptsForTrigger('onConnect', { connection, session });
    } catch (error) {
      console.error('Script execution failed:', error);
    }

    if (connection.statusCheck?.enabled) {
      statusChecker.startChecking(connection);
    }

    const timeout = (connection.timeout || settings.connectionTimeout) * 1000;
    const connectionPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        const connectionTime = Date.now() - startTime;

        settingsManager.recordPerformanceMetric({
          connectionTime,
          dataTransferred: 0,
          latency: Math.random() * 50 + 10,
          throughput: Math.random() * 1000 + 500,
          cpuUsage: Math.random() * 30 + 10,
          memoryUsage: Math.random() * 50 + 20,
          timestamp: Date.now(),
        });

        dispatch({
          type: 'UPDATE_SESSION',
          payload: {
            ...session,
            status: 'connected',
            metrics: {
              connectionTime,
              dataTransferred: 0,
              latency: Math.random() * 50 + 10,
              throughput: Math.random() * 1000 + 500,
            },
          },
        });

        dispatch({
          type: 'UPDATE_CONNECTION',
          payload: {
            ...connection,
            lastConnected: new Date(),
            connectionCount: (connection.connectionCount || 0) + 1,
          },
        });

        settingsManager.logAction('info', 'Connection established', connection.id, `Connected successfully in ${connectionTime}ms`, connectionTime);
        resolve();
      }, 2000);
    });

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeout);
    });

    try {
      await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      dispatch({
        type: 'UPDATE_SESSION',
        payload: { ...session, status: 'error' },
      });

      settingsManager.logAction('error', 'Connection failed', connection.id, error instanceof Error ? error.message : 'Unknown error');

      if ((session.reconnectAttempts || 0) < (session.maxReconnectAttempts || 0)) {
        setTimeout(() => {
          handleReconnect(session);
        }, connection.retryDelay || settings.retryDelay);
      }
    }
  };

  const handleConnect = async (connection: Connection) => {
    const settings = settingsManager.getSettings();
    
    // Check single connection mode
    if (settings.singleConnectionMode && state.sessions.length > 0) {
      if (!confirm('Close existing connection and open new one?')) {
        return;
      }
      // Close all existing sessions
      state.sessions.forEach(session => {
        dispatch({ type: 'REMOVE_SESSION', payload: session.id });
      });
    }

    // Check max concurrent connections
    if (state.sessions.length >= settings.maxConcurrentConnections) {
      alert(`Maximum concurrent connections (${settings.maxConcurrentConnections}) reached.`);
      return;
    }

    // Create a new session
    const session: ConnectionSession = {
      id: crypto.randomUUID(),
      connectionId: connection.id,
      name: settings.hostnameOverride && connection.hostname ? connection.hostname : connection.name,
      status: 'connecting',
      startTime: new Date(),
      protocol: connection.protocol,
      hostname: connection.hostname,
      reconnectAttempts: 0,
      maxReconnectAttempts: connection.retryAttempts || settings.retryAttempts,
    };

    dispatch({ type: 'ADD_SESSION', payload: session });
    setActiveSessionId(session.id);

    await connectSession(session, connection);
  };

  const reconnectSession = async (session: ConnectionSession, connection: Connection) => {
    const updatedSession: ConnectionSession = {
      ...session,
      status: 'reconnecting',
      reconnectAttempts: (session.reconnectAttempts || 0) + 1,
      startTime: new Date(),
    };

    dispatch({ type: 'UPDATE_SESSION', payload: updatedSession });
    settingsManager.logAction(
      'info',
      'Reconnection attempt',
      connection.id,
      `Attempt ${updatedSession.reconnectAttempts}/${updatedSession.maxReconnectAttempts}`
    );

    await connectSession(updatedSession, connection);
  };

  const handleReconnect = async (session: ConnectionSession) => {
    const connection = state.connections.find(c => c.id === session.connectionId);
    if (!connection) return;

    setTimeout(() => {
      reconnectSession(session, connection);
    }, 2000);
  };

  const handleQuickConnect = (hostname: string, protocol: string) => {
    const tempConnection: Connection = {
      id: crypto.randomUUID(),
      name: `${t('connections.quickConnect')} - ${hostname}`,
      protocol: protocol as Connection['protocol'],
      hostname,
      port: getDefaultPort(protocol),
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    handleConnect(tempConnection);
  };

  const getDefaultPort = (protocol: string): number => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      vnc: 5900,
      http: 80,
      https: 443,
      telnet: 23,
      rlogin: 513,
    };
    return ports[protocol] || 22;
  };

  const handlePasswordSubmit = async (password: string) => {
    try {
      setPasswordError('');
      SecureStorage.setPassword(password);

      if (passwordDialogMode === 'unlock') {
        await loadData();
      } else {
        // Setup mode - save current data with password
        await saveData(true);
      }

      setShowPasswordDialog(false);
      settingsManager.logAction('info', 'Storage unlocked', undefined, 'Data storage unlocked successfully');
    } catch (error) {
      setPasswordError(passwordDialogMode === 'unlock' ? t('dialogs.invalidPassword') : 'Failed to secure data');
      SecureStorage.clearPassword();
      settingsManager.logAction('error', 'Storage unlock failed', undefined, error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handlePasswordCancel = () => {
    if (passwordDialogMode === 'setup') {
      // Save without password
      saveData(false).catch(console.error);
    }
    setShowPasswordDialog(false);
    setPasswordError('');
  };

  const handleShowPasswordDialog = () => {
    if (SecureStorage.isStorageEncrypted()) {
      if (SecureStorage.isStorageUnlocked()) {
        // Already unlocked, show setup to change password
        setPasswordDialogMode('setup');
      } else {
        // Locked, show unlock
        setPasswordDialogMode('unlock');
      }
    } else {
      // Not encrypted, show setup
      setPasswordDialogMode('setup');
    }
    setShowPasswordDialog(true);
  };

  const handleSessionClose = async (sessionId: string) => {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const connection = state.connections.find(c => c.id === session.connectionId);
    const settings = settingsManager.getSettings();
    
    const shouldWarn = connection?.warnOnClose || settings.warnOnClose;
    if (shouldWarn && !confirm(t('dialogs.confirmClose'))) {
      return;
    }

    // Execute onDisconnect scripts
    if (connection) {
      try {
        await scriptEngine.executeScriptsForTrigger('onDisconnect', { connection, session });
      } catch (error) {
        console.error('Script execution failed:', error);
      }
    }

    dispatch({ type: 'REMOVE_SESSION', payload: sessionId });
    
    if (connection) {
      statusChecker.stopChecking(connection.id);
      settingsManager.logAction('info', 'Session closed', connection.id, `Session "${session.name}" closed`);
    }

    // If this was the active session, switch to another or clear
    if (activeSessionId === sessionId) {
      const remainingSessions = state.sessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remainingSessions.length > 0 ? remainingSessions[0].id : undefined);
    }
  };

  const activeSession = state.sessions.find(s => s.id === activeSessionId);

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Title Bar */}
      <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
        <div className="flex items-center space-x-3">
          <Monitor size={20} className="text-blue-400" />
          <span className="font-semibold">{t('app.title')}</span>
          <span className="text-sm text-gray-400">{t('app.subtitle')}</span>
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
            <span>{t('connections.quickConnect')}</span>
          </button>
          
          <div className="flex items-center space-x-1 text-xs text-gray-400">
            <Globe size={12} />
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="bg-transparent border-none text-gray-400 text-xs focus:outline-none"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </div>
          
          <button 
            onClick={() => setShowCollectionSelector(true)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Switch Collection"
          >
            <Menu size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          onNewConnection={handleNewConnection}
          onEditConnection={handleEditConnection}
          onDeleteConnection={handleDeleteConnection}
          onConnect={handleConnect}
          onShowPasswordDialog={handleShowPasswordDialog}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Session Tabs */}
          <SessionTabs
            activeSessionId={activeSessionId}
            onSessionSelect={setActiveSessionId}
            onSessionClose={handleSessionClose}
          />

          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {activeSession ? (
              <SessionViewer session={activeSession} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400">
                <Monitor size={64} className="mb-4" />
                <h2 className="text-xl font-medium mb-2">Welcome to {t('app.title')}</h2>
                <p className="text-center max-w-md mb-6">
                  Manage your remote connections efficiently. Create new connections or select 
                  an existing one from the sidebar to get started.
                </p>
                <div className="flex space-x-4">
                  <button
                    onClick={handleNewConnection}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                  >
                    {t('connections.new')} Connection
                  </button>
                  <button
                    onClick={() => setShowQuickConnect(true)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
                  >
                    {t('connections.quickConnect')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
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
    </div>
  );
};

const App: React.FC = () => {
  return (
    <ConnectionProvider>
      <AppContent />
    </ConnectionProvider>
  );
};

export default App;
