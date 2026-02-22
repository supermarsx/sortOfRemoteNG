import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { debugLog } from '../utils/debugLogger';
import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
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
  WifiOff,
  RefreshCw,
  Star,
  Pencil,
  Trash2,
  Copy,
  FolderPlus,
  ChevronRight,
  Download,
  ClipboardCopy,
  FolderOpen,
} from 'lucide-react';
import { ConnectionSession, HttpBookmarkItem } from '../types/connection';
import { useConnections } from '../contexts/useConnections';
import { useSettings } from '../contexts/SettingsContext';
import { useToastContext } from '../contexts/ToastContext';
import { generateId } from '../utils/id';
import { CertificateInfoPopup } from './CertificateInfoPopup';
import { TrustWarningDialog } from './TrustWarningDialog';
import { InputDialog } from './InputDialog';
import { ConfirmDialog } from './ConfirmDialog';
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
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();
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

  // Bookmark context menu state  —  idx is the top-level index, folderPath
  // is set when the right-clicked item lives inside a subfolder.
  const [bmContextMenu, setBmContextMenu] = useState<{
    x: number; y: number; idx: number; folderPath?: number[];
  } | null>(null);
  // Context menu when right-clicking the bookmark bar background (not a chip)
  const [bmBarContextMenu, setBmBarContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingBmIdx, setEditingBmIdx] = useState<number | null>(null);
  const [editBmName, setEditBmName] = useState('');
  const editBmRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Drag-to-reorder state (top-level only)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Open subfolder names
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());

  // ---- Proxy health / keepalive ----
  const [proxyAlive, setProxyAlive] = useState(true);
  const [proxyRestarting, setProxyRestarting] = useState(false);
  const autoRestartCountRef = useRef(0);

  // ---- Themed dialogs ----
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

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
      if (hasAuth && resolvedCreds) {
        debugLog('WebBrowser', 'Starting auth proxy for', { url });

        // Always use the origin (scheme://host:port) as the proxy target so that
        // every request from the page resolves relative to the site root, not
        // to the specific page path we happen to be loading.
        const urlObj = new URL(url);
        const targetOrigin = urlObj.origin + '/';
        const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;

        // If we already have a proxy running for the same origin, just change
        // the iframe path — no need to tear down and restart.
        if (proxySessionIdRef.current && proxyUrlRef.current) {
          const proxyBase = proxyUrlRef.current.replace(/\/+$/, '');
          if (iframeRef.current) {
            iframeRef.current.src = proxyBase + pagePath;
          }
        } else {
          // Tear down any previous proxy session
          await stopProxy();
          // Re-check generation after the async stop
          if (gen !== navGenRef.current) return;

          const response = await invoke<ProxyMediatorResponse>('start_basic_auth_proxy', {
            config: {
              target_url: targetOrigin,
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

          // Point the iframe at the local proxy + the page path so the initial
          // page loads correctly while all other requests use the site root.
          if (iframeRef.current) {
            const proxyBase = response.proxy_url.replace(/\/+$/, '');
            iframeRef.current.src = proxyBase + pagePath;
          }
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

  // ---- Proxy keepalive polling ----
  // Periodically check whether the proxy port is still alive.  If it
  // isn't, mark proxyAlive=false so the UI can show a reconnect banner.
  // Auto-restart is attempted up to the configured limit; if that also
  // fails we leave the banner visible so the user can trigger a manual restart.
  useEffect(() => {
    if (!hasAuth) return;           // no proxy when auth is not needed
    if (!settings.proxyKeepaliveEnabled) return; // keepalive disabled in settings
    const intervalMs = (settings.proxyKeepaliveIntervalSeconds ?? 10) * 1000;
    const id = setInterval(async () => {
      const sid = proxySessionIdRef.current;
      if (!sid) return;             // proxy not started yet
      try {
        const results = await invoke<Array<{ session_id: string; alive: boolean; error?: string }>>(
          'check_proxy_health',
          { sessionIds: [sid] },
        );
        const entry = results.find(r => r.session_id === sid);
        if (entry && !entry.alive) {
          debugLog('WebBrowser', 'Proxy health check failed — attempting auto-restart', { sid, error: entry.error });
          setProxyAlive(false);

          const maxRestarts = settings.proxyMaxAutoRestarts ?? 5;
          const canAutoRestart = settings.proxyAutoRestart && (maxRestarts === 0 || autoRestartCountRef.current < maxRestarts);

          if (canAutoRestart) {
            try {
              const resp = await invoke<ProxyMediatorResponse>('restart_proxy_session', { sessionId: sid });
              proxySessionIdRef.current = resp.session_id;
              proxyUrlRef.current = resp.proxy_url;
              autoRestartCountRef.current += 1;
              setProxyAlive(true);
              // Re-point the iframe at the new proxy
              if (iframeRef.current) {
                const urlObj = new URL(currentUrl);
                const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
                iframeRef.current.src = resp.proxy_url.replace(/\/+$/, '') + pagePath;
              }
              debugLog('WebBrowser', 'Proxy auto-restarted successfully', {
                newSessionId: resp.session_id,
                restartCount: autoRestartCountRef.current,
              });
            } catch (restartErr) {
              debugLog('WebBrowser', 'Auto-restart failed — user intervention needed', { restartErr });
            }
          } else {
            debugLog('WebBrowser', 'Auto-restart skipped (disabled or limit reached)', {
              autoRestart: settings.proxyAutoRestart,
              count: autoRestartCountRef.current,
              max: maxRestarts,
            });
          }
        } else if (entry && entry.alive) {
          // Only flip back to true if we previously marked it dead
          setProxyAlive(true);
        }
      } catch {
        // check_proxy_health command itself failed (e.g. app shutting down) — ignore
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [hasAuth, currentUrl, settings.proxyKeepaliveEnabled, settings.proxyKeepaliveIntervalSeconds, settings.proxyAutoRestart, settings.proxyMaxAutoRestarts]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Manually restart a dead proxy session. */
  const handleRestartProxy = useCallback(async () => {
    const sid = proxySessionIdRef.current;
    if (!sid) {
      // No existing session — do a full navigateToUrl which creates a new proxy
      navigateToUrl(currentUrl);
      return;
    }
    setProxyRestarting(true);
    try {
      const resp = await invoke<ProxyMediatorResponse>('restart_proxy_session', { sessionId: sid });
      proxySessionIdRef.current = resp.session_id;
      proxyUrlRef.current = resp.proxy_url;
      setProxyAlive(true);
      if (iframeRef.current) {
        const urlObj = new URL(currentUrl);
        const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
        iframeRef.current.src = resp.proxy_url.replace(/\/+$/, '') + pagePath;
      }
    } catch {
      // Restart via the stored session failed — fall back to a full re-navigate
      // which will create a brand-new proxy from scratch.
      proxySessionIdRef.current = '';
      proxyUrlRef.current = '';
      navigateToUrl(currentUrl);
    } finally {
      setProxyRestarting(false);
    }
  }, [currentUrl, navigateToUrl]);

  // Track in-proxy navigation via the reporter script injected by the backend.
  // We keep a ref to the base target URL so the listener is stable and does not
  // depend on currentUrl (which would recreate the listener on every nav).
  const baseTargetRef = useRef(buildTargetUrl().replace(/\/+$/, ''));
  useEffect(() => {
    baseTargetRef.current = buildTargetUrl().replace(/\/+$/, '');
  }, [buildTargetUrl]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'proxy_navigate' && event.data.url) {
        const proxyOrigin = proxyUrlRef.current;
        if (proxyOrigin && event.data.url.startsWith(proxyOrigin)) {
          const rawPath = event.data.url.slice(proxyOrigin.length);
          const path = rawPath && !rawPath.startsWith('/') ? '/' + rawPath : rawPath;
          const realUrl = baseTargetRef.current + (path || '/');
          setCurrentUrl(realUrl);
          setInputUrl(realUrl);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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

  /** Open the current URL in a new session tab within the app.
   *  The session status is set to 'connected' immediately so the WebBrowser
   *  component mounts and starts its own proxy. */
  const handleOpenInNewTab = () => {
    if (!connection) return;
    const newSession: ConnectionSession = {
      id: generateId(),
      connectionId: connection.id,
      name: `${connection.name} (tab)`,
      status: 'connected',
      startTime: new Date(),
      protocol: connection.protocol,
      hostname: connection.hostname,
    };
    dispatch({ type: 'ADD_SESSION', payload: newSession });
  };

  /** Open the current URL in the OS default browser */
  const handleOpenExternal = () => {
    invoke('open_url_external', { url: currentUrl }).catch(() => {
      // Fallback if the Rust command isn't available
      window.open(currentUrl, '_blank', 'noopener,noreferrer');
    });
  };

  // ---- Active bookmark detection ----
  /** Collect all leaf paths from the bookmark tree so we can check quickly. */
  const collectPaths = useCallback((items: HttpBookmarkItem[]): string[] => {
    const out: string[] = [];
    for (const bm of items) {
      if (bm.isFolder) out.push(...collectPaths(bm.children));
      else out.push(bm.path);
    }
    return out;
  }, []);

  const currentPath = useMemo(() => {
    const base = buildTargetUrl().replace(/\/+$/, '');
    const url = inputUrl || currentUrl;
    const raw = url.startsWith(base) ? url.slice(base.length) : '/';
    return raw && raw.startsWith('/') ? raw : '/' + raw;
  }, [inputUrl, currentUrl, buildTargetUrl]);

  const activeBookmarkPaths = useMemo(
    () => new Set(collectPaths(connection?.httpBookmarks || [])),
    [connection?.httpBookmarks, collectPaths],
  );
  const isCurrentPageBookmarked = activeBookmarkPaths.has(currentPath);

  /** Save the current page as a bookmark on this connection */
  const handleAddBookmark = () => {
    if (!connection) return;
    const url = inputUrl || currentUrl;
    const base = buildTargetUrl().replace(/\/+$/, '');
    const rawPath = url.startsWith(base) ? url.slice(base.length) : '/';
    const normalizedPath = rawPath && rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    // Avoid duplicate paths (check whole tree)
    if (activeBookmarkPaths.has(normalizedPath)) return;
    const name = normalizedPath === '/' ? 'Home' : decodeURIComponent(normalizedPath.split('/').filter(Boolean).pop() || 'Page');
    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: { ...connection, httpBookmarks: [...(connection.httpBookmarks || []), { name, path: normalizedPath }] },
    });
  };

  /** Move a top-level bookmark to a new position (drag or context menu) */
  const handleMoveBookmark = (fromIdx: number, toIdx: number) => {
    if (!connection) return;
    const bookmarks = [...(connection.httpBookmarks || [])];
    if (toIdx < 0 || toIdx >= bookmarks.length) return;
    const [moved] = bookmarks.splice(fromIdx, 1);
    bookmarks.splice(toIdx, 0, moved);
    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: bookmarks } });
  };

  /** Remove a top-level bookmark by index */
  const handleRemoveBookmark = (idx: number) => {
    if (!connection) return;
    const bookmarks = [...(connection.httpBookmarks || [])];
    bookmarks.splice(idx, 1);
    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: bookmarks } });
  };

  /** Rename a top-level bookmark */
  const handleRenameBookmark = (idx: number, newName: string) => {
    if (!connection || !newName.trim()) return;
    const bookmarks = [...(connection.httpBookmarks || [])];
    bookmarks[idx] = { ...bookmarks[idx], name: newName.trim() };
    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: bookmarks } });
  };

  /** Delete ALL bookmarks */
  const handleDeleteAllBookmarks = () => {
    if (!connection) return;
    if (settings.confirmDeleteAllBookmarks) {
      setShowDeleteAllConfirm(true);
    } else {
      dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: [] } });
    }
  };

  const confirmDeleteAllBookmarks = () => {
    if (!connection) return;
    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: [] } });
    setShowDeleteAllConfirm(false);
  };

  /** Create a new subfolder at the top level */
  const handleAddFolder = () => {
    if (!connection) return;
    setShowNewFolderDialog(true);
  };

  const confirmAddFolder = (folderName: string) => {
    if (!connection || !folderName) return;
    const folder: HttpBookmarkItem = { name: folderName, isFolder: true, children: [] };
    dispatch({
      type: 'UPDATE_CONNECTION',
      payload: { ...connection, httpBookmarks: [...(connection.httpBookmarks || []), folder] },
    });
    setShowNewFolderDialog(false);
  };

  /** Move a bookmark into or out of a folder */
  const handleMoveToFolder = (bmIdx: number, folderIdx: number) => {
    if (!connection) return;
    const bookmarks = [...(connection.httpBookmarks || [])].map(b =>
      b.isFolder ? { ...b, children: [...b.children] } : { ...b },
    );
    const [item] = bookmarks.splice(bmIdx, 1);
    if (item.isFolder) return; // don't nest folders
    const folder = bookmarks[folderIdx > bmIdx ? folderIdx - 1 : folderIdx];
    if (folder && folder.isFolder) {
      folder.children.push(item);
    }
    dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: bookmarks } });
  };

  /** Remove bookmark inside a folder */
  const handleRemoveFromFolder = (folderIdx: number, childIdx: number) => {
    if (!connection) return;
    const bookmarks = [...(connection.httpBookmarks || [])].map(b =>
      b.isFolder ? { ...b, children: [...b.children] } : { ...b },
    );
    const folder = bookmarks[folderIdx];
    if (folder && folder.isFolder) {
      folder.children.splice(childIdx, 1);
      dispatch({ type: 'UPDATE_CONNECTION', payload: { ...connection, httpBookmarks: bookmarks } });
    }
  };

  /** Save the current page as a PDF via the print-to-PDF flow */
  const handleSavePage = async () => {
    if (!connection) return;
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('-');
    const defaultName = `${connection.name}-${ts}.pdf`;
    try {
      const filePath = await saveDialog({
        title: 'Save page as PDF',
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!filePath) return;
      // Use the Tauri webview print_to_pdf if available, otherwise fall back
      // to triggering the browser print dialog on the iframe.
      try {
        await invoke('save_page_as_pdf', { sessionId: proxySessionIdRef.current, outputPath: filePath });
      } catch {
        // Fallback: trigger the iframe print dialog
        iframeRef.current?.contentWindow?.print();
      }
    } catch (e) {
      console.error('Save page failed:', e);
    }
  };

  /** Copy all text content from the current page to clipboard */
  const handleCopyAll = async () => {
    // Strategy 1: read the iframe DOM directly (works when same-origin / proxied)
    try {
      const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
      if (iframeDoc) {
        const text = iframeDoc.body?.innerText || iframeDoc.body?.textContent || '';
        if (text.trim()) {
          await navigator.clipboard.writeText(text);
          toast.success('Page content copied to clipboard');
          return;
        }
      }
    } catch {
      // Cross-origin — fall through to strategy 2
    }

    // Strategy 2: fetch the page HTML through the proxy URL and extract text
    try {
      const proxyUrl = proxyUrlRef.current;
      if (proxyUrl) {
        const urlObj = new URL(currentUrl);
        const pagePath = urlObj.pathname + urlObj.search;
        const fetchUrl = proxyUrl.replace(/\/+$/, '') + pagePath;
        const resp = await fetch(fetchUrl);
        if (resp.ok) {
          const html = await resp.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const text = doc.body?.innerText || doc.body?.textContent || '';
          if (text.trim()) {
            await navigator.clipboard.writeText(text);
            toast.success('Page content copied to clipboard');
            return;
          }
        }
      }
    } catch {
      // fetch failed — fall through
    }

    toast.error('Could not copy page content — the page may be empty or inaccessible');
  };

  // Drag handlers for bookmark reordering
  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };
  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) {
      handleMoveBookmark(dragIdx, idx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // Close context menu on outside click
  useEffect(() => {
    if (!bmContextMenu && !bmBarContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setBmContextMenu(null);
        setBmBarContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [bmContextMenu, bmBarContextMenu]);

  // Focus inline rename input
  useEffect(() => {
    if (editingBmIdx !== null) {
      setTimeout(() => editBmRef.current?.focus(), 30);
    }
  }, [editingBmIdx]);

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
            onClick={handleAddBookmark}
            className={`p-2 hover:bg-gray-700 rounded transition-colors ${
              isCurrentPageBookmarked ? 'text-yellow-400' : 'text-gray-400 hover:text-yellow-400'
            }`}
            title={isCurrentPageBookmarked ? 'Page is bookmarked' : 'Bookmark this page'}
          >
            <Star size={16} fill={isCurrentPageBookmarked ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={handleSavePage}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Save page as PDF"
          >
            <Download size={16} />
          </button>
          <button
            onClick={handleCopyAll}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Copy all page content"
          >
            <ClipboardCopy size={16} />
          </button>
          <button
            onClick={handleOpenInNewTab}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Open in new tab"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={handleOpenExternal}
            className="p-2 hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-white"
            title="Open in external browser"
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

      {/* Bookmark Bar — always visible */}
      <div
        className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1 flex items-center gap-1 overflow-x-auto min-h-[28px] relative"
        onContextMenu={(e) => {
          // Only fire when clicking the bar background, not a child chip
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setBmBarContextMenu({ x: e.clientX, y: e.clientY });
          }
        }}
      >
        <Star
          size={11}
          className={`flex-shrink-0 ${isCurrentPageBookmarked ? 'text-yellow-400' : 'text-yellow-400/60'}`}
          fill={isCurrentPageBookmarked ? 'currentColor' : 'none'}
        />

        {/* Render top-level bookmarks & folders */}
        {(connection?.httpBookmarks || []).map((bm, idx) => {
          const baseUrl = buildTargetUrl().replace(/\/+$/, '');

          // ---- Folder chip ----
          if (bm.isFolder) {
            const isOpen = openFolders.has(idx);
            return (
              <div key={`folder-${idx}`} className="relative flex-shrink-0">
                <button
                  onClick={() => setOpenFolders(prev => {
                    const next = new Set(prev);
                    if (next.has(idx)) next.delete(idx); else next.add(idx);
                    return next;
                  })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
                  }}
                  draggable
                  onDragStart={handleDragStart(idx)}
                  onDragOver={handleDragOver(idx)}
                  onDrop={handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors whitespace-nowrap flex items-center gap-1 ${
                    dragOverIdx === idx ? 'ring-1 ring-[var(--color-primary)]' : ''
                  }`}
                  title={bm.name}
                >
                  <FolderOpen size={11} />
                  {bm.name}
                  <ChevronRight size={10} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                </button>
                {/* Folder dropdown */}
                {isOpen && (
                  <div className="absolute left-0 top-full mt-0.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-xl z-40 min-w-[140px] py-0.5">
                    {bm.children.length === 0 && (
                      <span className="text-xs text-[var(--color-textMuted,var(--color-textSecondary))] italic px-3 py-1 block select-none">Empty folder</span>
                    )}
                    {bm.children.map((child, cIdx) => {
                      if (child.isFolder) return null; // no nested folders rendered
                      const childUrl = baseUrl + child.path;
                      const isActive = child.path === currentPath;
                      return (
                        <button
                          key={cIdx}
                          onClick={() => {
                            setCurrentUrl(childUrl);
                            setInputUrl(childUrl);
                            setLoadError('');
                            navigateToUrl(childUrl);
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setBmContextMenu({ x: e.clientX, y: e.clientY, idx, folderPath: [cIdx] });
                          }}
                          className={`w-full text-left px-3 py-1 text-xs hover:bg-[var(--color-surfaceHover)] transition-colors whitespace-nowrap flex items-center gap-1 ${
                            isActive ? 'text-yellow-400 font-semibold' : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)]'
                          }`}
                          title={child.path}
                        >
                          {isActive && <Star size={9} fill="currentColor" />}
                          {child.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // ---- Regular bookmark chip ----
          const bookmarkUrl = baseUrl + bm.path;
          const isActive = bm.path === currentPath;

          return editingBmIdx === idx ? (
            <input
              key={idx}
              ref={editBmRef}
              type="text"
              value={editBmName}
              onChange={(e) => setEditBmName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameBookmark(idx, editBmName);
                  setEditingBmIdx(null);
                } else if (e.key === 'Escape') {
                  setEditingBmIdx(null);
                }
              }}
              onBlur={() => {
                handleRenameBookmark(idx, editBmName);
                setEditingBmIdx(null);
              }}
              className="text-xs px-2 py-0.5 rounded bg-[var(--color-background)] border border-[var(--color-primary)] text-[var(--color-text)] w-28 focus:outline-none"
            />
          ) : (
            <button
              key={idx}
              draggable
              onDragStart={handleDragStart(idx)}
              onDragOver={handleDragOver(idx)}
              onDrop={handleDrop(idx)}
              onDragEnd={handleDragEnd}
              onClick={() => {
                setCurrentUrl(bookmarkUrl);
                setInputUrl(bookmarkUrl);
                setLoadError('');
                navigateToUrl(bookmarkUrl);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setBmContextMenu({ x: e.clientX, y: e.clientY, idx });
              }}
              className={`text-xs px-2 py-0.5 rounded hover:bg-[var(--color-surfaceHover)] transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${
                dragOverIdx === idx ? 'ring-1 ring-[var(--color-primary)]' : ''
              } ${
                isActive
                  ? 'text-yellow-400 font-semibold bg-[var(--color-surfaceHover)]'
                  : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)]'
              }`}
              title={bm.path}
            >
              {isActive && <Star size={9} fill="currentColor" />}
              {bm.name}
            </button>
          );
        })}

        {(connection?.httpBookmarks || []).length === 0 && (
          <span className="text-xs text-[var(--color-textMuted,var(--color-textSecondary))] italic select-none">Right-click bar to add folders — use ★ to save pages</span>
        )}

        {/* ---- Bookmark chip / folder Context Menu ---- */}
        {bmContextMenu && (
          <div
            ref={contextMenuRef}
            className="fixed bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 z-50 min-w-[170px]"
            style={{ left: bmContextMenu.x, top: bmContextMenu.y }}
          >
            {/* If inside a folder child */}
            {bmContextMenu.folderPath ? (
              <>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--color-surfaceHover)] hover:text-red-300 flex items-center gap-2"
                  onClick={() => {
                    handleRemoveFromFolder(bmContextMenu.idx, bmContextMenu.folderPath![0]);
                    setBmContextMenu(null);
                  }}
                >
                  <Trash2 size={12} /> Remove from folder
                </button>
              </>
            ) : (
              <>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                  onClick={() => {
                    const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
                    if (bm) {
                      setEditBmName(bm.name);
                      setEditingBmIdx(bmContextMenu.idx);
                    }
                    setBmContextMenu(null);
                  }}
                >
                  <Pencil size={12} /> Rename
                </button>
                {/* Copy URL — only for leaf bookmarks */}
                {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                    onClick={() => {
                      const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
                      if (bm && !bm.isFolder) {
                        const baseUrl = buildTargetUrl().replace(/\/+$/, '');
                        navigator.clipboard.writeText(baseUrl + bm.path).catch(() => {});
                      }
                      setBmContextMenu(null);
                    }}
                  >
                    <Copy size={12} /> Copy URL
                  </button>
                )}
                {/* Open externally — only for leaf bookmarks */}
                {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                    onClick={() => {
                      const bm = (connection?.httpBookmarks || [])[bmContextMenu.idx];
                      if (bm && !bm.isFolder) {
                        const baseUrl = buildTargetUrl().replace(/\/+$/, '');
                        invoke('open_url_external', { url: baseUrl + bm.path }).catch(() => {
                          window.open(baseUrl + bm.path, '_blank', 'noopener,noreferrer');
                        });
                      }
                      setBmContextMenu(null);
                    }}
                  >
                    <ExternalLink size={12} /> Open externally
                  </button>
                )}
                <div className="border-t border-[var(--color-border)] my-1" />
                {/* Move to folder — available folders listed */}
                {!(connection?.httpBookmarks || [])[bmContextMenu.idx]?.isFolder &&
                  (connection?.httpBookmarks || []).some((b, i) => b.isFolder && i !== bmContextMenu.idx) && (
                    <>
                      {(connection?.httpBookmarks || []).map((b, i) =>
                        b.isFolder && i !== bmContextMenu.idx ? (
                          <button
                            key={i}
                            className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                            onClick={() => {
                              handleMoveToFolder(bmContextMenu.idx, i);
                              setBmContextMenu(null);
                            }}
                          >
                            <FolderOpen size={12} /> Move to {b.name}
                          </button>
                        ) : null,
                      )}
                      <div className="border-t border-[var(--color-border)] my-1" />
                    </>
                  )}
                {bmContextMenu.idx > 0 && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                    onClick={() => {
                      handleMoveBookmark(bmContextMenu.idx, bmContextMenu.idx - 1);
                      setBmContextMenu(null);
                    }}
                  >
                    <ArrowLeft size={12} /> Move left
                  </button>
                )}
                {bmContextMenu.idx < (connection?.httpBookmarks || []).length - 1 && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
                    onClick={() => {
                      handleMoveBookmark(bmContextMenu.idx, bmContextMenu.idx + 1);
                      setBmContextMenu(null);
                    }}
                  >
                    <ArrowRight size={12} /> Move right
                  </button>
                )}
                <div className="border-t border-[var(--color-border)] my-1" />
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--color-surfaceHover)] hover:text-red-300 flex items-center gap-2"
                  onClick={() => {
                    handleRemoveBookmark(bmContextMenu.idx);
                    setBmContextMenu(null);
                  }}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </>
            )}
          </div>
        )}

        {/* ---- Bar background Context Menu (right-click empty area) ---- */}
        {bmBarContextMenu && (
          <div
            ref={contextMenuRef}
            className="fixed bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 z-50 min-w-[170px]"
            style={{ left: bmBarContextMenu.x, top: bmBarContextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
              onClick={() => {
                handleAddFolder();
                setBmBarContextMenu(null);
              }}
            >
              <FolderPlus size={12} /> New folder
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)] flex items-center gap-2"
              onClick={() => {
                handleAddBookmark();
                setBmBarContextMenu(null);
              }}
            >
              <Star size={12} /> Bookmark this page
            </button>
            {(connection?.httpBookmarks || []).length > 0 && (
              <>
                <div className="border-t border-[var(--color-border)] my-1" />
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--color-surfaceHover)] hover:text-red-300 flex items-center gap-2"
                  onClick={() => {
                    handleDeleteAllBookmarks();
                    setBmBarContextMenu(null);
                  }}
                >
                  <Trash2 size={12} /> Delete all bookmarks
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {/* Proxy-dead banner — shown when the keepalive detects a dead proxy */}
        {hasAuth && !proxyAlive && !isLoading && !loadError && (
          <div className="absolute top-0 inset-x-0 z-20 bg-red-900/90 border-b border-red-700 px-4 py-2 flex items-center justify-between text-xs text-red-200">
            <div className="flex items-center gap-2">
              <WifiOff size={14} className="text-red-400" />
              <span>Internal proxy session died unexpectedly.</span>
            </div>
            <button
              onClick={handleRestartProxy}
              disabled={proxyRestarting}
              className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={proxyRestarting ? 'animate-spin' : ''} />
              {proxyRestarting ? 'Restarting…' : 'Reconnect proxy'}
            </button>
          </div>
        )}

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
                    <li>The internal proxy session may have died</li>
                  </ul>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Try Again</span>
                  </button>
                  {hasAuth && (
                    <button onClick={handleRestartProxy} disabled={proxyRestarting} className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      <RefreshCw size={14} className={proxyRestarting ? 'animate-spin' : ''} /> <span>{proxyRestarting ? 'Restarting…' : 'Reconnect Proxy'}</span>
                    </button>
                  )}
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
                    <li>The internal proxy may have died unexpectedly</li>
                    <li>Invalid URL or hostname</li>
                  </ul>
                </div>
                <div className="flex items-center space-x-3">
                  <button onClick={handleRefresh} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                    <RefreshCw size={14} /> <span>Try Again</span>
                  </button>
                  {hasAuth && (
                    <button onClick={handleRestartProxy} disabled={proxyRestarting} className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      <RefreshCw size={14} className={proxyRestarting ? 'animate-spin' : ''} /> <span>{proxyRestarting ? 'Restarting…' : 'Reconnect Proxy'}</span>
                    </button>
                  )}
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

      {/* New Folder dialog (themed) */}
      <InputDialog
        isOpen={showNewFolderDialog}
        title="New Folder"
        message="Enter a name for the new bookmark folder:"
        placeholder="Folder name"
        confirmText="Create"
        onConfirm={confirmAddFolder}
        onCancel={() => setShowNewFolderDialog(false)}
      />

      {/* Delete all bookmarks confirmation */}
      <ConfirmDialog
        isOpen={showDeleteAllConfirm}
        title="Delete All Bookmarks"
        message="Are you sure you want to delete all bookmarks for this connection? This cannot be undone."
        confirmText="Delete All"
        variant="danger"
        onConfirm={confirmDeleteAllBookmarks}
        onCancel={() => setShowDeleteAllConfirm(false)}
      />
    </div>
  );
};