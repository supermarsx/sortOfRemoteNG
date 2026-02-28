import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionSession } from "../types/connection";
import { TOTPConfig } from "../types/settings";
import { useConnections } from "../contexts/useConnections";
import { useSettings } from "../contexts/SettingsContext";

interface ProxyMediatorResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function useHTTPViewer(session: ConnectionSession) {
  const { state, dispatch } = useConnections();
  const { settings } = useSettings();
  const connection = state.connections.find(
    (c) => c.id === session.connectionId,
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string>("");
  const [proxyUrl, setProxyUrl] = useState<string>("");
  const [proxySessionId, setProxySessionId] = useState<string>("");
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isSecure, setIsSecure] = useState(false);
  const [showTotpPanel, setShowTotpPanel] = useState(false);

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

  const buildTargetUrl = useCallback(() => {
    if (!connection) return "";
    const protocol = session.protocol === "https" ? "https" : "http";
    const port = connection.port || (session.protocol === "https" ? 443 : 80);
    const host = connection.hostname;
    const portSuffix =
      (protocol === "https" && port === 443) ||
      (protocol === "http" && port === 80)
        ? ""
        : `:${port}`;
    return `${protocol}://${host}${portSuffix}`;
  }, [connection, session.protocol]);

  const resolveCredentials = useCallback((): {
    username: string;
    password: string;
  } | null => {
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

  const stopProxy = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      await invoke("stop_basic_auth_proxy", { sessionId });
    } catch {
      // Session may already be gone
    }
  }, []);

  const initProxy = useCallback(async () => {
    if (!connection) {
      setStatus("error");
      setError("Connection not found");
      return;
    }

    setStatus("connecting");
    setError("");

    if (proxySessionId) {
      await stopProxy(proxySessionId);
      setProxySessionId("");
    }

    try {
      const targetUrl = buildTargetUrl();
      setCurrentUrl(targetUrl);
      setIsSecure(targetUrl.startsWith("https"));

      const creds = resolveCredentials();
      if (creds) {
        const proxyConfig = {
          target_url: targetUrl,
          username: creds.username,
          password: creds.password,
          local_port: 0,
          verify_ssl: connection.httpVerifySsl ?? true,
        };
        const response = await invoke<ProxyMediatorResponse>(
          "start_basic_auth_proxy",
          { config: proxyConfig },
        );
        setProxyUrl(response.proxy_url);
        setProxySessionId(response.session_id);
        setHistory([response.proxy_url]);
        setHistoryIndex(0);
        setStatus("connected");
      } else {
        setProxyUrl(targetUrl);
        setHistory([targetUrl]);
        setHistoryIndex(0);
        setStatus("connected");
      }
    } catch (err) {
      console.error("Failed to initialize HTTP proxy:", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connection, buildTargetUrl, resolveCredentials, proxySessionId, stopProxy]);

  useEffect(() => {
    initProxy();
  }, [initProxy]);

  useEffect(() => {
    return () => {
      if (proxySessionId) {
        invoke("stop_basic_auth_proxy", { sessionId: proxySessionId }).catch(
          () => {},
        );
      }
    };
  }, [proxySessionId]);

  const navigateTo = useCallback(
    (url: string) => {
      if (!iframeRef.current) return;
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(url);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      iframeRef.current.src = url;
      setCurrentUrl(url);
    },
    [history, historyIndex],
  );

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

  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  const openExternal = useCallback(() => {
    const targetUrl = buildTargetUrl();
    if (targetUrl) {
      window.open(targetUrl, "_blank");
    }
  }, [buildTargetUrl]);

  const handleIframeLoad = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (iframe?.contentWindow?.location?.href) {
        setCurrentUrl(iframe.contentWindow.location.href);
      }
    } catch {
      // CORS prevents access
    }
  }, []);

  return {
    connection,
    settings,
    session,
    iframeRef,
    totpBtnRef,
    status,
    error,
    proxyUrl,
    proxySessionId,
    currentUrl,
    isFullscreen,
    showSettings,
    setShowSettings,
    history,
    historyIndex,
    isSecure,
    showTotpPanel,
    setShowTotpPanel,
    totpConfigs,
    handleUpdateTotpConfigs,
    buildTargetUrl,
    resolveCredentials,
    initProxy,
    goBack,
    goForward,
    refresh,
    goHome,
    toggleFullscreen,
    openExternal,
    handleIframeLoad,
  };
}
