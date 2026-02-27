import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Globe,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Home,
  Lock,
  Unlock,
  ExternalLink,
  Maximize2,
  Minimize2,
  AlertCircle,
  Loader2,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { TOTPConfig } from '../types/settings';
import { useConnections } from '../contexts/useConnections';
import { useSettings } from '../contexts/SettingsContext';
import RDPTotpPanel from './rdp/RDPTotpPanel';

interface HTTPViewerProps {
  session: ConnectionSession;
}

interface ProxyMediatorResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * HTTP/HTTPS Viewer Component
 * 
 * All connections are mediated through the Rust backend proxy.
 * This provides:
 * - Basic auth handling without browser prompts
 * - Session state preservation on detach/reattach
 * - SSL termination and certificate handling
 * - Consistent authentication state
 */
export const HTTPViewer: React.FC<HTTPViewerProps> = ({ session }) => {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const connection = state.connections.find((c) => c.id === session.connectionId);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string>('');
  const [proxyUrl, setProxyUrl] = useState<string>('');
  const [proxySessionId, setProxySessionId] = useState<string>('');
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isSecure, setIsSecure] = useState(false);
  const [showTotpPanel, setShowTotpPanel] = useState(false);
  const totpBtnRef = useRef<HTMLDivElement>(null);

  const totpConfigs = connection?.totpConfigs ?? [];
  const handleUpdateTotpConfigs = useCallback((configs: TOTPConfig[]) => {
    if (connection) {
      dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, totpConfigs: configs } });
    }
  }, [connection, dispatch]);

  // Build the target URL from connection config
  const buildTargetUrl = useCallback(() => {
    if (!connection) return '';
    
    const protocol = session.protocol === 'https' ? 'https' : 'http';
    const port = connection.port || (session.protocol === 'https' ? 443 : 80);
    const host = connection.hostname;
    
    // Don't include standard ports in URL
    const portSuffix = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80)
      ? ''
      : `:${port}`;
    
    return `${protocol}://${host}${portSuffix}`;
  }, [connection, session.protocol]);

  // Resolve the best auth credentials from the connection
  const resolveCredentials = useCallback((): { username: string; password: string } | null => {
    if (!connection) return null;

    // Prefer dedicated basicAuth fields when authType is 'basic'
    if (
      connection.authType === 'basic' &&
      connection.basicAuthUsername &&
      connection.basicAuthPassword
    ) {
      return {
        username: connection.basicAuthUsername,
        password: connection.basicAuthPassword,
      };
    }

    // Fall back to general username/password fields
    if (connection.username && connection.password) {
      return { username: connection.username, password: connection.password };
    }

    return null;
  }, [connection]);

  // Stop a running proxy session
  const stopProxy = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      await invoke('stop_basic_auth_proxy', { sessionId });
    } catch {
      // Session may already be gone – ignore
    }
  }, []);

  // Initialize proxy connection
  const initProxy = useCallback(async () => {
    if (!connection) {
      setStatus('error');
      setError('Connection not found');
      return;
    }

    setStatus('connecting');
    setError('');

    // Tear down previous session if any
    if (proxySessionId) {
      await stopProxy(proxySessionId);
      setProxySessionId('');
    }

    try {
      const targetUrl = buildTargetUrl();
      setCurrentUrl(targetUrl);
      setIsSecure(targetUrl.startsWith('https'));

      const creds = resolveCredentials();

      if (creds) {
        // Start the proxy mediator for authenticated connections
        const proxyConfig = {
          target_url: targetUrl,
          username: creds.username,
          password: creds.password,
          local_port: 0, // Auto-assign
          verify_ssl: connection.httpVerifySsl ?? true,
        };

        const response = await invoke<ProxyMediatorResponse>('start_basic_auth_proxy', {
          config: proxyConfig,
        });

        setProxyUrl(response.proxy_url);
        setProxySessionId(response.session_id);
        setHistory([response.proxy_url]);
        setHistoryIndex(0);
        setStatus('connected');
      } else {
        // No auth needed, connect directly
        setProxyUrl(targetUrl);
        setHistory([targetUrl]);
        setHistoryIndex(0);
        setStatus('connected');
      }
    } catch (err) {
      console.error('Failed to initialize HTTP proxy:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connection, buildTargetUrl, resolveCredentials, proxySessionId, stopProxy]);

  // Initialize on mount
  useEffect(() => {
    initProxy();
  }, [initProxy]);

  // Cleanup proxy session on unmount
  useEffect(() => {
    return () => {
      if (proxySessionId) {
        invoke('stop_basic_auth_proxy', { sessionId: proxySessionId }).catch(() => {});
      }
    };
  }, [proxySessionId]);

  // Navigation handlers
  const navigateTo = useCallback((url: string) => {
    if (!iframeRef.current) return;
    
    // Update history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(url);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    // Navigate iframe
    iframeRef.current.src = url;
    setCurrentUrl(url);
  }, [history, historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0 && iframeRef.current) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      iframeRef.current.src = history[newIndex];
      setCurrentUrl(history[newIndex]);
    }
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1 && iframeRef.current) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      iframeRef.current.src = history[newIndex];
      setCurrentUrl(history[newIndex]);
    }
  }, [history, historyIndex]);

  const refresh = useCallback(() => {
    if (iframeRef.current && proxyUrl) {
      iframeRef.current.src = proxyUrl;
    }
  }, [proxyUrl]);

  const goHome = useCallback(() => {
    if (proxyUrl) {
      navigateTo(proxyUrl);
    }
  }, [proxyUrl, navigateTo]);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const openExternal = useCallback(() => {
    const targetUrl = buildTargetUrl();
    if (targetUrl) {
      window.open(targetUrl, '_blank');
    }
  }, [buildTargetUrl]);

  // Handle iframe load events
  const handleIframeLoad = useCallback(() => {
    try {
      // Try to get the current URL from iframe (may fail due to CORS)
      const iframe = iframeRef.current;
      if (iframe?.contentWindow?.location?.href) {
        setCurrentUrl(iframe.contentWindow.location.href);
      }
    } catch {
      // CORS prevents access to iframe location
    }
  }, []);

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)] p-8">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Connection Failed</h2>
        <p className="text-[var(--color-textSecondary)] mb-4 text-center max-w-md">{error}</p>
        <button
          onClick={initProxy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry Connection
        </button>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)] text-[var(--color-text)]">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h2 className="text-lg font-medium">Connecting...</h2>
        <p className="text-[var(--color-textSecondary)] text-sm mt-2">{buildTargetUrl()}</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full bg-[var(--color-background)] ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* Navigation Bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={goBack}
            disabled={historyIndex <= 0}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= history.length - 1}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={refresh}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={goHome}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

        {/* URL Bar */}
        <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--color-border)]/50 border border-[var(--color-border)] rounded-lg">
          {isSecure ? (
            <Lock className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : (
            <Unlock className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          )}
          <span className="text-[var(--color-textSecondary)] text-sm truncate flex-1">{currentUrl}</span>
          {resolveCredentials() && (
            <span className="flex items-center gap-1 text-xs text-blue-400 flex-shrink-0">
              <Shield className="w-3 h-3" />
              Authenticated
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={openExternal}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
            title="Open in Browser"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {/* 2FA / TOTP */}
          <div className="relative" ref={totpBtnRef}>
            <button
              type="button"
              onClick={() => setShowTotpPanel(!showTotpPanel)}
              className={`p-1.5 rounded relative ${showTotpPanel ? 'text-blue-400 bg-blue-600/20' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'}`}
              title="2FA Codes"
            >
              <Shield className="w-4 h-4" />
              {totpConfigs.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gray-500 text-[var(--color-text)] text-[8px] font-bold rounded-full flex items-center justify-center">
                  {totpConfigs.length}
                </span>
              )}
            </button>
            {showTotpPanel && (
              <RDPTotpPanel
                configs={totpConfigs}
                onUpdate={handleUpdateTotpConfigs}
                onClose={() => setShowTotpPanel(false)}
                defaultIssuer={settings.totpIssuer}
                defaultDigits={settings.totpDigits}
                defaultPeriod={settings.totpPeriod}
                defaultAlgorithm={settings.totpAlgorithm}
                anchorRef={totpBtnRef}
              />
            )}
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded ${showSettings ? 'text-blue-400 bg-blue-600/20' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]'}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="px-4 py-3 bg-[var(--color-surface)]/80 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-[var(--color-text)]">Connection Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--color-textSecondary)]">Target URL:</span>
              <p className="text-[var(--color-text)] truncate">{buildTargetUrl()}</p>
            </div>
            <div>
              <span className="text-[var(--color-textSecondary)]">Proxy Session:</span>
              <p className="text-[var(--color-text)] font-mono text-xs truncate">{proxySessionId || 'Direct'}</p>
            </div>
            <div>
              <span className="text-[var(--color-textSecondary)]">Authentication:</span>
              <p className="text-[var(--color-text)]">{resolveCredentials() ? 'Basic Auth' : 'None'}</p>
            </div>
            <div>
              <span className="text-[var(--color-textSecondary)]">Protocol:</span>
              <p className="text-[var(--color-text)]">{session.protocol.toUpperCase()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 relative min-h-0">
        {proxyUrl && (
          <iframe
            ref={iframeRef}
            src={proxyUrl}
            className="absolute inset-0 w-full h-full border-0 bg-white"
            onLoad={handleIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
            title={`HTTP Viewer - ${connection?.name || session.hostname}`}
          />
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--color-surface)] border-t border-[var(--color-border)] text-xs text-[var(--color-textSecondary)]">
        <div className="flex items-center gap-2">
          <Globe className="w-3 h-3" />
          <span>{connection?.name || session.hostname}</span>
        </div>
        <div className="flex items-center gap-4">
          {proxySessionId && (
            <span className="text-gray-500">Proxied via localhost</span>
          )}
          <span className={status === 'connected' ? 'text-green-400' : 'text-yellow-400'}>
            {status === 'connected' ? 'Connected' : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HTTPViewer;
