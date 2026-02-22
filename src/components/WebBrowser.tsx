import React, { useState, useRef, useEffect, useCallback } from 'react';
import { debugLog } from '../utils/debugLogger';
import { invoke } from '@tauri-apps/api/core';
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCcw, 
  ExternalLink, 
  Shield, 
  ShieldAlert,
  ShieldOff,
  Globe,
  Lock,
  AlertTriangle,
  User,
  ServerCrash,
  Wifi,
  WifiOff,
  RefreshCw,
  Settings
} from 'lucide-react';
import { ConnectionSession } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { useSettings } from '../contexts/SettingsContext';
import { CertificateInfoPopup } from './CertificateInfoPopup';
import { TrustWarningDialog } from './TrustWarningDialog';
import {
  verifyIdentity,
  trustIdentity,
  getStoredIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from '../utils/trustStore';

interface ProxyMediatorResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
}

interface WebBrowserProps {
  session: ConnectionSession;
}

export const WebBrowser: React.FC<WebBrowserProps> = ({ session }) => {
  const { state } = useConnections();
  const { settings } = useSettings();
  const connection = state.connections.find(c => c.id === session.connectionId);

  // Resolve the best auth credentials from the saved connection config.
  // Prefer the dedicated basicAuth fields (set by the HTTP editor), then fall
  // back to the generic username/password fields that older entries might use.
  const resolvedCreds = React.useMemo<{ username: string; password: string } | null>(() => {
    if (!connection) return null;
    if (connection.authType === 'basic' && connection.basicAuthUsername && connection.basicAuthPassword) {
      return { username: connection.basicAuthUsername, password: connection.basicAuthPassword };
    }
    if (connection.username && connection.password) {
      return { username: connection.username, password: connection.password };
    }
    return null;
  }, [connection]);

  // True when any credentials are configured — all traffic will be proxied via
  // the Rust backend so the browser never sees a 401 / auth popup.
  const hasAuth = resolvedCreds !== null;

  const buildTargetUrl = useCallback(() => {
    const protocol = session.protocol === 'https' ? 'https' : 'http';
    const defaultPort = session.protocol === 'https' ? 443 : 80;
    const port = connection?.port || defaultPort;
    const portSuffix = port === defaultPort ? '' : `:${port}`;
    return `${protocol}://${session.hostname}${portSuffix}/`;
  }, [connection, session.protocol, session.hostname]);

  const [currentUrl, setCurrentUrl] = useState(buildTargetUrl);
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [isSecure, setIsSecure] = useState(session.protocol === 'https');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ---- Certificate trust state ----
  const [showCertPopup, setShowCertPopup] = useState(false);
  const [certIdentity, setCertIdentity] = useState<CertIdentity | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(null);
  const trustResolveRef = useRef<((accept: boolean) => void) | null>(null);
  const certPopupRef = useRef<HTMLDivElement>(null);

  // Track the active proxy session via refs so cleanup always sees the latest
  // values regardless of render cycle.
  const proxySessionIdRef = useRef<string>('');
  const proxyUrlRef = useRef<string>('');
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Navigation generation counter — prevents stale async navigations from
   *  creating orphan proxy sessions when navigateToUrl is called concurrently
   *  (e.g. React StrictMode double-mount). */
  const navGenRef = useRef(0);

  // Timeout for loading (30 seconds)
  const LOAD_TIMEOUT_MS = 30_000;

  const sslVerifyDisabled = connection && connection.protocol === 'https' && (connection as Record<string, unknown>)?.httpVerifySsl === false;
  const iconCount = 2 + (hasAuth ? 1 : 0) + (sslVerifyDisabled ? 1 : 0);
  // 12px left offset + each icon is 14px + 8px gap (space-x-2) + 16px for separator + 8px trailing
  const iconPadding = 12 + iconCount * 22 + 16;

  // ------------------------------------------------------------------
  // TLS certificate trust helpers
  // ------------------------------------------------------------------

  /** Fetch the TLS certificate from the backend and run trust verification. */
  const fetchAndVerifyCert = useCallback(async (): Promise<boolean> => {
    if (session.protocol !== 'https') return true;

    const port = connection?.port || 443;
    const policy = getEffectiveTrustPolicy(connection?.tlsTrustPolicy, settings.tlsTrustPolicy);

    if (policy === 'always-trust') return true;

    try {
      const info = await invoke<{
        fingerprint: string;
        subject: string | null;
        issuer: string | null;
        pem: string | null;
        valid_from: string | null;
        valid_to: string | null;
        serial: string | null;
        signature_algorithm: string | null;
        san: string[];
      }>('get_tls_certificate_info', { host: session.hostname, port });

      const now = new Date().toISOString();
      const identity: CertIdentity = {
        fingerprint: info.fingerprint,
        subject: info.subject ?? undefined,
        issuer: info.issuer ?? undefined,
        firstSeen: now,
        lastSeen: now,
        validFrom: info.valid_from ?? undefined,
        validTo: info.valid_to ?? undefined,
        pem: info.pem ?? undefined,
        serial: info.serial ?? undefined,
        signatureAlgorithm: info.signature_algorithm ?? undefined,
        san: info.san.length > 0 ? info.san : undefined,
      };

      setCertIdentity(identity);

      const connId = connection?.id;
      const result = verifyIdentity(session.hostname, port, 'tls', identity, connId);

      if (result.status === 'trusted') return true;

      if (result.status === 'first-use' && policy === 'tofu') {
        // TOFU — silently trust on first use
        trustIdentity(session.hostname, port, 'tls', identity, false, connId);
        return true;
      }

      // For 'first-use' with always-ask/strict, or 'mismatch' — prompt the user
      if (result.status === 'mismatch' || policy === 'always-ask' || policy === 'strict') {
        return new Promise<boolean>((resolve) => {
          trustResolveRef.current = resolve;
          setTrustPrompt(result);
        });
      }

      return true;
    } catch (err) {
      debugLog('WebBrowser', 'Failed to fetch TLS cert info', { err });
      // If we can't get cert info, proceed anyway (degraded mode)
      return true;
    }
  }, [session.protocol, session.hostname, connection, settings.tlsTrustPolicy]);

  const handleTrustAccept = useCallback(() => {
    if (trustPrompt && certIdentity) {
      const port = connection?.port || 443;
      trustIdentity(session.hostname, port, 'tls', certIdentity, true, connection?.id);
    }
    setTrustPrompt(null);
    trustResolveRef.current?.(true);
    trustResolveRef.current = null;
  }, [trustPrompt, certIdentity, session.hostname, connection]);

  const handleTrustReject = useCallback(() => {
    setTrustPrompt(null);
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setLoadError('Connection aborted: certificate not trusted by user.');
    setIsLoading(false);
  }, []);

  // Close cert popup on outside click
  // ------------------------------------------------------------------
  // Proxy lifecycle helpers
  // ------------------------------------------------------------------

  /** Stop a running proxy session. */
  const stopProxy = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? proxySessionIdRef.current;
    if (!id) return;
    try {
      await invoke('stop_basic_auth_proxy', { sessionId: id });
    } catch {
      // Session may already be gone – ignore
    }
    if (!sessionId || sessionId === proxySessionIdRef.current) {
      proxySessionIdRef.current = '';
      proxyUrlRef.current = '';
    }
  }, []);

  /**
   * Navigate to a URL.  When auth is configured a local proxy is started on
   * the Rust backend and the iframe loads through it — every sub-resource
   * request (CSS, JS, images, fonts…) automatically carries the auth
   * credentials without ever showing a native browser auth prompt.
   */
  const navigateToUrl = useCallback(async (url: string, addToHistory = true) => {
    // Bump generation so any in-flight navigateToUrl from a prior call
    // knows it has been superseded and can clean up after itself.
    const gen = ++navGenRef.current;

    setIsLoading(true);
    setLoadError('');

    // Cancel any previous load timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }

    // ---- TLS trust verification (before loading content) ----
    if (url.startsWith('https://')) {
      const trusted = await fetchAndVerifyCert();
      if (!trusted) return; // user rejected — loadError already set
      // Check if a newer navigation superseded us while we were awaiting
      if (gen !== navGenRef.current) return;
    }

    // Start a timeout watchdog so we don't spin forever
    loadTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setLoadError(`Connection timed out after ${LOAD_TIMEOUT_MS / 1000} seconds. The server at ${url} did not respond.`);
    }, LOAD_TIMEOUT_MS);

    try {
      // Tear down any previous proxy session
      await stopProxy();
      // Re-check generation after the async stop
      if (gen !== navGenRef.current) return;

      if (hasAuth && resolvedCreds) {
        debugLog('WebBrowser', 'Starting auth proxy for', { url });

        const response = await invoke<ProxyMediatorResponse>('start_basic_auth_proxy', {
          config: {
            target_url: url,
            username: resolvedCreds.username,
            password: resolvedCreds.password,
            local_port: 0,
            verify_ssl: (connection as Record<string, unknown>)?.httpVerifySsl ?? true,
            connection_id: connection?.id ?? '',
          },
        });

        // If a newer navigation started while we awaited, kill the proxy
        // we just created — it's already orphaned.
        if (gen !== navGenRef.current) {
          invoke('stop_basic_auth_proxy', { sessionId: response.session_id }).catch(() => {});
          return;
        }

        proxySessionIdRef.current = response.session_id;
        proxyUrlRef.current = response.proxy_url;

        // Point the iframe at the local proxy — all requests now carry auth
        if (iframeRef.current) {
          iframeRef.current.src = response.proxy_url;
        }
      } else {
        // No auth — load directly
        if (iframeRef.current) {
          iframeRef.current.src = url;
        }
      }

      setCurrentUrl(url);
      setInputUrl(url);
      setIsSecure(url.startsWith('https'));

      if (addToHistory) {
        setHistory(prev => [...prev.slice(0, historyIndex + 1), url]);
        setHistoryIndex(prev => prev + 1);
      }

      debugLog('WebBrowser', 'Navigation initiated', { url, hasAuth });
    } catch (error) {
      // Ignore errors from superseded navigations
      if (gen !== navGenRef.current) return;
      console.error('Navigation failed:', error);
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('401') || msg.includes('Unauthorized')) {
        setLoadError(
          !resolvedCreds
            ? 'Authentication required — No credentials configured for this connection. Edit the connection and add Basic Auth credentials.'
            : 'Authentication required — The saved credentials were rejected by the server. Verify the username and password in the connection settings.',
        );
      } else {
        setLoadError(`Failed to load page: ${msg}`);
      }
      setIsLoading(false);
    }
  }, [hasAuth, resolvedCreds, connection, stopProxy, historyIndex, fetchAndVerifyCert]);

  // ------------------------------------------------------------------
  // Effects
  // ------------------------------------------------------------------

  // Initial load
  useEffect(() => {
    navigateToUrl(currentUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup proxy and timeout on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
      const id = proxySessionIdRef.current;
      if (id) {
        invoke('stop_basic_auth_proxy', { sessionId: id }).catch(() => {});
      }
    };
  }, []);

  // Track in-proxy navigation via the reporter script injected by the backend
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'proxy_navigate' && event.data.url) {
        const proxyOrigin = proxyUrlRef.current;
        if (proxyOrigin && event.data.url.startsWith(proxyOrigin)) {
          const path = event.data.url.slice(proxyOrigin.length);
          const realUrl = currentUrl.replace(/\/+$/, '') + path;
          setInputUrl(realUrl);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentUrl]);

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }

    setCurrentUrl(url);
    setIsSecure(url.startsWith('https://'));
    setLoadError('');
    navigateToUrl(url);
  };

  const handleIframeLoad = () => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setIsLoading(false);

    // When routed through the local proxy, the iframe is same-origin so we
    // can inspect the response.  If the proxy returned a plaintext error
    // (e.g. certificate / upstream failure) we surface it as a loadError
    // instead of showing raw text inside the iframe.
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const body = doc.body?.innerText?.trim() ?? '';
        if (
          body.startsWith('Upstream request failed:') ||
          body.startsWith('Failed to read upstream response:')
        ) {
          setLoadError(body);
          return;
        }
      }
    } catch {
      // Cross-origin — cannot read; that's fine, clear the error.
    }

    setLoadError('');
  };

  const handleRefresh = () => {
    navigateToUrl(currentUrl, false);
  };

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      navigateToUrl(history[newIndex], false);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      navigateToUrl(history[newIndex], false);
    }
  };

  const handleOpenExternal = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  const getSecurityIcon = () => {
    if (isSecure) {
      return (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCertPopup(v => !v); }}
          className="hover:bg-gray-600 rounded p-0.5 transition-colors"
          title="View certificate information"
        >
          <Lock size={14} className="text-green-400" />
        </button>
      );
    } else {
      return <ShieldAlert size={14} className="text-yellow-400" />;
    }
  };

  const getAuthIcon = () => {
    if (hasAuth) {
      return <span data-tooltip="Basic Authentication"><User size={14} className="text-blue-400" /></span>;
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Browser Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-3">
        {/* Navigation Bar */}
        <div className="flex items-center space-x-3 mb-3">
          <div className="flex space-x-1">
            <button
              onClick={handleBack}
              disabled={!canGoBack}
              className={`p-2 rounded transition-colors ${
                canGoBack 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-white' 
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
            <button
              onClick={handleForward}
              disabled={!canGoForward}
              className={`p-2 rounded transition-colors ${
                canGoForward 
                  ? 'hover:bg-gray-700 text-gray-400 hover:text-white' 
                  : 'text-gray-600 cursor-not-allowed'
              }`}
              title="Forward"
            >
              <ArrowRight size={16} />
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          {/* URL Bar */}
          <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center">
            <div className="flex-1 relative">
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                <div className="relative" ref={certPopupRef}>
                  {getSecurityIcon()}
                  {showCertPopup && isSecure && (
                    <CertificateInfoPopup
                      type="tls"
                      host={session.hostname}
                      port={connection?.port || 443}
                      currentIdentity={certIdentity ?? undefined}
                      trustRecord={getStoredIdentity(session.hostname, connection?.port || 443, 'tls', connection?.id)}
                      connectionId={connection?.id}
                      triggerRef={certPopupRef}
                      onClose={() => setShowCertPopup(false)}
                    />
                  )}
                </div>
                {sslVerifyDisabled && (
                  <span title="SSL verification is disabled for this connection" className="flex items-center">
                    <ShieldOff size={14} className="text-red-400" />
                  </span>
                )}
                {getAuthIcon()}
                <Globe size={14} className="text-gray-400 flex-shrink-0" />
                <div className="w-px h-4 bg-gray-600 flex-shrink-0" />
              </div>
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="w-full pr-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                style={{ paddingLeft: `${iconPadding}px` }}
                placeholder="Enter URL..."
              />
            </div>
          </form>

          <button
            onClick={handleOpenExternal}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Open in new tab"
          >
            <ExternalLink size={16} />
          </button>
        </div>

        {/* Security Info */}
        <div className="flex items-center space-x-2 text-xs">
          {isSecure ? (
            <div className="flex items-center space-x-1 text-green-400">
              <Shield size={12} />
              <span>Secure connection (HTTPS)</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1 text-yellow-400">
              <AlertTriangle size={12} />
              <span>Not secure (HTTP)</span>
            </div>
          )}
          <span className="text-gray-500">•</span>
          <span className="text-gray-400">Connected to {session.hostname}</span>
          {hasAuth && (
            <>
              <span className="text-gray-500">•</span>
              <span className="text-blue-400">Basic Auth: {resolvedCreds?.username}</span>
            </>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <p className="text-gray-400 mb-2">Loading {currentUrl}...</p>
              <p className="text-gray-600 text-xs">Taking too long? <button onClick={() => { setIsLoading(false); setLoadError(`Connection timed out. The server at ${currentUrl} did not respond.`); }} className="text-blue-500 hover:text-blue-400 underline">Cancel</button></p>
            </div>
          </div>
        )}

        {loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            {/* Categorized error screen */}
            {loadError.includes('certificate') || loadError.includes('Certificate') || loadError.includes('SSL') || loadError.includes('CERT_') || loadError.includes('self-signed') || loadError.includes('trust provider') ? (
              // Certificate / TLS error
              <>
                <div className="w-16 h-16 rounded-full bg-orange-900/30 flex items-center justify-center mb-4">
                  <ShieldAlert size={32} className="text-orange-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">Certificate Error</h3>
                <p className="text-gray-400 mb-4 max-w-lg text-sm">The connection to <span className="text-yellow-400">{session.hostname}</span> failed because the server&apos;s SSL/TLS certificate is not trusted.</p>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 max-w-lg text-left">
                  <p className="text-sm text-gray-300 font-medium mb-2">This usually means:</p>
                  <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                    <li>The server is using a <span className="text-orange-400">self-signed certificate</span></li>
                    <li>The certificate chain is incomplete or issued by an untrusted CA</li>
                    <li>The certificate has expired or is not yet valid</li>
                    <li>The hostname does not match the certificate&apos;s subject</li>
                  </ul>
                  <p className="text-sm text-gray-300 font-medium mt-3 mb-2">To fix this:</p>
                  <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
                    <li>Edit this connection and <span className="text-blue-400">uncheck &quot;Verify SSL Certificate&quot;</span> to trust self-signed certs</li>
                    <li>Or install the server&apos;s CA certificate into your system trust store</li>
                  </ol>
                </div>
                <details className="mb-4 max-w-lg text-left">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">Technical details</summary>
                  <pre className="mt-2 text-xs text-gray-500 bg-gray-800 border border-gray-700 rounded p-3 whitespace-pre-wrap break-all">{loadError}</pre>
                </details>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Retry Connection</span>
                  </button>
                  <button onClick={handleOpenExternal} className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    <ExternalLink size={14} /> <span>Open Externally</span>
                  </button>
                </div>
              </>
            ) : loadError.includes('refused') || loadError.includes('Upstream request failed') || loadError.includes('proxy') ? (
              // Internal proxy failure
              <>
                <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center mb-4">
                  <ServerCrash size={32} className="text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">Internal Proxy Error</h3>
                <p className="text-gray-400 mb-4 max-w-lg text-sm">{loadError}</p>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 max-w-lg text-left">
                  <p className="text-sm text-gray-300 font-medium mb-2">Troubleshooting steps:</p>
                  <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
                    <li>Open the <span className="text-blue-400">Internal Proxy Manager</span> from the toolbar and check the proxy status</li>
                    <li>Verify the target host <span className="text-yellow-400">{session.hostname}</span> is reachable on your network</li>
                    <li>Check the proxy error log for detailed failure information</li>
                    <li>Try restarting the proxy session via the manager</li>
                  </ol>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Retry Connection</span>
                  </button>
                  <button onClick={handleOpenExternal} className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    <ExternalLink size={14} /> <span>Open Externally</span>
                  </button>
                </div>
              </>
            ) : loadError.includes('timed out') ? (
              // Timeout error
              <>
                <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
                  <WifiOff size={32} className="text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">Connection Timed Out</h3>
                <p className="text-gray-400 mb-4 max-w-lg text-sm">{loadError}</p>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 max-w-lg text-left">
                  <p className="text-sm text-gray-300 font-medium mb-2">Possible causes:</p>
                  <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                    <li>The server at <span className="text-yellow-400">{session.hostname}</span> is not responding</li>
                    <li>A firewall is blocking the connection</li>
                    <li>The hostname or port may be incorrect</li>
                    <li>Network connectivity issues between you and the target</li>
                  </ul>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Try Again</span>
                  </button>
                  <button onClick={handleOpenExternal} className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    <ExternalLink size={14} /> <span>Open Externally</span>
                  </button>
                </div>
              </>
            ) : loadError.includes('Authentication required') ? (
              // Auth error
              <>
                <div className="w-16 h-16 rounded-full bg-blue-900/30 flex items-center justify-center mb-4">
                  <Shield size={32} className="text-blue-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">Authentication Required</h3>
                <p className="text-gray-400 mb-4 max-w-lg text-sm">{loadError}</p>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 max-w-lg text-left">
                  <p className="text-sm text-gray-300 font-medium mb-2">To fix this:</p>
                  <ol className="list-decimal list-inside text-sm text-gray-400 space-y-1">
                    <li>Edit this connection in the sidebar</li>
                    <li>Set Authentication Type to <span className="text-blue-400">Basic Authentication</span></li>
                    <li>Enter the correct username and password</li>
                    <li>Save and reconnect</li>
                  </ol>
                </div>
                <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                  <RefreshCw size={14} /> <span>Try Again</span>
                </button>
              </>
            ) : (
              // Generic error
              <>
                <div className="w-16 h-16 rounded-full bg-yellow-900/30 flex items-center justify-center mb-4">
                  <AlertTriangle size={32} className="text-yellow-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">Unable to Load Webpage</h3>
                <p className="text-gray-400 mb-4 max-w-lg text-sm">{loadError}</p>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 max-w-lg text-left">
                  <p className="text-sm text-gray-300 font-medium mb-2">Common issues:</p>
                  <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
                    <li>The website blocks embedding (X-Frame-Options)</li>
                    <li>CORS restrictions prevent loading</li>
                    <li>The server is not responding</li>
                    <li>Invalid URL or hostname</li>
                  </ul>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Try Again</span>
                  </button>
                  <button onClick={handleOpenExternal} className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    <ExternalLink size={14} /> <span>Open Externally</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src="about:blank"
            className="w-full h-full border-0"
            title={session.name}
            onLoad={handleIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          />
        )}
      </div>

      {/* Trust Warning Dialog */}
      {trustPrompt && certIdentity && (
        <TrustWarningDialog
          type="tls"
          host={session.hostname}
          port={connection?.port || 443}
          reason={trustPrompt.status === 'mismatch' ? 'mismatch' : 'first-use'}
          receivedIdentity={certIdentity}
          storedIdentity={trustPrompt.status === 'mismatch' ? trustPrompt.stored : undefined}
          onAccept={handleTrustAccept}
          onReject={handleTrustReject}
        />
      )}
    </div>
  );
};