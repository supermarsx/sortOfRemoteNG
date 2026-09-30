import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getReviewedApplicationApiOrigin,
  getReviewedApplicationMeshOrigin,
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
  validateTacticalRmmMeshTarget,
  TACTICAL_MESH_ORIGIN_CONFLICT_MESSAGE,
} from "../../utils/auth/httpApplicationLogin";
import { ConnectionSession } from "../../types/connection/connection";
import { TOTPConfig } from "../../types/settings/settings";
import { useConnections } from "../../contexts/useConnections";
import { hasConfiguredNetworkPath } from "../../utils/network/networkPathConfig";
import { useSettings } from "../../contexts/SettingsContext";
import { useSessionFullscreen } from "../session/useSessionFullscreen";
import { captureHttpNetworkRoute } from "../integration/httpNetworkRoute";
import { HttpNetworkRouteError } from "../../utils/network/httpProxyRoute";
import { RuntimeNetworkPathError } from "../../utils/network/networkPathError";
import { useRuntimeCredentialVault } from "../security/useRuntimeCredentialVault";
import { validateProtectedProxyUrl } from "./useWebBrowser";
import { getFirstPartyGoogleHostedApplicationUrl } from "../../utils/connection/httpApplicationProfiles";
import { parseCanonicalWebAuthority } from "../../utils/connection/sanitizeHostname";
import {
  googleAccountsEntryFor,
  validateGoogleProxyRoutes,
} from "../../utils/protocol/googleProxySession";

interface ProxyMediatorResponse {
  local_port: number;
  session_id: string;
  proxy_url: string;
  google_routes?: unknown;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function useHTTPViewer(session: ConnectionSession) {
  const networkPathContext = useConnections();
  const networkPathContextRef = useRef(networkPathContext);
  networkPathContextRef.current = networkPathContext;
  const { state, dispatch } = networkPathContext;
  const { settings } = useSettings();
  const connection = state.connections.find(
    (c) => c.id === session.connectionId,
  );
  const httpConnectionRef = useRef(connection);
  httpConnectionRef.current = connection;
  const resolveVaultCredential = useRuntimeCredentialVault(session, connection);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const totpBtnRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string>("");
  const [proxyUrl, setProxyUrl] = useState<string>("");
  const [proxySessionId, setProxySessionId] = useState<string>("");
  const proxySessionIdRef = useRef<string>("");
  const proxyGenerationRef = useRef(0);
  const [currentUrl, setCurrentUrl] = useState<string>("");
  const { isFullscreen, toggleFullscreen } = useSessionFullscreen(session.id);
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
    const googleHostedUrl = getFirstPartyGoogleHostedApplicationUrl(
      connection.httpApplication?.id,
    );
    const canonicalGoogleUrl = googleHostedUrl
      ? new URL(googleHostedUrl)
      : undefined;
    const protocol = session.protocol === "https" ? "https" : "http";
    const defaultPort = session.protocol === "https" ? 443 : 80;
    const rawHost = connection.hostname?.trim() ?? "";
    if (
      canonicalGoogleUrl &&
      (!rawHost || rawHost.toLowerCase() === canonicalGoogleUrl.hostname)
    ) {
      return canonicalGoogleUrl.href;
    }
    try {
      const authority = parseCanonicalWebAuthority(rawHost);
      const configuredPort = connection.port || undefined;
      const port = configuredPort ?? authority.port ?? defaultPort;
      if (
        (authority.sourceScheme && authority.sourceScheme !== protocol) ||
        (authority.port &&
          configuredPort &&
          authority.port !== configuredPort) ||
        !Number.isSafeInteger(port) ||
        port < 1 ||
        port > 65_535
      )
        return "";
      const target = new URL(`${protocol}://${authority.hostname}/`);
      target.port = port === defaultPort ? "" : String(port);
      target.pathname = authority.initialPathname ?? "/";
      target.search = authority.initialSearch ?? "";
      target.hash = authority.initialHash ?? "";
      if (connection.httpApplication?.id === "cloudflare") {
        validateHttpApplicationTarget(connection, target.href);
        if (connection.httpApplication.loginMode === "form")
          return `${target.origin}/login`;
      }
      return authority.initialPathname !== undefined
        ? target.href
        : target.origin;
    } catch {
      return "";
    }
  }, [connection, session.protocol]);

  const resolveCredentials = useCallback(() => {
    try {
      return resolveHttpApplicationLogin(connection).credentials;
    } catch {
      return null;
    }
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
    const generation = ++proxyGenerationRef.current;
    if (!connection) {
      setStatus("error");
      setError("Connection not found");
      return;
    }

    setStatus("connecting");
    setError("");

    if (proxySessionIdRef.current) {
      const oldSession = proxySessionIdRef.current;
      proxySessionIdRef.current = "";
      setProxySessionId("");
      if (iframeRef.current) iframeRef.current.src = "about:blank";
      await stopProxy(oldSession);
      if (generation !== proxyGenerationRef.current) return;
    }

    let startedSession: string | undefined;
    try {
      const targetUrl = buildTargetUrl();
      if (!targetUrl) {
        throw new Error(
          "Connection host or port is not a valid HTTP authority",
        );
      }
      setCurrentUrl(targetUrl);
      setIsSecure(targetUrl.startsWith("https"));

      const networkPath = hasConfiguredNetworkPath(connection)
        ? await (
            await import("../../utils/network/resolveRuntimeNetworkPath")
          ).resolveRuntimeNetworkPath(
            connection,
            networkPathContextRef.current.state.connections,
            "http",
            () => networkPathContextRef.current,
          )
        : null;
      if (generation !== proxyGenerationRef.current) return;
      const httpRoute = captureHttpNetworkRoute(
        networkPath,
        () => httpConnectionRef.current,
      );
      const initialLogin = resolveHttpApplicationLogin(connection);
      const vault =
        connection.credentialSource?.kind === "vault" &&
        connection.httpApplication?.loginMode !== "manual"
          ? await resolveVaultCredential(() => {
              if (generation !== proxyGenerationRef.current)
                throw new Error("Website login attempt changed");
            })
          : null;
      vault?.assertCurrent();
      const login = vault
        ? resolveHttpApplicationLogin(connection, {
            username: vault.facets.username ?? "",
            password: vault.facets.password ?? "",
          })
        : initialLogin;
      if (vault) vault.facets = {};
      const creds = login.credentials;
      const reviewedApplicationProfile =
        getReviewedApplicationProfile(connection);
      const reviewedApplicationApiOrigin =
        getReviewedApplicationApiOrigin(connection);
      const reviewedApplicationMeshOrigin =
        getReviewedApplicationMeshOrigin(connection);
      validateTacticalRmmMeshTarget(connection, targetUrl);
      const proxyConfig = {
        target_url: targetUrl,
        username: creds?.username ?? "",
        password: creds?.password ?? "",
        ...(login.upstreamAuthMode
          ? { upstream_auth_mode: login.upstreamAuthMode }
          : {}),
        local_port: 0,
        verify_ssl: connection.httpVerifySsl ?? true,
        connection_id: connection.id,
        upstream_proxy_url: httpRoute.upstreamProxyUrl,
        ...(reviewedApplicationProfile
          ? { reviewed_application_profile: reviewedApplicationProfile }
          : {}),
        ...(reviewedApplicationApiOrigin
          ? { reviewed_application_api_origin: reviewedApplicationApiOrigin }
          : {}),
        ...(reviewedApplicationMeshOrigin
          ? { reviewed_application_mesh_origin: reviewedApplicationMeshOrigin }
          : {}),
        http_auto_login: login.autoLogin,
        http_auto_login_selectors: login.selectors
          ? {
              username_selector: login.selectors.usernameSelector,
              password_selector: login.selectors.passwordSelector,
              submit_selector: login.selectors.submitSelector,
            }
          : undefined,
      };
      vault?.assertCurrent();
      httpRoute.assertCurrent();
      const response = await invoke<ProxyMediatorResponse>(
        "start_basic_auth_proxy",
        { config: proxyConfig },
      );
      if (generation !== proxyGenerationRef.current) {
        await stopProxy(response.session_id);
        return;
      }
      startedSession = response.session_id;
      httpRoute.assertCurrent();
      vault?.assertCurrent();
      const protectedProxyUrl = validateProtectedProxyUrl(response);
      proxySessionIdRef.current = response.session_id;
      const entry = new URL(targetUrl);
      // Assign components, rather than resolving a path starting with //,
      // so even unusual saved paths cannot replace the protected authority.
      const mappedEntry = new URL(protectedProxyUrl);
      mappedEntry.pathname = entry.pathname;
      mappedEntry.search = entry.search;
      mappedEntry.hash = entry.hash;
      const initialProxyUrl =
        reviewedApplicationProfile === "google-hosted"
          ? (googleAccountsEntryFor(
              validateGoogleProxyRoutes(
                response.google_routes,
                entry.origin,
                protectedProxyUrl,
                true,
              ),
              entry,
            ) ??
            (() => {
              throw new Error(
                "Backend did not provide a safe Google Accounts entry route.",
              );
            })())
          : reviewedApplicationProfile === "cloudflare" && login.autoLogin
            ? new URL("/login", protectedProxyUrl).href
            : mappedEntry.href;
      setProxyUrl(initialProxyUrl);
      setProxySessionId(response.session_id);
      setHistory([initialProxyUrl]);
      setHistoryIndex(0);
      setStatus("connected");
    } catch (err) {
      if (startedSession) await stopProxy(startedSession);
      if (generation !== proxyGenerationRef.current) return;
      proxySessionIdRef.current = "";
      const safeMessage =
        err instanceof Error &&
        (err instanceof RuntimeNetworkPathError ||
          err instanceof HttpNetworkRouteError ||
          err.message ===
            "Connection host or port is not a valid HTTP authority" ||
          err.message === TACTICAL_MESH_ORIGIN_CONFLICT_MESSAGE)
          ? err.message
          : connection.httpApplication !== undefined
            ? "Unable to open this website application. Review its login mode, website credentials, and selectors, then retry."
            : "Failed to initialize HTTP proxy";
      console.error("Failed to initialize HTTP proxy");
      setStatus("error");
      setError(safeMessage);
    }
  }, [connection, buildTargetUrl, stopProxy, resolveVaultCredential]);

  useEffect(() => {
    void initProxy();
    return () => {
      proxyGenerationRef.current += 1;
    };
  }, [initProxy]);

  useLayoutEffect(() => {
    if (
      connection?.httpApplication?.id !== "cloudflare" ||
      !proxySessionId ||
      !proxyUrl
    )
      return;
    const origin = new URL(proxyUrl).origin;
    const generation = proxyGenerationRef.current;
    let latestSequence = 0;
    let disposed = false;
    const onDocument = (event: MessageEvent) => {
      const report = event.data;
      if (
        disposed ||
        generation !== proxyGenerationRef.current ||
        event.source !== iframeRef.current?.contentWindow ||
        event.origin !== origin ||
        report?.type !== "proxy_document_start" ||
        report.version !== 1 ||
        report.sessionId !== proxySessionId ||
        typeof report.documentToken !== "string" ||
        !/^[0-9a-f]{32}$/.test(report.documentToken) ||
        report.navigationToken !== null ||
        !Number.isSafeInteger(report.documentSequence) ||
        report.documentSequence <= latestSequence ||
        typeof report.url !== "string" ||
        report.url.length > 16384
      )
        return;
      try {
        const reported = new URL(report.url);
        if (
          reported.origin !== origin ||
          reported.username ||
          reported.password ||
          reported.searchParams.has("__sorng_navigation_v1")
        )
          return;
      } catch {
        return;
      }
      const documentSequence = report.documentSequence;
      latestSequence = documentSequence;
      // Native verifies that this sequence was actually issued for the proxy.
      // This happens at document-start, before parser-blocking challenge scripts.
      void invoke<boolean>("activate_proxy_network_document", {
        sessionId: proxySessionId,
        documentSequence,
      })
        .then((accepted) => {
          if (accepted !== true) throw new Error("Document not accepted");
        })
        .catch(() => {
          if (
            disposed ||
            generation !== proxyGenerationRef.current ||
            latestSequence !== documentSequence
          )
            return;
          setError(
            "The website document could not be activated. Reload to retry.",
          );
          setStatus("error");
          void stopProxy(proxySessionId);
        });
    };
    window.addEventListener("message", onDocument);
    return () => {
      disposed = true;
      window.removeEventListener("message", onDocument);
    };
  }, [connection?.httpApplication?.id, proxySessionId, proxyUrl, stopProxy]);

  useEffect(() => {
    return () => {
      const sessionId = proxySessionIdRef.current;
      if (sessionId) {
        invoke("stop_basic_auth_proxy", { sessionId }).catch(() => {});
      }
    };
  }, []);

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

  const openExternal = useCallback(() => {
    const targetUrl = buildTargetUrl();
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
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
    authLabel:
      connection?.httpApplication?.loginMode === "form"
        ? "Form login"
        : resolveCredentials()
          ? "Basic Auth"
          : "None",
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
