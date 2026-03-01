import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { debugLog } from "../../utils/debugLogger";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ConnectionSession, HttpBookmarkItem } from "../../types/connection";
import { TOTPConfig } from "../../types/settings";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { generateId } from "../../utils/id";
import { useWebRecorder } from "../recording/useWebRecorder";
import { useDisplayRecorder } from "../recording/useDisplayRecorder";
import * as macroService from "../../utils/macroService";
import {
  verifyIdentity,
  trustIdentity,
  getEffectiveTrustPolicy,
  type CertIdentity,
  type TrustVerifyResult,
} from "../../utils/trustStore";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface ProxyMediatorResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
}

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useWebBrowser(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const { toast } = useToastContext();
  const connection = state.connections.find(
    (c) => c.id === session.connectionId,
  );

  // ── Derived auth ────────────────────────────────────────────
  const resolvedCreds = useMemo<{
    username: string;
    password: string;
  } | null>(() => {
    if (!connection) return null;
    if (
      connection.authType === "basic" &&
      connection.basicAuthUsername &&
      connection.basicAuthPassword
    ) {
      return {
        username: connection.basicAuthUsername,
        password: connection.basicAuthPassword,
      };
    }
    if (connection.username && connection.password) {
      return { username: connection.username, password: connection.password };
    }
    return null;
  }, [connection]);

  const hasAuth = resolvedCreds !== null;

  const buildTargetUrl = useCallback(() => {
    const protocol = session.protocol === "https" ? "https" : "http";
    const defaultPort = session.protocol === "https" ? 443 : 80;
    const port = connection?.port || defaultPort;
    const portSuffix = port === defaultPort ? "" : `:${port}`;
    return `${protocol}://${session.hostname}${portSuffix}/`;
  }, [connection, session.protocol, session.hostname]);

  // ── State ───────────────────────────────────────────────────
  const [currentUrl, setCurrentUrl] = useState(buildTargetUrl);
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [isSecure, setIsSecure] = useState(session.protocol === "https");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Certificate trust ──────────────────────────────────────
  const [showCertPopup, setShowCertPopup] = useState(false);
  const [certIdentity, setCertIdentity] = useState<CertIdentity | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(
    null,
  );
  const trustResolveRef = useRef<((accept: boolean) => void) | null>(null);
  const certPopupRef = useRef<HTMLDivElement>(null);

  // ── Proxy tracking ─────────────────────────────────────────
  const proxySessionIdRef = useRef<string>("");
  const proxyUrlRef = useRef<string>("");
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navGenRef = useRef(0);
  const LOAD_TIMEOUT_MS = 30_000;

  const sslVerifyDisabled =
    connection &&
    connection.protocol === "https" &&
    (connection as unknown as Record<string, unknown>)?.httpVerifySsl === false;
  const iconCount = 2 + (hasAuth ? 1 : 0) + (sslVerifyDisabled ? 1 : 0);
  const iconPadding = 12 + iconCount * 22 + 16;

  // ── Bookmark state ─────────────────────────────────────────
  const [bmContextMenu, setBmContextMenu] = useState<{
    x: number;
    y: number;
    idx: number;
    folderPath?: number[];
  } | null>(null);
  const [bmBarContextMenu, setBmBarContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [editingBmIdx, setEditingBmIdx] = useState<number | null>(null);
  const [editBmName, setEditBmName] = useState("");
  const editBmRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<number>>(new Set());
  const folderButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // ── Proxy health ───────────────────────────────────────────
  const [proxyAlive, setProxyAlive] = useState(true);
  const [proxyRestarting, setProxyRestarting] = useState(false);
  const autoRestartCountRef = useRef(0);

  // ── Dialogs ────────────────────────────────────────────────
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showTotpPanel, setShowTotpPanel] = useState(false);
  const totpBtnRef = useRef<HTMLDivElement>(null);

  // ── Recording ──────────────────────────────────────────────
  const webRecorder = useWebRecorder();
  const displayRecorder = useDisplayRecorder();
  const [showRecordingNamePrompt, setShowRecordingNamePrompt] = useState<
    "har" | "video" | null
  >(null);
  const pendingRecordingRef = useRef<unknown>(null);

  const totpConfigs = connection?.totpConfigs ?? [];
  const handleUpdateTotpConfigs = useCallback(
    (configs: TOTPConfig[]) => {
      if (connection) {
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: { ...connection, totpConfigs: configs },
        });
      }
    },
    [connection, dispatch],
  );

  const closeFolderDropdown = useCallback((idx: number) => {
    setOpenFolders((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }, []);

  // ── TLS cert trust ─────────────────────────────────────────
  const fetchAndVerifyCert = useCallback(async (): Promise<boolean> => {
    if (session.protocol !== "https") return true;
    const port = connection?.port || 443;
    const policy = getEffectiveTrustPolicy(
      connection?.tlsTrustPolicy,
      settings.tlsTrustPolicy,
    );
    if (policy === "always-trust") return true;
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
      }>("get_tls_certificate_info", { host: session.hostname, port });
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
      const result = verifyIdentity(session.hostname, port, "tls", identity, connId);
      if (result.status === "trusted") return true;
      if (result.status === "first-use" && policy === "tofu") {
        trustIdentity(session.hostname, port, "tls", identity, false, connId);
        return true;
      }
      if (
        result.status === "mismatch" ||
        policy === "always-ask" ||
        policy === "strict"
      ) {
        return new Promise<boolean>((resolve) => {
          trustResolveRef.current = resolve;
          setTrustPrompt(result);
        });
      }
      return true;
    } catch (err) {
      debugLog("WebBrowser", "Failed to fetch TLS cert info", { err });
      return true;
    }
  }, [session.protocol, session.hostname, connection, settings.tlsTrustPolicy]);

  const handleTrustAccept = useCallback(() => {
    if (trustPrompt && certIdentity) {
      const port = connection?.port || 443;
      trustIdentity(session.hostname, port, "tls", certIdentity, true, connection?.id);
    }
    setTrustPrompt(null);
    trustResolveRef.current?.(true);
    trustResolveRef.current = null;
  }, [trustPrompt, certIdentity, session.hostname, connection]);

  const handleTrustReject = useCallback(() => {
    setTrustPrompt(null);
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setLoadError("Connection aborted: certificate not trusted by user.");
    setIsLoading(false);
  }, []);

  // ── Proxy lifecycle ────────────────────────────────────────
  const stopProxy = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? proxySessionIdRef.current;
    if (!id) return;
    try {
      await invoke("stop_basic_auth_proxy", { sessionId: id });
    } catch {
      // Session may already be gone
    }
    if (!sessionId || sessionId === proxySessionIdRef.current) {
      proxySessionIdRef.current = "";
      proxyUrlRef.current = "";
    }
  }, []);

  // ── Navigation ─────────────────────────────────────────────
  const navigateToUrl = useCallback(
    async (url: string, addToHistory = true) => {
      const gen = ++navGenRef.current;
      setIsLoading(true);
      setLoadError("");
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      if (url.startsWith("https://")) {
        const trusted = await fetchAndVerifyCert();
        if (!trusted) return;
        if (gen !== navGenRef.current) return;
      }
      loadTimeoutRef.current = setTimeout(() => {
        setIsLoading(false);
        setLoadError(
          `Connection timed out after ${LOAD_TIMEOUT_MS / 1000} seconds. The server at ${url} did not respond.`,
        );
      }, LOAD_TIMEOUT_MS);
      try {
        if (hasAuth && resolvedCreds) {
          debugLog("WebBrowser", "Starting auth proxy for", { url });
          const urlObj = new URL(url);
          const targetOrigin = urlObj.origin + "/";
          const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
          if (proxySessionIdRef.current && proxyUrlRef.current) {
            const proxyBase = proxyUrlRef.current.replace(/\/+$/, "");
            if (iframeRef.current) {
              iframeRef.current.src = proxyBase + pagePath;
            }
          } else {
            await stopProxy();
            if (gen !== navGenRef.current) return;
            const response = await invoke<ProxyMediatorResponse>(
              "start_basic_auth_proxy",
              {
                config: {
                  target_url: targetOrigin,
                  username: resolvedCreds.username,
                  password: resolvedCreds.password,
                  local_port: 0,
                  verify_ssl:
                    (connection as unknown as Record<string, unknown>)
                      ?.httpVerifySsl ?? true,
                  connection_id: connection?.id ?? "",
                },
              },
            );
            if (gen !== navGenRef.current) {
              invoke("stop_basic_auth_proxy", {
                sessionId: response.session_id,
              }).catch(() => {});
              return;
            }
            proxySessionIdRef.current = response.session_id;
            proxyUrlRef.current = response.proxy_url;
            if (
              settings.webRecording?.autoRecordWebSessions &&
              response.session_id
            ) {
              try {
                await webRecorder.startRecording(
                  response.session_id,
                  settings.webRecording?.recordHeaders ?? true,
                );
              } catch (err) {
                console.error("Auto-record failed:", err);
              }
            }
            if (iframeRef.current) {
              const proxyBase = response.proxy_url.replace(/\/+$/, "");
              iframeRef.current.src = proxyBase + pagePath;
            }
          }
        } else {
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
        }
        setCurrentUrl(url);
        setInputUrl(url);
        setIsSecure(url.startsWith("https"));
        if (addToHistory) {
          setHistory((prev) => [...prev.slice(0, historyIndex + 1), url]);
          setHistoryIndex((prev) => prev + 1);
        }
        debugLog("WebBrowser", "Navigation initiated", { url, hasAuth });
      } catch (error) {
        if (gen !== navGenRef.current) return;
        console.error("Navigation failed:", error);
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("401") || msg.includes("Unauthorized")) {
          setLoadError(
            !resolvedCreds
              ? "Authentication required — No credentials configured for this connection. Edit the connection and add Basic Auth credentials."
              : "Authentication required — The saved credentials were rejected by the server. Verify the username and password in the connection settings.",
          );
        } else {
          setLoadError(`Failed to load page: ${msg}`);
        }
        setIsLoading(false);
      }
    },
    [
      hasAuth,
      resolvedCreds,
      connection,
      stopProxy,
      historyIndex,
      fetchAndVerifyCert,
      settings.webRecording,
      webRecorder,
    ],
  );

  // ── Effects ────────────────────────────────────────────────
  // Initial load
  useEffect(() => {
    navigateToUrl(currentUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup proxy and timeout on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      const id = proxySessionIdRef.current;
      if (id) {
        invoke("stop_basic_auth_proxy", { sessionId: id }).catch(() => {});
      }
    };
  }, []);

  // Proxy keepalive polling
  useEffect(() => {
    if (!hasAuth) return;
    if (!settings.proxyKeepaliveEnabled) return;
    const intervalMs = (settings.proxyKeepaliveIntervalSeconds ?? 10) * 1000;
    const id = setInterval(async () => {
      const sid = proxySessionIdRef.current;
      if (!sid) return;
      try {
        const results = await invoke<
          Array<{ session_id: string; alive: boolean; error?: string }>
        >("check_proxy_health", { sessionIds: [sid] });
        const entry = results.find((r) => r.session_id === sid);
        if (entry && !entry.alive) {
          debugLog("WebBrowser", "Proxy health check failed", { sid, error: entry.error });
          setProxyAlive(false);
          const maxRestarts = settings.proxyMaxAutoRestarts ?? 5;
          const canAutoRestart =
            settings.proxyAutoRestart &&
            (maxRestarts === 0 || autoRestartCountRef.current < maxRestarts);
          if (canAutoRestart) {
            try {
              const resp = await invoke<ProxyMediatorResponse>(
                "restart_proxy_session",
                { sessionId: sid },
              );
              proxySessionIdRef.current = resp.session_id;
              proxyUrlRef.current = resp.proxy_url;
              autoRestartCountRef.current += 1;
              setProxyAlive(true);
              if (iframeRef.current) {
                const urlObj = new URL(currentUrl);
                const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
                iframeRef.current.src =
                  resp.proxy_url.replace(/\/+$/, "") + pagePath;
              }
              debugLog("WebBrowser", "Proxy auto-restarted successfully", {
                newSessionId: resp.session_id,
                restartCount: autoRestartCountRef.current,
              });
            } catch (restartErr) {
              debugLog("WebBrowser", "Auto-restart failed", { restartErr });
            }
          } else {
            debugLog("WebBrowser", "Auto-restart skipped", {
              autoRestart: settings.proxyAutoRestart,
              count: autoRestartCountRef.current,
              max: maxRestarts,
            });
          }
        } else if (entry && entry.alive) {
          setProxyAlive(true);
        }
      } catch {
        // check_proxy_health failed — ignore
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [
    hasAuth,
    currentUrl,
    settings.proxyKeepaliveEnabled,
    settings.proxyKeepaliveIntervalSeconds,
    settings.proxyAutoRestart,
    settings.proxyMaxAutoRestarts,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual proxy restart
  const handleRestartProxy = useCallback(async () => {
    const sid = proxySessionIdRef.current;
    if (!sid) {
      navigateToUrl(currentUrl);
      return;
    }
    setProxyRestarting(true);
    try {
      const resp = await invoke<ProxyMediatorResponse>(
        "restart_proxy_session",
        { sessionId: sid },
      );
      proxySessionIdRef.current = resp.session_id;
      proxyUrlRef.current = resp.proxy_url;
      setProxyAlive(true);
      if (iframeRef.current) {
        const urlObj = new URL(currentUrl);
        const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
        iframeRef.current.src = resp.proxy_url.replace(/\/+$/, "") + pagePath;
      }
    } catch {
      proxySessionIdRef.current = "";
      proxyUrlRef.current = "";
      navigateToUrl(currentUrl);
    } finally {
      setProxyRestarting(false);
    }
  }, [currentUrl, navigateToUrl]);

  // Track in-proxy navigation
  const baseTargetRef = useRef(buildTargetUrl().replace(/\/+$/, ""));
  useEffect(() => {
    baseTargetRef.current = buildTargetUrl().replace(/\/+$/, "");
  }, [buildTargetUrl]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "proxy_navigate" && event.data.url) {
        const proxyOrigin = proxyUrlRef.current;
        if (proxyOrigin && event.data.url.startsWith(proxyOrigin)) {
          const rawPath = event.data.url.slice(proxyOrigin.length);
          const path =
            rawPath && !rawPath.startsWith("/") ? "/" + rawPath : rawPath;
          const realUrl = baseTargetRef.current + (path || "/");
          setCurrentUrl(realUrl);
          setInputUrl(realUrl);
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // ── Navigation handlers ────────────────────────────────────
  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      let url = inputUrl.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `http://${url}`;
      }
      setCurrentUrl(url);
      setIsSecure(url.startsWith("https://"));
      setLoadError("");
      navigateToUrl(url);
    },
    [inputUrl, navigateToUrl],
  );

  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setIsLoading(false);
    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        const body = doc.body?.innerText?.trim() ?? "";
        if (
          body.startsWith("Upstream request failed:") ||
          body.startsWith("Failed to read upstream response:")
        ) {
          setLoadError(body);
          return;
        }
      }
    } catch {
      // Cross-origin
    }
    setLoadError("");
  }, []);

  const handleRefresh = useCallback(() => {
    navigateToUrl(currentUrl, false);
  }, [currentUrl, navigateToUrl]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      navigateToUrl(history[newIndex], false);
    }
  }, [historyIndex, history, navigateToUrl]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      navigateToUrl(history[newIndex], false);
    }
  }, [historyIndex, history, navigateToUrl]);

  const handleOpenInNewTab = useCallback(() => {
    if (!connection) return;
    const newSession: ConnectionSession = {
      id: generateId(),
      connectionId: connection.id,
      name: `${connection.name} (tab)`,
      status: "connected",
      startTime: new Date(),
      protocol: connection.protocol,
      hostname: connection.hostname,
    };
    dispatch({ type: "ADD_SESSION", payload: newSession });
  }, [connection, dispatch]);

  const handleOpenExternal = useCallback(() => {
    invoke("open_url_external", { url: currentUrl }).catch(() => {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    });
  }, [currentUrl]);

  // ── Bookmark helpers ───────────────────────────────────────
  const collectPaths = useCallback((items: HttpBookmarkItem[]): string[] => {
    const out: string[] = [];
    for (const bm of items) {
      if (bm.isFolder) out.push(...collectPaths(bm.children));
      else out.push(bm.path);
    }
    return out;
  }, []);

  const currentPath = useMemo(() => {
    const base = buildTargetUrl().replace(/\/+$/, "");
    const url = inputUrl || currentUrl;
    const raw = url.startsWith(base) ? url.slice(base.length) : "/";
    return raw && raw.startsWith("/") ? raw : "/" + raw;
  }, [inputUrl, currentUrl, buildTargetUrl]);

  const activeBookmarkPaths = useMemo(
    () => new Set(collectPaths(connection?.httpBookmarks || [])),
    [connection?.httpBookmarks, collectPaths],
  );
  const isCurrentPageBookmarked = activeBookmarkPaths.has(currentPath);

  const handleAddBookmark = useCallback(() => {
    if (!connection) return;
    const url = inputUrl || currentUrl;
    const base = buildTargetUrl().replace(/\/+$/, "");
    const rawPath = url.startsWith(base) ? url.slice(base.length) : "/";
    const normalizedPath =
      rawPath && rawPath.startsWith("/") ? rawPath : "/" + rawPath;
    if (activeBookmarkPaths.has(normalizedPath)) return;
    const name =
      normalizedPath === "/"
        ? "Home"
        : decodeURIComponent(
            normalizedPath.split("/").filter(Boolean).pop() || "Page",
          );
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: {
        ...connection,
        httpBookmarks: [
          ...(connection.httpBookmarks || []),
          { name, path: normalizedPath },
        ],
      },
    });
  }, [
    connection,
    inputUrl,
    currentUrl,
    buildTargetUrl,
    activeBookmarkPaths,
    dispatch,
  ]);

  const handleMoveBookmark = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (!connection) return;
      const bookmarks = [...(connection.httpBookmarks || [])];
      if (toIdx < 0 || toIdx >= bookmarks.length) return;
      const [moved] = bookmarks.splice(fromIdx, 1);
      bookmarks.splice(toIdx, 0, moved);
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, httpBookmarks: bookmarks },
      });
    },
    [connection, dispatch],
  );

  const handleRemoveBookmark = useCallback(
    (idx: number) => {
      if (!connection) return;
      const bookmarks = [...(connection.httpBookmarks || [])];
      bookmarks.splice(idx, 1);
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, httpBookmarks: bookmarks },
      });
    },
    [connection, dispatch],
  );

  const handleRenameBookmark = useCallback(
    (idx: number, newName: string) => {
      if (!connection || !newName.trim()) return;
      const bookmarks = [...(connection.httpBookmarks || [])];
      bookmarks[idx] = { ...bookmarks[idx], name: newName.trim() };
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, httpBookmarks: bookmarks },
      });
    },
    [connection, dispatch],
  );

  const handleDeleteAllBookmarks = useCallback(() => {
    if (!connection) return;
    if (settings.confirmDeleteAllBookmarks) {
      setShowDeleteAllConfirm(true);
    } else {
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, httpBookmarks: [] },
      });
    }
  }, [connection, settings.confirmDeleteAllBookmarks, dispatch]);

  const confirmDeleteAllBookmarks = useCallback(() => {
    if (!connection) return;
    dispatch({
      type: "UPDATE_CONNECTION",
      payload: { ...connection, httpBookmarks: [] },
    });
    setShowDeleteAllConfirm(false);
  }, [connection, dispatch]);

  const handleAddFolder = useCallback(() => {
    if (!connection) return;
    setShowNewFolderDialog(true);
  }, [connection]);

  const confirmAddFolder = useCallback(
    (folderName: string) => {
      if (!connection || !folderName) return;
      const folder: HttpBookmarkItem = {
        name: folderName,
        isFolder: true,
        children: [],
      };
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: {
          ...connection,
          httpBookmarks: [...(connection.httpBookmarks || []), folder],
        },
      });
      setShowNewFolderDialog(false);
    },
    [connection, dispatch],
  );

  const handleMoveToFolder = useCallback(
    (bmIdx: number, folderIdx: number) => {
      if (!connection) return;
      const bookmarks = [...(connection.httpBookmarks || [])].map((b) =>
        b.isFolder ? { ...b, children: [...b.children] } : { ...b },
      );
      const [item] = bookmarks.splice(bmIdx, 1);
      if (item.isFolder) return;
      const folder = bookmarks[folderIdx > bmIdx ? folderIdx - 1 : folderIdx];
      if (folder && folder.isFolder) {
        folder.children.push(item);
      }
      dispatch({
        type: "UPDATE_CONNECTION",
        payload: { ...connection, httpBookmarks: bookmarks },
      });
    },
    [connection, dispatch],
  );

  const handleRemoveFromFolder = useCallback(
    (folderIdx: number, childIdx: number) => {
      if (!connection) return;
      const bookmarks = [...(connection.httpBookmarks || [])].map((b) =>
        b.isFolder ? { ...b, children: [...b.children] } : { ...b },
      );
      const folder = bookmarks[folderIdx];
      if (folder && folder.isFolder) {
        folder.children.splice(childIdx, 1);
        dispatch({
          type: "UPDATE_CONNECTION",
          payload: { ...connection, httpBookmarks: bookmarks },
        });
      }
    },
    [connection, dispatch],
  );

  // ── Page actions ───────────────────────────────────────────
  const handleSavePage = useCallback(async () => {
    if (!connection) return;
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("-");
    const defaultName = `${connection.name}-${ts}.pdf`;
    try {
      const filePath = await saveDialog({
        title: "Save page as PDF",
        defaultPath: defaultName,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!filePath) return;
      try {
        await invoke("save_page_as_pdf", {
          sessionId: proxySessionIdRef.current,
          outputPath: filePath,
        });
      } catch {
        iframeRef.current?.contentWindow?.print();
      }
    } catch (e) {
      console.error("Save page failed:", e);
    }
  }, [connection]);

  const handleCopyAll = useCallback(async () => {
    try {
      const iframeDoc =
        iframeRef.current?.contentDocument ||
        iframeRef.current?.contentWindow?.document;
      if (iframeDoc) {
        const text =
          iframeDoc.body?.innerText || iframeDoc.body?.textContent || "";
        if (text.trim()) {
          await navigator.clipboard.writeText(text);
          toast.success("Page content copied to clipboard");
          return;
        }
      }
    } catch {
      // Cross-origin
    }
    try {
      const proxyUrl = proxyUrlRef.current;
      if (proxyUrl) {
        const urlObj = new URL(currentUrl);
        const pagePath = urlObj.pathname + urlObj.search;
        const fetchUrl = proxyUrl.replace(/\/+$/, "") + pagePath;
        const resp = await fetch(fetchUrl);
        if (resp.ok) {
          const html = await resp.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const text = doc.body?.innerText || doc.body?.textContent || "";
          if (text.trim()) {
            await navigator.clipboard.writeText(text);
            toast.success("Page content copied to clipboard");
            return;
          }
        }
      }
    } catch {
      // fetch failed
    }
    toast.error(
      "Could not copy page content — the page may be empty or inaccessible",
    );
  }, [currentUrl, toast]);

  // ── Drag handlers ──────────────────────────────────────────
  const handleDragStart = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      setDragIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
    },
    [],
  );
  const handleDragOver = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx(idx);
    },
    [],
  );
  const handleDrop = useCallback(
    (idx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (dragIdx !== null && dragIdx !== idx) {
        handleMoveBookmark(dragIdx, idx);
      }
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [dragIdx, handleMoveBookmark],
  );
  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  // ── Recording handlers ─────────────────────────────────────
  const handleStartHarRecording = useCallback(async () => {
    const sid = proxySessionIdRef.current;
    if (!sid) return;
    try {
      await webRecorder.startRecording(
        sid,
        settings.webRecording?.recordHeaders ?? true,
      );
    } catch (err) {
      console.error("Failed to start web recording:", err);
    }
  }, [webRecorder, settings.webRecording]);

  const handleStopHarRecording = useCallback(async () => {
    const sid = proxySessionIdRef.current;
    if (!sid) return;
    const recording = await webRecorder.stopRecording(sid);
    if (recording) {
      pendingRecordingRef.current = recording;
      setShowRecordingNamePrompt("har");
    }
  }, [webRecorder]);

  const handleSaveHarRecording = useCallback(
    async (name: string) => {
      const recording = pendingRecordingRef.current as
        | import("../../types/macroTypes").WebRecording
        | null;
      if (!recording) return;
      await macroService.saveWebRecording({
        id: crypto.randomUUID(),
        name,
        recording,
        savedAt: new Date().toISOString(),
        connectionId: connection?.id,
        connectionName: connection?.name,
        host: session.hostname,
      });
      const max = settings.webRecording?.maxStoredWebRecordings ?? 50;
      await macroService.trimWebRecordings(max);
      pendingRecordingRef.current = null;
      setShowRecordingNamePrompt(null);
      toast.success("Web recording saved");
    },
    [connection, session.hostname, settings.webRecording, toast],
  );

  const handleStartVideoRecording = useCallback(async () => {
    const started = await displayRecorder.startRecording("webm");
    if (!started) {
      toast.error("Failed to start video recording");
    }
  }, [displayRecorder, toast]);

  const handleStopVideoRecording = useCallback(async () => {
    const blob = await displayRecorder.stopRecording();
    if (blob) {
      pendingRecordingRef.current = blob;
      setShowRecordingNamePrompt("video");
    }
  }, [displayRecorder]);

  const handleSaveVideoRecording = useCallback(
    async (name: string) => {
      const blob = pendingRecordingRef.current as Blob | null;
      if (!blob) return;
      const saved = await macroService.blobToWebVideoRecording(blob, {
        name,
        connectionId: connection?.id,
        connectionName: connection?.name,
        host: session.hostname,
        durationMs: displayRecorder.state.duration * 1000,
        format: displayRecorder.state.format || "webm",
      });
      await macroService.saveWebVideoRecording(saved);
      pendingRecordingRef.current = null;
      setShowRecordingNamePrompt(null);
      toast.success("Video recording saved");
    },
    [connection, session.hostname, displayRecorder.state, toast],
  );

  // Focus inline rename input
  useEffect(() => {
    if (editingBmIdx !== null) {
      setTimeout(() => editBmRef.current?.focus(), 30);
    }
  }, [editingBmIdx]);

  const handleCancelLoading = useCallback(() => {
    setIsLoading(false);
    setLoadError(
      `Connection timed out. The server at ${currentUrl} did not respond.`,
    );
  }, [currentUrl]);

  return {
    // Context
    session,
    connection,
    settings,
    // Navigation
    currentUrl,
    inputUrl,
    setInputUrl,
    isLoading,
    loadError,
    isSecure,
    canGoBack,
    canGoForward,
    iframeRef,
    handleUrlSubmit,
    handleIframeLoad,
    handleRefresh,
    handleBack,
    handleForward,
    handleOpenInNewTab,
    handleOpenExternal,
    navigateToUrl,
    handleCancelLoading,
    // Auth
    hasAuth,
    resolvedCreds,
    sslVerifyDisabled,
    iconPadding,
    // Proxy
    proxyAlive,
    proxyRestarting,
    handleRestartProxy,
    proxySessionIdRef,
    // Certificate
    showCertPopup,
    setShowCertPopup,
    certIdentity,
    certPopupRef,
    trustPrompt,
    handleTrustAccept,
    handleTrustReject,
    // Bookmarks
    bmContextMenu,
    setBmContextMenu,
    bmBarContextMenu,
    setBmBarContextMenu,
    editingBmIdx,
    setEditingBmIdx,
    editBmName,
    setEditBmName,
    editBmRef,
    dragIdx,
    dragOverIdx,
    openFolders,
    setOpenFolders,
    folderButtonRefs,
    currentPath,
    isCurrentPageBookmarked,
    buildTargetUrl,
    handleAddBookmark,
    handleMoveBookmark,
    handleRemoveBookmark,
    handleRenameBookmark,
    handleDeleteAllBookmarks,
    confirmDeleteAllBookmarks,
    handleAddFolder,
    confirmAddFolder,
    handleMoveToFolder,
    handleRemoveFromFolder,
    closeFolderDropdown,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    // Page actions
    handleSavePage,
    handleCopyAll,
    // TOTP
    totpConfigs,
    handleUpdateTotpConfigs,
    showTotpPanel,
    setShowTotpPanel,
    totpBtnRef,
    // Recording
    webRecorder,
    displayRecorder,
    showRecordingNamePrompt,
    setShowRecordingNamePrompt,
    pendingRecordingRef,
    handleStartHarRecording,
    handleStopHarRecording,
    handleSaveHarRecording,
    handleStartVideoRecording,
    handleStopVideoRecording,
    handleSaveVideoRecording,
    // Dialogs
    showNewFolderDialog,
    setShowNewFolderDialog,
    showDeleteAllConfirm,
    setShowDeleteAllConfirm,
  };
}

export type WebBrowserMgr = ReturnType<typeof useWebBrowser>;
