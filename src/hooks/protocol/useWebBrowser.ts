import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";
import { retryTransientTrustRead } from "../../utils/auth/retryTransientTrustRead";
import { debugLog } from "../../utils/core/debugLogger";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import {
  appendWebNetworkReport,
  parseWebNetworkReport,
  webNetworkRoutingStatus,
  type WebNetworkReport,
  type WebNetworkRoutingStatus,
} from "../../utils/protocol/webNetworkReport";
import {
  parseWebNetworkGuardStatus,
  type WebNetworkGuardStatus,
} from "../../utils/protocol/webNetworkGuard";
import {
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
  assertWebBrowserFrameNavigation,
} from "../../utils/protocol/webBrowserFrame";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ConnectionSession,
  HttpBookmarkItem,
} from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import { useToastContext } from "../../contexts/ToastContext";
import { generateId } from "../../utils/core/id";
import { useWebRecorder } from "../recording/useWebRecorder";
import { useDisplayRecorder } from "../recording/useDisplayRecorder";
import { useWebAutomation } from "./useWebAutomation";
import { useWebAutoMfa } from "./useWebAutoMfa";
import { useRuntimeCredentialVault } from "../security/useRuntimeCredentialVault";
import { useRuntimeVaultTotp } from "../security/useRuntimeVaultTotp";
import {
  getVaultRuntimeUnsupportedMessage,
  runtimeCredentialTargetKey,
  withoutConnectionLocalCredentials,
} from "../../utils/security/runtimeCredentialVault";
import { useHttpRedirectReview } from "./useHttpRedirectReview";
import { useHttpRedirectTrust } from "./useHttpRedirectTrust";
import { useDeferredSynologyLoginStatus } from "./useDeferredSynologyLoginStatus";
import { recordSessionActivity } from "../../utils/monitoring/sessionActivityLog";
import {
  synologyDefaultRedirectOrigins,
  withSynologyRedirectDefaults,
} from "../../utils/protocol/synologyRedirectDefaults";
import * as macroService from "../../utils/recording/macroService";
import {
  verifyIdentity,
  trustIdentity,
  resolveEffectiveTrustPolicy,
  validateCertificateIdentity,
  isTransientTrustStoreError,
  type CertIdentity,
  type TrustVerifyResult,
} from "../../utils/auth/trustStore";
import { parseCanonicalWebAuthority } from "../../utils/connection/sanitizeHostname";
import {
  getRuntimeWebNavigation,
  resolveRuntimeConnection,
  releaseReplacedRuntimeConnection,
} from "../../utils/session/runtimeConnectionRegistry";
import type { ProtocolDiagnosticReport } from "../../types/monitoring/diagnostics";
import { getGlobalHttpProxyUrl } from "../integration/httpProxy";
import {
  resolveHttpApplicationLogin,
  sameHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../utils/auth/httpApplicationLogin";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../utils/connection/httpApplicationProfiles";
import { getHttpApplicationExternalTarget } from "../../utils/auth/httpApplicationExternal";
import {
  normalizeHttpProxyPolicy,
  validateHttpCustomHeaders,
} from "../../utils/connection/httpProxyPolicy";
import { normalizeHttpFormAutomation } from "../../utils/connection/httpFormAutomation";
import type {
  CertificateInspection,
  NativeTlsCertificateInfo,
  WebNavigationTimeline,
  WebTrustCheck,
} from "../../types/security/certificateInspection";
import { validateCertificateInspection } from "../../utils/security/certificateInspection";
import {
  describeCertificateInspectionFailure,
  HttpsRouteChangedError,
} from "../../utils/security/certificateInspectionFailure";
import {
  normalizeHttpsCaTrustMode,
  constrainRedirectHttpsPolicy,
} from "../../utils/security/httpsCaTrust";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

export interface ProxyMediatorResponse {
  deferred_login_status?: unknown;
  local_port: number;
  session_id: string;
  proxy_url: string;
}

export const PROXY_FAILURE_MESSAGE_TYPE = "sorng_proxy_failure" as const;

export type ProxyFailureKind =
  | "timeout"
  | "page_load_timeout"
  | "navigation_cancelled"
  | "connection_refused"
  | "dns_failure"
  | "tls_failure"
  | "connection_failed"
  | "bad_request"
  | "redirect_loop"
  | "cross_origin_redirect"
  | "redirect_review"
  | "insecure_redirect"
  | "upstream_failure"
  | "http_status"
  | "invalid_navigation"
  | "proxy_start_failed"
  | "trust_failure"
  | "certificate_rejected"
  | "host_unreachable"
  | "proxy_route_failure"
  | "tls_handshake_failure"
  | "inspection_unavailable";

export type {
  WebNavigationTimeline,
  WebNavigationTimelineStep,
  WebTrustCheck,
} from "../../types/security/certificateInspection";

export interface ProxyNavigationFailure {
  version: 1;
  sessionId: string;
  kind: ProxyFailureKind;
  status: number | null;
  title: string;
  url: string;
  reason: string;
  detail: string;
  /** Measured attempt timeline for failures before the certificate trust check. */
  timeline?: WebNavigationTimeline;
}

const PROXY_FAILURE_KINDS = new Set<ProxyFailureKind>([
  "timeout",
  "connection_refused",
  "dns_failure",
  "tls_failure",
  "connection_failed",
  "bad_request",
  "redirect_loop",
  "cross_origin_redirect",
  "redirect_review",
  "insecure_redirect",
  "upstream_failure",
  "http_status",
]);

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
    ? value
    : undefined;
}

function requestUrlWithoutFragment(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Validate the untrusted `postMessage` payload from a proxy-owned iframe.
 * Source-window and exact proxy-origin checks live in the message listener;
 * this helper additionally binds the payload to the active proxy session and
 * navigation target before any text reaches React state.
 */
export function parseProxyFailurePayload(
  data: unknown,
  expectedSessionId: string,
  expectedTargetUrl: string,
): ProxyNavigationFailure | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const sessionId = boundedString(value.sessionId, 128);
  const kind = boundedString(value.kind, 64) as ProxyFailureKind | undefined;
  const title = boundedString(value.title, 512);
  const url = boundedString(value.url, 16_384);
  const reason = boundedString(value.reason, 2_048);
  const detail = boundedString(value.detail, 16_384);
  const status = value.status;
  if (
    value.type !== PROXY_FAILURE_MESSAGE_TYPE ||
    value.version !== 1 ||
    !sessionId ||
    sessionId !== expectedSessionId ||
    !kind ||
    !PROXY_FAILURE_KINDS.has(kind) ||
    typeof status !== "number" ||
    !Number.isSafeInteger(status) ||
    (status < 400 && !(kind === "redirect_review" && status === 202)) ||
    status > 599 ||
    !title ||
    !url ||
    !reason ||
    !detail
  ) {
    return null;
  }
  const normalizedUrl = requestUrlWithoutFragment(url);
  const normalizedTarget = requestUrlWithoutFragment(expectedTargetUrl);
  if (!normalizedUrl || normalizedUrl !== normalizedTarget) return null;

  return {
    version: 1,
    sessionId,
    kind,
    status,
    title,
    url,
    reason,
    detail,
  };
}

export type LocalNavigationFailureKind = Extract<
  ProxyFailureKind,
  | "timeout"
  | "page_load_timeout"
  | "navigation_cancelled"
  | "invalid_navigation"
  | "proxy_start_failed"
  | "certificate_rejected"
  | "trust_failure"
  | "tls_failure"
  | "host_unreachable"
  | "proxy_route_failure"
  | "tls_handshake_failure"
  | "inspection_unavailable"
  | "connection_refused"
  | "dns_failure"
  | "connection_failed"
>;

function localNavigationFailure(
  kind: LocalNavigationFailureKind,
  title: string,
  url: string,
  reason: string,
  detail = reason,
): ProxyNavigationFailure {
  return {
    version: 1,
    sessionId: "local",
    kind,
    status: null,
    title,
    url,
    reason,
    detail,
  };
}

const PROTECTED_PROXY_HOST_RE = /^p[0-9a-f]{32}\.localhost$/u;
const NAVIGATION_QUERY_KEY = "__sorng_navigation_v1";

function navigationToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function validateProtectedProxyUrl(
  response: ProxyMediatorResponse,
): string {
  if (
    !Number.isInteger(response.local_port) ||
    response.local_port < 1 ||
    response.local_port > 65535 ||
    !response.session_id
  ) {
    throw new Error("Backend returned an invalid proxy session.");
  }

  let proxyUrl: URL;
  try {
    proxyUrl = new URL(response.proxy_url);
  } catch {
    throw new Error("Backend returned an invalid protected proxy URL.");
  }
  if (
    proxyUrl.protocol !== "http:" ||
    proxyUrl.username ||
    proxyUrl.password ||
    !PROTECTED_PROXY_HOST_RE.test(proxyUrl.hostname) ||
    proxyUrl.port !== String(response.local_port) ||
    proxyUrl.pathname !== "/" ||
    proxyUrl.search ||
    proxyUrl.hash
  ) {
    throw new Error("Backend returned an unsafe protected proxy URL.");
  }
  return proxyUrl.toString();
}

/* ═══════════════════════════════════════════════════════════════
   Hook
   ═══════════════════════════════════════════════════════════════ */

export function useWebBrowser(session: ConnectionSession) {
  const {
    state,
    dispatch,
    dispatchAndFlush,
    recycleBin,
    databaseAvailability,
    credentialVault,
  } = useConnections();
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const { settings, settingsReady } = useSettings();
  const { toast } = useToastContext();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
  const redirectTrust = useHttpRedirectTrust(session, connection);
  const targetResolution = useMemo(() => {
    const protocol = session.protocol === "https" ? "https" : "http";
    const defaultPort = protocol === "https" ? 443 : 80;
    try {
      const authority = parseCanonicalWebAuthority(session.hostname);
      if (authority.sourceScheme && authority.sourceScheme !== protocol) {
        throw new Error(
          `Saved hostname uses ${authority.sourceScheme}, but this session requires ${protocol}.`,
        );
      }
      const configuredPort = connection?.port || undefined;
      if (
        authority.port &&
        configuredPort &&
        authority.port !== configuredPort
      ) {
        throw new Error(
          "Saved hostname port conflicts with the connection port.",
        );
      }
      const port = configuredPort ?? authority.port ?? defaultPort;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Saved connection contains an invalid web port.");
      }

      const target = new URL(`${protocol}://${authority.hostname}/`);
      target.port = port === defaultPort ? "" : String(port);
      const profileSettings = normalizeHttpApplicationSettings(
        connection?.httpApplication,
      );
      const profile =
        profileSettings && !profileSettings.invalid
          ? getHttpApplicationProfile(profileSettings.id)
          : undefined;
      if (profile?.hostedLoginUrl)
        target.pathname = new URL(profile.hostedLoginUrl).pathname;
      else if (profileSettings?.loginPath && !profileSettings.invalid)
        target.pathname = profileSettings.loginPath;
      else if (profile?.loginPath) target.pathname = profile.loginPath;
      // Enter the reviewed SPA route directly. An empty hash would let initial
      // router startup look like a navigation revocation between the two grants.
      if (profile?.loginFlow === "bitwarden") target.hash = "/login";
      const redirected = getRuntimeWebNavigation(session.connectionId);
      if (redirected) {
        const initial = new URL(redirected.initialUrl);
        if (
          initial.origin !== target.origin ||
          initial.username ||
          initial.password ||
          initial.search ||
          initial.hash
        )
          throw new Error(
            "The reviewed redirect target no longer matches this tab.",
          );
        target.pathname = initial.pathname;
      }
      if (
        target.username ||
        target.password ||
        target.hostname !== authority.hostname
      ) {
        throw new Error("Saved web hostname did not resolve canonically.");
      }
      return {
        error: null,
        hostname: authority.hostname,
        // The single port source for navigation, inspection, pinning and trust.
        port,
        url: target.toString(),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Saved web hostname is invalid.",
        hostname: "",
        port: null,
        url: "",
      };
    }
  }, [
    connection?.port,
    connection?.httpApplication,
    session.hostname,
    session.protocol,
    session.connectionId,
  ]);
  const normalizedHostname = targetResolution.hostname;

  // ── Derived auth ────────────────────────────────────────────
  const applicationAuth = useMemo(() => {
    try {
      return { login: resolveHttpApplicationLogin(connection), error: null };
    } catch {
      return {
        login: null,
        error:
          "Review this connection's Application settings: the profile, login mode, website credentials, or selectors are invalid.",
      };
    }
  }, [connection]);
  const resolvedCreds = applicationAuth.login?.credentials ?? null;
  const resolveVaultCredential = useRuntimeCredentialVault(session, connection);
  const vaultTotp = useRuntimeVaultTotp(session, connection);
  const vaultSource = connection?.credentialSource?.kind === "vault";
  const noncredentialConnection = useMemo(
    () =>
      connection && vaultSource
        ? withoutConnectionLocalCredentials(connection)
        : connection,
    [connection, vaultSource],
  );
  const reviewedFlowScope =
    settingsReady === true &&
    databaseAvailability?.status === "ready" &&
    databaseAvailability.databaseId === session.ownerDatabaseId
      ? `${databaseAvailability.databaseId}:${databaseAvailability.generation}`
      : "";
  const reviewedFlowScopeRef = useRef(reviewedFlowScope);
  reviewedFlowScopeRef.current = reviewedFlowScope;
  const reviewedFlowStartedRef = useRef<string | null>(null);
  const synologyRedirectOriginalOrigin = redirectTrust.defaults?.originalOrigin;
  const redirectBudgetRef = useRef(redirectTrust.redirectBudget);
  redirectBudgetRef.current = redirectTrust.redirectBudget;
  const assertFormLoginCurrentRef = useRef(
    redirectTrust.assertFormLoginCurrent,
  );
  assertFormLoginCurrentRef.current = redirectTrust.assertFormLoginCurrent;
  const proxyOptions = useMemo(() => {
    try {
      const policy = withSynologyRedirectDefaults(
        normalizeHttpProxyPolicy(connection?.httpProxyPolicy),
        synologyRedirectOriginalOrigin
          ? { version: 1, originalOrigin: synologyRedirectOriginalOrigin }
          : undefined,
      );
      const mode =
        applicationAuth.login?.upstreamAuthMode ??
        connection?.authType ??
        "none";
      // Application profiles own authentication. Hidden legacy header-auth
      // credentials must not be revived by choosing a manual/SSO profile.
      const headers = validateHttpCustomHeaders(
        connection?.httpApplication === undefined
          ? connection?.httpHeaders
          : undefined,
        mode,
      );
      const form = normalizeHttpFormAutomation(connection?.httpFormAutomation);
      return { policy, headers, form, error: null };
    } catch {
      return {
        policy: null,
        headers: {},
        form: undefined,
        error:
          "Review Advanced login and internal proxy controls: the saved options or custom headers are invalid.",
      };
    }
  }, [
    connection,
    applicationAuth.login?.upstreamAuthMode,
    synologyRedirectOriginalOrigin,
  ]);
  const httpsRedirectNavigation = getRuntimeWebNavigation(session.connectionId);
  const originalHttpsConnectionId =
    httpsRedirectNavigation?.trustedRedirectSource?.savedConnectionId ??
    httpsRedirectNavigation?.synologyRedirectSource?.savedConnectionId;
  const originalHttpsConnection = originalHttpsConnectionId
    ? state.connections.find((item) => item.id === originalHttpsConnectionId)
    : undefined;
  const httpsPolicy = constrainRedirectHttpsPolicy(
    resolveEffectiveTrustPolicy(
      connection?.httpsTrustPolicy,
      settings.httpsTrustPolicy,
      settings.trustPolicy,
      connection?.tlsTrustPolicy ?? settings.tlsTrustPolicy ?? "always-ask",
    ),
    (httpsRedirectNavigation?.redirectHops ?? 0) > 0,
    originalHttpsConnection?.httpsTrustPolicy,
    originalHttpsConnection?.tlsTrustPolicy,
  );
  const httpsCaTrustMode =
    settingsReady === true && httpsPolicy === "tofu"
      ? normalizeHttpsCaTrustMode(settings.httpsCaTrustMode)
      : "review";
  const httpsPolicyKey = stableJsonStringify([
    httpsCaTrustMode,
    httpsPolicy,
    connection?.httpsTrustPolicy,
    connection?.tlsTrustPolicy,
    settings.httpsTrustPolicy,
    settings.trustPolicy,
    settings.tlsTrustPolicy,
    connection?.httpVerifySsl,
    originalHttpsConnectionId,
    originalHttpsConnection?.httpsTrustPolicy,
    originalHttpsConnection?.tlsTrustPolicy,
  ]);
  const httpsPolicyKeyRef = useRef(httpsPolicyKey);
  httpsPolicyKeyRef.current = httpsPolicyKey;
  const proxyInputs = stableJsonStringify([
    session.protocol === "https" ? httpsPolicyKey : null,
    connection?.httpProxyPolicy,
    redirectTrust.defaults,
    redirectTrust.redirectBudget?.profile,
    redirectTrust.formLoginCurrent,
    connection?.httpHeaders,
    connection?.httpFormAutomation,
    connection ? runtimeCredentialTargetKey(connection) : null,
    vaultSource
      ? [credentialVault?.scope, credentialVault?.changeRevision]
      : null,
  ]);
  const previousProxyInputs = useRef(proxyInputs);
  const previousApplicationAuth = useRef({
    auth: applicationAuth,
    profile: connection?.httpApplication,
  });

  const hasAuth =
    resolvedCreds !== null ||
    (vaultSource &&
      !!applicationAuth.login &&
      (applicationAuth.login.upstreamAuthMode !== "none" ||
        applicationAuth.login.autoLogin));
  const selectedApplication = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  );
  const isCloudflareDashboard =
    selectedApplication?.id === "cloudflare" && !selectedApplication.invalid;
  const applicationExternalTarget = getHttpApplicationExternalTarget(
    connection,
    targetResolution.url,
  );
  const applicationExternalTargetRef = useRef(applicationExternalTarget?.url);
  applicationExternalTargetRef.current = applicationExternalTarget?.url;
  const [openingApplicationExternal, setOpeningApplicationExternal] =
    useState(false);
  const openingApplicationExternalRef = useRef(false);

  const buildTargetUrl = useCallback(() => {
    return targetResolution.url;
  }, [targetResolution.url]);

  const markSessionConnected = useCallback(() => {
    if (session.status === "connected") return;
    dispatch({
      type: "UPDATE_SESSION",
      payload: {
        id: session.id,
        status: "connected",
        errorMessage: undefined,
      },
    });
  }, [dispatch, session]);

  // ── State ───────────────────────────────────────────────────
  const [currentUrl, setCurrentUrl] = useState(targetResolution.url);
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [showClearSessionConfirm, setShowClearSessionConfirm] = useState(false);
  const [clearingSession, setClearingSession] = useState(false);
  const clearingSessionRef = useRef(false);
  const [isLoading, setIsLoading] = useState(!targetResolution.error);
  const [waitingForTrust, setWaitingForTrust] = useState(
    session.protocol === "https",
  );
  const [loadingIndicatorReady, setLoadingIndicatorReady] = useState(false);
  const [loadError, setLoadError] = useState<string>(
    targetResolution.error ?? "",
  );
  const [navigationFailure, setNavigationFailure] =
    useState<ProxyNavigationFailure | null>(
      targetResolution.error
        ? localNavigationFailure(
            "invalid_navigation",
            "Invalid web connection",
            targetResolution.url || session.hostname,
            targetResolution.error,
          )
        : null,
    );
  const [diagnosticReport, setDiagnosticReport] =
    useState<ProtocolDiagnosticReport | null>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticsStartedAt, setDiagnosticsStartedAt] = useState<
    number | null
  >(null);
  const diagnosticRunRef = useRef(0);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [isSecure, setIsSecure] = useState(session.protocol === "https");
  const [navigationHistory, setNavigationHistory] = useState<{
    entries: string[];
    index: number;
  }>({ entries: [], index: -1 });
  const historyRef = useRef(navigationHistory);
  const history = navigationHistory.entries;
  const historyIndex = navigationHistory.index;
  const appendHistory = useCallback((url: string) => {
    const previous = historyRef.current;
    if (previous.entries[previous.index] === url) return;
    // Session-only history, capped to bound menu and memory cost. A genuine new
    // navigation replaces the forward branch; reloads and history jumps do not.
    const entries = [
      ...previous.entries.slice(0, previous.index + 1),
      url,
    ].slice(-200);
    const next = { entries, index: entries.length - 1 };
    historyRef.current = next;
    setNavigationHistory(next);
  }, []);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Certificate trust ──────────────────────────────────────
  const [showCertPopup, setShowCertPopup] = useState(false);
  const certificateScope = JSON.stringify([
    session.id,
    connection?.id,
    normalizedHostname,
    targetResolution.port,
  ]);
  const [certificateCapture, setCertificateCapture] = useState<{
    scope: string;
    identity: CertIdentity;
    inspection: CertificateInspection;
  } | null>(null);
  const certIdentity =
    certificateCapture?.scope === certificateScope
      ? certificateCapture.identity
      : null;
  const certificateInspection =
    certificateCapture?.scope === certificateScope
      ? certificateCapture.inspection
      : null;
  const [trustPrompt, setTrustPrompt] = useState<TrustVerifyResult | null>(
    null,
  );
  const trustResolveRef = useRef<((accept: boolean) => void) | null>(null);
  const trustPromptRef = useRef(trustPrompt);
  trustPromptRef.current = trustPrompt;
  const [trustCheck, setTrustCheck] = useState<WebTrustCheck | null>(null);
  const certPopupRef = useRef<HTMLDivElement>(null);

  // ── Proxy tracking ─────────────────────────────────────────
  const proxySessionIdRef = useRef<string>("");
  const proxyUrlRef = useRef<string>("");
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navGenRef = useRef(0);
  /** Start of the current navigation attempt: epoch for display, monotonic for elapsed. */
  const attemptStartRef = useRef<{
    epoch: number;
    mono: number;
    generation: number;
  } | null>(null);
  const trustReadAbortRef = useRef<AbortController | null>(null);
  const cancelTrustRead = useCallback(() => {
    trustReadAbortRef.current?.abort();
    trustReadAbortRef.current = null;
  }, []);
  const trustOwnerScope = JSON.stringify([
    session.ownerDatabaseId,
    databaseAvailability?.status,
    databaseAvailability?.databaseId,
    databaseAvailability?.generation,
  ]);
  const trustOwnerScopeRef = useRef(trustOwnerScope);
  trustOwnerScopeRef.current = trustOwnerScope;
  const loadingIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingNavigationRef = useRef(false);
  const pendingInternalNavigationRef = useRef(false);
  const awaitingFrameGenerationRef = useRef<number | null>(null);
  const currentDocumentRef = useRef<{
    generation: number;
    sessionId: string;
    token: string;
    sequence: number;
    navigationToken: string | null;
    url: string;
    ownerScope: string;
  } | null>(null);
  const deferredLogin = useDeferredSynologyLoginStatus({
    activityContext: session.ownerDatabaseId
      ? {
          sessionId: session.id,
          connectionId: session.connectionId,
          databaseId: session.ownerDatabaseId,
        }
      : undefined,
    scope: JSON.stringify([
      session.id,
      session.connectionId,
      reviewedFlowScope,
    ]),
    requested: !!redirectTrust.defaultSource?.formLogin,
    valid: redirectTrust.formLoginCurrent,
    automaticOtp: noncredentialConnection?.httpAutoMfa?.enabled === true,
    assertCurrent: () => assertFormLoginCurrentRef.current?.(),
    context: () =>
      proxySessionIdRef.current
        ? {
            sessionId: proxySessionIdRef.current,
            generation: navGenRef.current,
            document: currentDocumentRef.current?.token ?? null,
          }
        : null,
  });
  const deferredLoginRef = useRef(deferredLogin);
  const activitySessionRef = useRef(session);
  activitySessionRef.current = session;
  const loggedAutoLoginHints = useRef<{
    document: object;
    reasons: Set<string>;
  } | null>(null);
  deferredLoginRef.current = deferredLogin;
  const [networkReports, setNetworkReports] = useState<{
    scope: string;
    rows: WebNetworkReport[];
  }>({ scope: "", rows: [] });
  const [networkRouting, setNetworkRouting] = useState<{
    scope: string;
    value: WebNetworkRoutingStatus;
  } | null>(null);
  const expectedNetworkRouting = useRef(false);
  expectedNetworkRouting.current =
    !!proxyOptions.policy?.synologyQuickConnectDefaults;
  const expectedAliasRouting = useRef(false);
  expectedAliasRouting.current =
    !!proxyOptions.policy?.synologyQuickConnectDefaults &&
    synologyDefaultRedirectOrigins(
      proxyOptions.policy.synologyQuickConnectDefaults.originalOrigin,
    ).length === 4;
  const networkReportScope = useCallback(
    () =>
      JSON.stringify([
        trustOwnerScopeRef.current,
        currentDocumentRef.current?.token,
        navGenRef.current,
      ]),
    [],
  );
  const [networkGuard, setNetworkGuard] = useState<{
    scope: string;
    status: WebNetworkGuardStatus;
  } | null>(null);
  const requireNetworkGuard = useCallback(async (assertCurrent: () => void) => {
    const scope = trustOwnerScopeRef.current;
    assertCurrent();
    let raw: unknown;
    try {
      raw = await invoke("web_network_guard_status");
    } catch {
      throw new Error(
        "Website navigation protection is unavailable. Update or restart the desktop application before retrying.",
      );
    }
    assertCurrent();
    if (scope !== trustOwnerScopeRef.current)
      throw new Error(
        "The website navigation was cancelled because its database access changed.",
      );
    const status = parseWebNetworkGuardStatus(raw);
    setNetworkGuard({ scope, status });
    if (
      status.frameNavigation === "initializing" ||
      status.frameNavigation === "failed"
    )
      throw new Error(
        status.frameNavigation === "initializing"
          ? "Website navigation protection is still starting. Wait briefly and reload the tab."
          : "Website navigation protection failed. Restart the desktop application before retrying.",
      );
  }, []);
  const pendingFrameRef = useRef<{
    generation: number;
    url: string;
    cleanUrl: string;
    token: string;
    sessionId: string;
  } | null>(null);
  const [shouldMountIframe, setShouldMountIframe] = useState(false);
  const clearFrame = useCallback(() => {
    // Restrict and abort a live document before React removes its browsing
    // context. No inactive iframe is retained behind trust/recovery screens.
    clearWebBrowserFrame(iframeRef.current);
    setShouldMountIframe(false);
  }, []);
  const attachIframe = useCallback((iframe: HTMLIFrameElement | null) => {
    iframeRef.current = iframe;
    const pending = pendingFrameRef.current;
    if (
      iframe &&
      pending &&
      pending.generation === navGenRef.current &&
      pending.sessionId === proxySessionIdRef.current
    ) {
      awaitingFrameGenerationRef.current = pending.generation;
      navigateWebBrowserFrame(iframe, pending.url, proxyUrlRef.current);
    }
  }, []);
  const navigateFrame = useCallback(
    (url: string, generation: number, sessionId: string) => {
      assertWebBrowserFrameNavigation(
        url,
        proxyUrlRef.current,
        window.location.origin,
      );
      const target = new URL(url);
      if (target.searchParams.has(NAVIGATION_QUERY_KEY))
        throw new Error(
          "The navigation uses a reserved internal query parameter.",
        );
      const token = navigationToken();
      const cleanUrl = target.toString();
      target.search = `${target.search}${target.search ? "&" : "?"}${NAVIGATION_QUERY_KEY}=${token}`;
      pendingFrameRef.current = {
        generation,
        url: target.toString(),
        cleanUrl,
        token,
        sessionId,
      };
      setShouldMountIframe(true);
      if (iframeRef.current) attachIframe(iframeRef.current);
    },
    [attachIframe],
  );
  const clearLoadingIndicator = useCallback(() => {
    if (loadingIndicatorTimerRef.current !== null) {
      clearTimeout(loadingIndicatorTimerRef.current);
      loadingIndicatorTimerRef.current = null;
    }
    setLoadingIndicatorReady(false);
  }, []);
  const proxyRecoveryBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const beginLoadingPresentation = useCallback(
    (generation: number) => {
      clearLoadingIndicator();
      setIsLoading(true);
      loadingIndicatorTimerRef.current = setTimeout(() => {
        if (
          !mountedRef.current ||
          generation !== navGenRef.current ||
          !pendingNavigationRef.current
        )
          return;
        loadingIndicatorTimerRef.current = null;
        setLoadingIndicatorReady(true);
      }, 200);
    },
    [clearLoadingIndicator],
  );
  const activeNavigationUrlRef = useRef(currentUrl);
  const previousCertificateScope = useRef(certificateScope);
  useEffect(() => {
    if (previousCertificateScope.current === certificateScope) return;
    previousCertificateScope.current = certificateScope;
    navGenRef.current += 1;
    cancelTrustRead();
    clearLoadingIndicator();
    awaitingFrameGenerationRef.current = null;
    setCertificateCapture(null);
    setShowCertPopup(false);
    setTrustPrompt(null);
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
  }, [certificateScope, clearLoadingIndicator, cancelTrustRead]);
  const navigationFailureRef = useRef<ProxyNavigationFailure | null>(
    navigationFailure,
  );

  const clearNavigationFailure = useCallback(() => {
    navigationFailureRef.current = null;
    setNavigationFailure(null);
    setLoadError("");
    diagnosticRunRef.current += 1;
    setDiagnosticReport(null);
    setDiagnosticError(null);
    setIsRunningDiagnostics(false);
    setDiagnosticsStartedAt(null);
  }, []);

  const applyNavigationFailure = useCallback(
    (failure: ProxyNavigationFailure) => {
      cancelTrustRead();
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      navigationFailureRef.current = failure;
      setNavigationFailure(failure);
      setLoadError(failure.detail || failure.reason);
      setIsLoading(false);
      pendingNavigationRef.current = false;
      pendingInternalNavigationRef.current = false;
      awaitingFrameGenerationRef.current = null;
      clearLoadingIndicator();
      setTrustCheck(null);
      diagnosticRunRef.current += 1;
      setDiagnosticReport(null);
      setDiagnosticError(null);
      setIsRunningDiagnostics(false);
      setDiagnosticsStartedAt(null);
    },
    [clearLoadingIndicator, cancelTrustRead],
  );
  const previousTrustOwnerScope = useRef(trustOwnerScope);
  useEffect(() => {
    if (previousTrustOwnerScope.current === trustOwnerScope) return;
    previousTrustOwnerScope.current = trustOwnerScope;
    // A suspended/replaced owner cannot finish a pending read or its backoff.
    if (!trustReadAbortRef.current) return;
    navGenRef.current += 1;
    cancelTrustRead();
    applyNavigationFailure(
      localNavigationFailure(
        "navigation_cancelled",
        "HTTPS trust verification stopped",
        activeNavigationUrlRef.current,
        "Database access changed. Open and unlock the owning database, then reload to verify HTTPS trust.",
      ),
    );
  }, [trustOwnerScope, applyNavigationFailure, cancelTrustRead]);
  /**
   * Set once `fetchAndVerifyCert` has resolved trust for this tab.
   * The proxy receives this SHA-256 leaf certificate fingerprint and pins
   * outbound TLS to that exact certificate instead of disabling TLS
   * verification for the whole session.
   */
  const acceptedCertFingerprintRef = useRef<string | null>(null);
  const requireCaVerificationRef = useRef(false);
  const LOAD_TIMEOUT_MS = 30_000;
  // Once the server has answered, slow applications (for example DSM) may
  // stream and boot their document for much longer before DOM-ready. Each
  // document of a load gets this window, within the load's absolute cap
  // (kept below the native Synology readiness lifetimes).
  const DOCUMENT_READY_TIMEOUT_MS = 120_000;
  const NAVIGATION_READY_CAP_MS = 300_000;
  const loadStartedAtRef = useRef(0);
  const armNavigationDeadline = useCallback(
    (
      generation: number,
      url: string,
      windowMs = LOAD_TIMEOUT_MS,
      continuesLoad = false,
    ) => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      const now = Date.now();
      if (!continuesLoad) loadStartedAtRef.current = now;
      const startedAt = loadStartedAtRef.current;
      const timeoutMs = Math.max(
        0,
        Math.min(windowMs, startedAt + NAVIGATION_READY_CAP_MS - now),
      );
      loadTimeoutRef.current = setTimeout(() => {
        if (generation !== navGenRef.current || !pendingNavigationRef.current)
          return;
        navGenRef.current += 1;
        trustResolveRef.current?.(false);
        trustResolveRef.current = null;
        setTrustPrompt(null);
        applyNavigationFailure(
          localNavigationFailure(
            "page_load_timeout",
            "Page did not become ready",
            url,
            "The browser did not report a ready document before the navigation deadline.",
            `Page readiness was not confirmed within ${Math.round((Date.now() - startedAt) / 1000)} seconds. Proxy startup, page scripts or resources, and browser loading can cause this; it does not prove the server failed to respond.`,
          ),
        );
      }, timeoutMs);
    },
    [applyNavigationFailure],
  );

  const sslVerifyDisabled =
    connection &&
    connection.protocol === "https" &&
    (connection as unknown as Record<string, unknown>)?.httpVerifySsl === false;
  const iconCount =
    2 +
    (hasAuth || deferredLogin.presentation ? 1 : 0) +
    (sslVerifyDisabled ? 1 : 0);
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

  const totpConfigs = vaultSource ? [] : (connection?.totpConfigs ?? []);

  const closeFolderDropdown = useCallback((idx: number) => {
    setOpenFolders((prev) => {
      if (!prev.has(idx)) return prev;
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }, []);

  // ── HTTPS cert trust ───────────────────────────────────────
  const fetchAndVerifyCert = useCallback(
    async (proxyUrl?: string): Promise<boolean> => {
      if (session.protocol !== "https") return true;
      const port = targetResolution.port;
      if (port === null) {
        applyNavigationFailure(
          localNavigationFailure(
            "invalid_navigation",
            "Invalid web connection",
            activeNavigationUrlRef.current || session.hostname,
            targetResolution.error ?? "Saved web hostname is invalid.",
          ),
        );
        return false;
      }
      const policy = httpsPolicy;
      const policyKey = httpsPolicyKey;
      requireCaVerificationRef.current = false;
      // Capture the navigation generation BEFORE the async gap so we can
      // detect whether a newer navigation has superseded us after the
      // await completes (e.g. React StrictMode double-mount race).
      const genBefore = navGenRef.current;
      const attempt =
        attemptStartRef.current?.generation === genBefore
          ? attemptStartRef.current
          : { epoch: Date.now(), mono: performance.now() };
      const ownerScope = trustOwnerScopeRef.current;
      cancelTrustRead();
      const abort = new AbortController();
      trustReadAbortRef.current = abort;
      let assertOwner: (() => void) | undefined;
      const assertCurrent = (attempt: number) => {
        if (
          abort.signal.aborted ||
          !mountedRef.current ||
          genBefore !== navGenRef.current ||
          ownerScope !== trustOwnerScopeRef.current ||
          policyKey !== httpsPolicyKeyRef.current
        )
          throw new DOMException("Trust verification cancelled", "AbortError");
        if (getGlobalHttpProxyUrl({ failClosed: true }) !== proxyUrl)
          throw new HttpsRouteChangedError();
        // Bind known owners before the first read, not after a transition may
        // already have replaced their lease. Older ownerless tabs may perform
        // the initial verification, but cannot schedule an unowned retry.
        if (session.ownerDatabaseId || attempt > 0)
          assertOwner ??= captureSessionDatabaseAccess(session);
        assertOwner?.();
      };
      let stage:
        "inspection" | "inspection_response" | "identity" | "verification" =
        "inspection";
      const check: WebTrustCheck = {
        startedAt: Date.now(),
        host: normalizedHostname,
        port,
        route: proxyUrl ? "proxy" : "direct",
      };
      setTrustCheck(check);

      try {
        const info = await invoke<NativeTlsCertificateInfo>(
          "get_tls_certificate_info",
          {
            host: normalizedHostname,
            port,
            proxyUrl,
          },
        );

        // If a newer navigation started while we were awaiting the cert,
        // this call is stale — bail out so we don't overwrite the ref
        // that the newer call will (or already did) set.
        if (genBefore !== navGenRef.current) return false;
        stage = "inspection_response";
        validateCertificateInspection(info);

        const now = new Date().toISOString();
        stage = "identity";
        const identity = validateCertificateIdentity({
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
          san: info.san?.length ? info.san : undefined,
          subjectCn: info.subject_cn ?? undefined,
          subjectOrg: info.subject_org ?? undefined,
          subjectOu: info.subject_ou ?? undefined,
          subjectCountry: info.subject_country ?? undefined,
          subjectState: info.subject_state ?? undefined,
          subjectLocality: info.subject_locality ?? undefined,
          subjectEmail: info.subject_email ?? undefined,
          issuerCn: info.issuer_cn ?? undefined,
          issuerOrg: info.issuer_org ?? undefined,
          issuerCountry: info.issuer_country ?? undefined,
          keyAlgorithm: info.key_algorithm ?? undefined,
          keySize: info.key_size ?? undefined,
          version: info.version ?? undefined,
          chain: info.chain?.map((c) => ({
            subject: c.subject,
            issuer: c.issuer,
            fingerprint: c.fingerprint,
            validFrom: c.valid_from,
            validTo: c.valid_to,
          })),
        });
        stage = "verification";
        assertCurrent(0);
        setCertificateCapture({
          scope: certificateScope,
          identity,
          inspection: {
            host: normalizedHostname,
            port,
            generation: genBefore,
            certificate: info,
          },
        });
        if (policy === "always-trust") {
          acceptedCertFingerprintRef.current = identity.fingerprint;
          return true;
        }
        const connId = connection?.id;
        stage = "verification";
        const result = await retryTransientTrustRead(
          () =>
            verifyIdentity(
              normalizedHostname,
              port,
              "https",
              identity,
              connId,
              {
                caTrustMode: httpsCaTrustMode,
                policy,
                proxyUrl,
                ...(info.ca_validation?.status === "verified" &&
                info.ca_validation.proof_id
                  ? { caProofId: info.ca_validation.proof_id }
                  : {}),
              },
            ),
          abort.signal,
          assertCurrent,
        );
        if (genBefore !== navGenRef.current) return false;
        assertCurrent(0);
        if (result.status === "trusted") {
          // The cert was previously accepted (this session or a prior one).
          // Pin the proxy to the same fingerprint.
          acceptedCertFingerprintRef.current = identity.fingerprint;
          requireCaVerificationRef.current = result.caValidated === true;
          return true;
        }
        if (
          result.status === "mismatch" ||
          result.status === "expired" ||
          result.status === "first-use" ||
          policy === "always-ask" ||
          policy === "strict"
        ) {
          // If a previous trust dialog is still pending (e.g. React StrictMode
          // double-mount or rapid re-navigation), reject the old promise so
          // the stale navigateToUrl() call doesn't hang forever.
          if (trustResolveRef.current) {
            trustResolveRef.current(false);
            trustResolveRef.current = null;
          }
          return new Promise<boolean>((resolve) => {
            // Human review is not a network timeout. Acceptance resumes a fresh
            // bounded navigation deadline; a late timeout must not dismiss trust.
            if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = null;
            trustResolveRef.current = resolve;
            setTrustPrompt(result);
          });
        }
        return false;
      } catch (err) {
        if (abort.signal.aborted || genBefore !== navGenRef.current)
          return false;
        debugLog("WebBrowser", "HTTPS trust pipeline failed", { stage, err });
        acceptedCertFingerprintRef.current = null;
        if (err instanceof HttpsRouteChangedError) {
          applyNavigationFailure(
            localNavigationFailure(
              "navigation_cancelled",
              "HTTPS route changed",
              activeNavigationUrlRef.current,
              "The configured proxy route changed while the certificate was being checked. Reload to check it on the current route.",
              err.message,
            ),
          );
          return false;
        }
        if (stage !== "verification") {
          // Classify by the failing network layer; every class stays blocked.
          applyNavigationFailure(
            describeCertificateInspectionFailure({
              error: err,
              hookStage: stage,
              host: normalizedHostname,
              port,
              route: proxyUrl ? "proxy" : "direct",
              proxyTls: /^https:/i.test(proxyUrl ?? ""),
              url: activeNavigationUrlRef.current,
              startedAt: attempt.epoch,
              failedAfterMs: performance.now() - attempt.mono,
            }),
          );
          return false;
        }
        applyNavigationFailure(
          localNavigationFailure(
            "trust_failure",
            "Unable to verify HTTPS trust",
            activeNavigationUrlRef.current,
            isTransientTrustStoreError(err)
              ? "The Trust Center is still busy after two retries. Wait for its storage transition or refresh to finish, then reload. TLS verification was not bypassed."
              : "The certificate was inspected, but the database Trust Center could not complete its decision. Open or unlock the correct database and inspect its Trust Center; TLS verification was not bypassed.",
            err instanceof Error ? err.message : String(err),
          ),
        );
        return false;
      } finally {
        if (trustReadAbortRef.current === abort)
          trustReadAbortRef.current = null;
        setTrustCheck((current) => (current === check ? null : current));
      }
    },
    [
      session,
      normalizedHostname,
      targetResolution.port,
      targetResolution.error,
      connection,
      httpsPolicy,
      httpsPolicyKey,
      httpsCaTrustMode,
      applyNavigationFailure,
      certificateScope,
      cancelTrustRead,
    ],
  );

  const trustPromptGeneration = navGenRef.current;
  const handleTrustAccept = useCallback(
    async (remember = true) => {
      const generation = trustPromptGeneration;
      const current = () =>
        mountedRef.current &&
        !!trustPrompt &&
        trustPromptRef.current === trustPrompt &&
        !!trustResolveRef.current &&
        generation === navGenRef.current &&
        httpsPolicyKey === httpsPolicyKeyRef.current;
      if (!current()) return;
      armNavigationDeadline(generation, activeNavigationUrlRef.current);
      const port = targetResolution.port;
      if (trustPrompt && certIdentity && remember) {
        try {
          if (port === null) throw new Error("Saved web port is invalid.");
          await trustIdentity(
            normalizedHostname,
            port,
            "https",
            certIdentity,
            true,
            connection?.id,
          );
          if (!current()) return;
        } catch (err) {
          if (!current()) return;
          debugLog("WebBrowser", "Failed to persist HTTPS trust decision", {
            err,
          });
          acceptedCertFingerprintRef.current = null;
          applyNavigationFailure(
            localNavigationFailure(
              "trust_failure",
              "Unable to save the HTTPS trust decision",
              activeNavigationUrlRef.current,
              "The certificate was inspected, but the Trust Center could not persist your decision. The connection remains blocked.",
              err instanceof Error ? err.message : String(err),
            ),
          );
          setTrustPrompt(null);
          trustResolveRef.current?.(false);
          trustResolveRef.current = null;
          return;
        }
      }
      // Retain the user's accepted fingerprint so the next `navigateToUrl`
      // can pass a cert pin to the proxy. The proxy must not disable TLS
      // validation for arbitrary certificates after this trust decision.
      if (!current()) return;
      requireCaVerificationRef.current = false;
      acceptedCertFingerprintRef.current = certIdentity?.fingerprint ?? null;
      setTrustPrompt(null);
      trustResolveRef.current?.(true);
      trustResolveRef.current = null;
    },
    [
      trustPrompt,
      certIdentity,
      normalizedHostname,
      targetResolution.port,
      connection,
      applyNavigationFailure,
      armNavigationDeadline,
      trustPromptGeneration,
      httpsPolicyKey,
    ],
  );

  const handleTrustReject = useCallback(() => {
    const errorMessage = "Connection aborted: certificate not trusted by user.";
    setTrustPrompt(null);
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    applyNavigationFailure(
      localNavigationFailure(
        "certificate_rejected",
        "Certificate was not trusted",
        currentUrl,
        "The connection was stopped because the certificate was rejected.",
        errorMessage,
      ),
    );
  }, [applyNavigationFailure, currentUrl]);

  /**
   * P7: snapshot the live `:root --color-*` CSS variables so the
   * proxy backend can interpolate them into themed pages. Reads
   * directly off the document root (where `themeManager.ts` writes
   * the variables on every theme change) so the served pages match
   * the user's currently-selected theme + color-scheme combination
   * — not the dark-theme defaults the proxy used to hardcode.
   *
   * Field names are camelCase to match the Rust `ThemeTokens` serde
   * shape (`#[serde(rename_all = "camelCase")]`). Values are read as
   * literal CSS strings (`#3b82f6`, `59, 130, 246`) and forwarded
   * verbatim; the page CSS is the only consumer and CSS itself
   * validates them at render time.
   */
  const readThemeTokens = useCallback((): Record<string, string> => {
    if (typeof window === "undefined" || !window.document) return {};
    const style = window.getComputedStyle(document.documentElement);
    const v = (name: string) => style.getPropertyValue(name).trim();
    return {
      background: v("--color-background"),
      surface: v("--color-surface"),
      text: v("--color-text"),
      textSecondary: v("--color-textSecondary"),
      textMuted: v("--color-textMuted"),
      border: v("--color-border"),
      primary: v("--color-primary"),
      primaryRgb: v("--color-primary-rgb"),
      error: v("--color-error"),
      errorRgb: v("--color-error-rgb"),
      warning: v("--color-warning"),
      warningRgb: v("--color-warning-rgb"),
      success: v("--color-success"),
      successRgb: v("--color-success-rgb"),
      info: v("--color-info"),
      infoRgb: v("--color-info-rgb"),
    };
  }, []);

  // ── Proxy lifecycle ────────────────────────────────────────
  const stopProxy = useCallback(async (sessionId?: string) => {
    const id = sessionId ?? proxySessionIdRef.current;
    if (!id) return;
    if (id === proxySessionIdRef.current) {
      proxySessionIdRef.current = "";
      proxyUrlRef.current = "";
    }
    try {
      await invoke("stop_basic_auth_proxy", { sessionId: id });
    } catch {
      // Session may already be gone
    }
  }, []);
  const cancelPendingContinuation = useCallback(() => {
    const navigation = getRuntimeWebNavigation(session.connectionId);
    const continuation = navigation?.nativeContinuation;
    if (!continuation) return;
    delete navigation!.nativeContinuation;
    continuation.cancel();
  }, [session.connectionId]);

  const redirectReview = useHttpRedirectReview({
    trust: redirectTrust,
    connection: noncredentialConnection,
    session,
    sourceOrigin: targetResolution.url
      ? new URL(targetResolution.url).origin
      : "",
    accessKey: reviewedFlowScope,
    route: getGlobalHttpProxyUrl(),
    enabled:
      proxyOptions.policy?.allowCrossOriginRedirects === true ||
      !!proxyOptions.policy?.synologyQuickConnectDefaults,
    effectivePolicy: proxyOptions.policy ?? undefined,
    redirectBudget: redirectTrust.redirectBudget,
    generation: () => navGenRef.current,
    proxySessionId: () => proxySessionIdRef.current,
    navigationToken: () => pendingFrameRef.current?.token ?? null,
    stopSource: async (id, continuationId) => {
      // Unlike generic best-effort cleanup, a handoff requires confirmed stop.
      await invoke("stop_basic_auth_proxy", {
        sessionId: id,
        ...(continuationId ? { continuationId } : {}),
      });
      if (proxySessionIdRef.current === id) {
        proxySessionIdRef.current = "";
        proxyUrlRef.current = "";
        pendingFrameRef.current = null;
        currentDocumentRef.current = null;
        clearFrame();
        setProxyAlive(false);
      }
    },
    continueInTab: (target) => {
      // The redirect hook consumed the native receipt and stopped the original
      // proxy. A new connection ID remounts WebBrowser with fresh trust, cookies,
      // history and automation state while preserving this tab's position/owner.
      const currentSessions = sessionsRef.current ?? [];
      const currentSession = currentSessions.find(
        (item) => item.id === session.id,
      );
      if (
        !currentSession ||
        currentSession.connectionId !== session.connectionId
      )
        throw new Error(
          "The redirect source session changed before its replacement was applied.",
        );
      dispatch({
        type: "UPDATE_SESSION",
        payload: {
          // Local tab changes are patches, not native lifecycle snapshots.
          // Replaying the current actor generation/revision makes the reducer
          // correctly reject this update after the first redirect.
          id: session.id,
          connectionId: target.id,
          name: target.name,
          hostname: target.hostname,
          protocol: target.protocol,
          status: "connecting",
          errorMessage: undefined,
          integration: undefined,
        },
      });
      if (target.id !== session.connectionId)
        releaseReplacedRuntimeConnection(
          session.connectionId,
          session.id,
          currentSessions,
        );
    },
  });
  const redirectReviewRef = useRef(redirectReview);
  redirectReviewRef.current = redirectReview;

  useEffect(() => {
    // React may hydrate owner/settings readiness after the error bridge arrives.
    // Recheck that retained native failure after the review hook's cancellation
    // effects have settled; never poll or automatically accept a destination.
    if (
      navigationFailure?.kind === "redirect_review" &&
      navigationFailure.sessionId === proxySessionIdRef.current
    )
      void redirectReviewRef.current.offer();
  }, [navigationFailure, reviewedFlowScope, connection]);

  useEffect(() => {
    if (
      reviewedFlowStartedRef.current === null ||
      reviewedFlowStartedRef.current === reviewedFlowScope
    )
      return;
    reviewedFlowStartedRef.current = null;
    cancelPendingContinuation();
    navGenRef.current += 1;
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setTrustPrompt(null);
    clearFrame();
    void stopProxy();
    applyNavigationFailure(
      localNavigationFailure(
        "navigation_cancelled",
        "Website login stopped",
        activeNavigationUrlRef.current,
        "The owning database was locked, changed or closed. Reopen it and explicitly reload to start a new login attempt.",
      ),
    );
  }, [
    reviewedFlowScope,
    stopProxy,
    applyNavigationFailure,
    clearFrame,
    cancelPendingContinuation,
  ]);

  // ── Navigation ─────────────────────────────────────────────
  const navigateToUrl = useCallback(
    async (url: string, addToHistory = true) => {
      const gen = ++navGenRef.current;
      attemptStartRef.current = {
        epoch: Date.now(),
        mono: performance.now(),
        generation: gen,
      };
      cancelTrustRead();
      setTrustCheck(null);
      pendingNavigationRef.current = true;
      pendingInternalNavigationRef.current = false;
      awaitingFrameGenerationRef.current = null;
      pendingFrameRef.current = null;
      setWaitingForTrust(session.protocol === "https");
      // Presentation only: inspection and navigation start immediately.
      // Fast pages never show a progress line over the retained frame.
      beginLoadingPresentation(gen);
      setCertificateCapture(null);
      setShowCertPopup(false);
      setTrustPrompt(null);
      trustResolveRef.current?.(false);
      trustResolveRef.current = null;
      clearNavigationFailure();
      activeNavigationUrlRef.current = url;
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      if (applicationAuth.error || proxyOptions.error) {
        applyNavigationFailure(
          localNavigationFailure(
            "invalid_navigation",
            "Application login needs review",
            url || session.hostname,
            "No connection was started with these application settings.",
            applicationAuth.error ?? proxyOptions.error!,
          ),
        );
        return;
      }
      let urlObj: URL;
      try {
        if (!targetResolution.url) {
          throw new Error(
            targetResolution.error ?? "Saved web hostname is invalid.",
          );
        }
        urlObj = new URL(url);
        const configuredTarget = new URL(targetResolution.url);
        if (
          (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") ||
          urlObj.username ||
          urlObj.password ||
          urlObj.searchParams.has(NAVIGATION_QUERY_KEY) ||
          urlObj.origin !== configuredTarget.origin ||
          urlObj.hostname !== targetResolution.hostname
        ) {
          throw new Error(
            "Navigation must stay on the saved connection's canonical web authority.",
          );
        }
        validateHttpApplicationTarget(connection, urlObj.toString());
        if (proxyOptions.policy?.httpsOnly && urlObj.protocol !== "https:") {
          throw new Error(
            "This connection requires HTTPS. Change its configured protocol and port; HTTP will not be upgraded silently.",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid web navigation.";
        applyNavigationFailure(
          localNavigationFailure(
            "invalid_navigation",
            "Invalid web address",
            url || session.hostname,
            "The requested address is not valid for this saved connection.",
            message,
          ),
        );
        return;
      }
      activeNavigationUrlRef.current = urlObj.toString();
      armNavigationDeadline(gen, url);
      let attemptPassword = "";
      let attemptUsername = "";
      try {
        await requireNetworkGuard(() => {
          if (gen !== navGenRef.current)
            throw new Error("The website navigation was cancelled.");
        });
        // Retain this attempt's lease: a later render changing to manual must
        // not replace its post-await guard with a no-op.
        const assertFormLease = assertFormLoginCurrentRef.current;
        let assertReviewedFlow = () => assertFormLease?.();
        const unsupportedVault =
          connection && getVaultRuntimeUnsupportedMessage(connection);
        if (unsupportedVault) throw new Error(unsupportedVault);
        if (
          ["bitwarden", "synology"].includes(
            applicationAuth.login?.loginFlow ?? "",
          ) ||
          redirectTrust.defaultSource?.formLogin
        ) {
          const scope = reviewedFlowScopeRef.current;
          if (!scope)
            throw new Error(
              "Open and unlock this session's owning database before starting reviewed website login.",
            );
          const assertLease = captureSessionDatabaseAccess(session);
          reviewedFlowStartedRef.current = scope;
          assertReviewedFlow = () => {
            assertFormLease?.();
            assertLease();
            if (
              reviewedFlowScopeRef.current !== scope ||
              gen !== navGenRef.current
            )
              throw new Error(
                "Reviewed website login was cancelled because its database access or navigation changed.",
              );
          };
          assertReviewedFlow();
        }
        const upstreamProxyUrl = getGlobalHttpProxyUrl({ failClosed: true });
        if (urlObj.protocol === "https:") {
          const trusted = await fetchAndVerifyCert(upstreamProxyUrl);
          if (!trusted || gen !== navGenRef.current) return;
          assertReviewedFlow();
          armNavigationDeadline(gen, url);
        }
        const existingProxy = proxySessionIdRef.current;
        const vault = await resolveVaultCredential(() => {
          if (
            gen !== navGenRef.current ||
            proxySessionIdRef.current !== existingProxy
          )
            throw new Error("The website credential attempt was cancelled.");
        }, !!existingProxy);
        const assertPriorFlow = assertReviewedFlow;
        assertReviewedFlow = () => {
          assertPriorFlow();
          vault?.assertCurrent();
        };
        assertReviewedFlow();
        let attemptLogin =
          vault && !existingProxy
            ? resolveHttpApplicationLogin(connection, {
                username: vault.facets.username ?? "",
                password: vault.facets.password ?? "",
              })
            : applicationAuth.login;
        attemptPassword = attemptLogin?.credentials?.password ?? "";
        attemptUsername = vault
          ? (attemptLogin?.credentials?.username ?? "")
          : "";
        if (vault) {
          vault.facets = {};
          reviewedFlowStartedRef.current = reviewedFlowScopeRef.current;
        }
        setWaitingForTrust(false);
        // ── Universal proxy mediation (P1) ──
        // Every http/https tab now routes through `start_basic_auth_proxy`
        // regardless of whether Basic Auth is configured. Reasons:
        //   • Refused / DNS / TLS / 5xx failures get themed error pages
        //     served by the proxy backend (P2), not browser-native
        //     "This page can't be displayed" chrome.
        //   • Upstream 401 challenges are intercepted by the proxy and
        //     surfaced via a themed inline form (P3), suppressing the
        //     browser-native Basic Auth popup that iframes otherwise
        //     show by default.
        //   • Every session — including failed ones — registers in
        //     InternalProxyManager (`http_cmds.rs:190` inserts before
        //     the first upstream call), so the manager actually shows
        //     what's open. Pre-P1 no-auth tabs bypassed the proxy
        //     entirely and were invisible.
        // The backend `username`/`password` fields accept empty strings;
        // `http.rs:652` only injects the Basic-Auth header when at least
        // one of them is non-empty, so no-auth connections still work
        // exactly as before — just through a one-hop loopback mediator.
        debugLog("WebBrowser", "Routing through proxy", { url, hasAuth });
        const targetOrigin = urlObj.origin + "/";
        const pagePath = urlObj.pathname + urlObj.search + urlObj.hash;
        if (proxySessionIdRef.current && proxyUrlRef.current) {
          const proxyBase = proxyUrlRef.current.replace(/\/+$/, "");
          navigateFrame(proxyBase + pagePath, gen, proxySessionIdRef.current);
        } else {
          await stopProxy();
          if (gen !== navGenRef.current) return;
          assertReviewedFlow();
          const redirectBudget = redirectBudgetRef.current;
          redirectBudget?.assertCurrent();
          const runtimeNavigation = getRuntimeWebNavigation(
            session.connectionId,
          );
          // The registry's assertCurrent is a source-mount launch guard. At
          // destination startup the live destination/DB scope above and the
          // original owner/security lease in redirectBudget are authoritative.
          runtimeNavigation?.synologyRedirectSource?.assertOwner();
          const continuation = runtimeNavigation?.nativeContinuation;
          const response = await invoke<ProxyMediatorResponse>(
            "start_basic_auth_proxy",
            {
              config: {
                target_url: continuation
                  ? runtimeNavigation!.initialUrl
                  : targetOrigin,
                ...(continuation ? { continuation_id: continuation.id } : {}),
                // Empty strings when no auth — the backend treats
                // (empty, empty) as "no credentials" and skips the
                // basic_auth() call on every upstream request.
                username: attemptLogin?.credentials?.username ?? "",
                password: attemptLogin?.credentials?.password ?? "",
                ...(applicationAuth.login?.upstreamAuthMode
                  ? {
                      upstream_auth_mode:
                        applicationAuth.login.upstreamAuthMode,
                    }
                  : {}),
                local_port: 0,
                proxy_policy: proxyOptions.policy,
                redirect_profile: redirectBudget?.profile ?? null,
                custom_headers: proxyOptions.headers,
                http_form_automation: proxyOptions.form,
                // CA/hostname verification and explicit trust are separate.
                // Always retain the accepted HTTPS fingerprint: disabling CA
                // verification must not erase the user's certificate pin.
                verify_ssl:
                  ((connection as unknown as Record<string, unknown>)
                    ?.httpVerifySsl ?? true) !== false,
                accepted_cert_fingerprint:
                  urlObj.protocol === "https:"
                    ? acceptedCertFingerprintRef.current
                    : null,
                ...(urlObj.protocol === "https:" &&
                requireCaVerificationRef.current
                  ? { require_ca_verification: true }
                  : {}),
                connection_id: connection?.id ?? "",
                // If the app has a global HTTP(S) proxy, the loopback
                // mediator owns that outbound hop. The iframe still talks only
                // to its protected p<token>.localhost authority.
                upstream_proxy_url: upstreamProxyUrl,
                // t20: arm proxy-side web auto-login for this session
                // when the connection opted in. Default off. The
                // credential itself is NOT sent separately — the
                // backend reuses the `username`/`password` fields above
                // (already populated from `resolvedCreds`). We only
                // forward the enable flag and any CSS-selector
                // overrides, mapping the camelCase Connection fields to
                // the snake_case `BasicAuthProxyConfig` keys the proxy
                // expects (mirrors basicAuthUsername→username,
                // httpVerifySsl→verify_ssl above). See t20-e2 contract.
                http_auto_login:
                  proxyOptions.policy?.pageScripts !== "block" &&
                  (applicationAuth.login?.autoLogin ?? false),
                http_auto_login_selectors: applicationAuth.login?.selectors
                  ? {
                      username_selector:
                        applicationAuth.login.selectors.usernameSelector,
                      password_selector:
                        applicationAuth.login.selectors.passwordSelector,
                      submit_selector:
                        applicationAuth.login.selectors.submitSelector,
                    }
                  : undefined,
                // P7: ship the live theme snapshot so themed pages
                // served by the proxy (errors, status, auth challenge)
                // match the user's selected theme. If they change
                // themes mid-session they can refresh the tab to
                // pick up the new palette.
                theme_tokens: readThemeTokens(),
              },
            },
          ).catch((error: unknown) => {
            continuation?.cancel();
            throw error;
          });
          if (
            continuation &&
            runtimeNavigation?.nativeContinuation === continuation
          ) {
            delete runtimeNavigation.nativeContinuation;
          }
          attemptLogin = null;
          if (gen !== navGenRef.current) {
            invoke("stop_basic_auth_proxy", {
              sessionId: response.session_id,
            }).catch(() => {});
            return;
          }
          let protectedProxyUrl: string;
          try {
            assertReviewedFlow();
            protectedProxyUrl = validateProtectedProxyUrl(response);
          } catch (error) {
            await stopProxy(response.session_id);
            throw error;
          }
          proxySessionIdRef.current = response.session_id;
          proxyUrlRef.current = protectedProxyUrl;
          deferredLoginRef.current.receive(response);
          navigateFrame(
            protectedProxyUrl.replace(/\/+$/, "") + pagePath,
            gen,
            response.session_id,
          );
          if (
            settings.webRecording?.autoRecordWebSessions &&
            response.session_id
          ) {
            // Recording is optional: its IPC cannot hold the page behind the
            // navigation deadline or delay form injection/presentation.
            void webRecorder
              .startRecording(
                response.session_id,
                settings.webRecording?.recordHeaders ?? false,
              )
              .catch(() => {
                console.error("Auto-record failed");
              });
          }
          if (gen !== navGenRef.current) return;
        }
        setCurrentUrl(url);
        setInputUrl(url);
        setIsSecure(url.startsWith("https"));
        if (addToHistory) {
          appendHistory(url);
        }
        markSessionConnected();
        debugLog("WebBrowser", "Navigation initiated", { url, hasAuth });
      } catch (error) {
        if (gen !== navGenRef.current) return;
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const msg = [attemptPassword, attemptUsername]
          .filter(Boolean)
          .reduce(
            (message, secret) => message.split(secret).join("[redacted]"),
            rawMessage,
          );
        console.error("Navigation failed:", msg);
        const errorMessage =
          msg.includes("401") || msg.includes("Unauthorized")
            ? applicationAuth.login?.upstreamAuthMode === "none"
              ? "The website requires authentication. Review its Application login mode or sign in manually; form credentials are not sent as HTTP Basic."
              : vaultSource
                ? "The website rejected the vault login or requires additional authentication. Review the selected vault entry and Application login mode."
                : !resolvedCreds
                  ? "Authentication required — No credentials configured for this connection. Edit the connection and add Basic Auth credentials."
                  : "Authentication required — The saved credentials were rejected by the server. Verify the username and password in the connection settings."
            : `Failed to load page: ${msg}`;
        applyNavigationFailure(
          localNavigationFailure(
            "proxy_start_failed",
            "Unable to start the web connection",
            url,
            "The internal proxy could not prepare this navigation.",
            errorMessage,
          ),
        );
      } finally {
        attemptPassword = "";
        attemptUsername = "";
      }
    },
    [
      hasAuth,
      resolvedCreds,
      applicationAuth,
      proxyOptions,
      connection,
      targetResolution,
      stopProxy,
      readThemeTokens,
      appendHistory,
      fetchAndVerifyCert,
      settings.webRecording,
      webRecorder,
      markSessionConnected,
      session,
      clearNavigationFailure,
      applyNavigationFailure,
      beginLoadingPresentation,
      armNavigationDeadline,
      navigateFrame,
      cancelTrustRead,
      resolveVaultCredential,
      vaultSource,
      requireNetworkGuard,
      redirectTrust.defaultSource?.formLogin,
    ],
  );

  // ── Effects ────────────────────────────────────────────────
  // Profile edits revoke the prior one-shot credential dispenser. Do not send
  // newly edited credentials until an explicit navigation/reload. Unrelated
  // connection metadata updates must not interrupt a working page.
  useEffect(() => {
    const previous = previousApplicationAuth.current;
    const previousInputs = previousProxyInputs.current;
    previousProxyInputs.current = proxyInputs;
    previousApplicationAuth.current = {
      auth: applicationAuth,
      profile: connection?.httpApplication,
    };
    if (
      previousInputs === proxyInputs &&
      previous.profile?.id === connection?.httpApplication?.id &&
      previous.profile?.loginPath === connection?.httpApplication?.loginPath &&
      previous.profile?.joomlaVersion ===
        connection?.httpApplication?.joomlaVersion &&
      previous.auth.error === applicationAuth.error &&
      sameHttpApplicationLogin(previous.auth.login, applicationAuth.login)
    )
      return;
    cancelPendingContinuation();
    navGenRef.current += 1;
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setTrustPrompt(null);
    clearFrame();
    void stopProxy();
    applyNavigationFailure(
      localNavigationFailure(
        "invalid_navigation",
        "Application login settings changed",
        activeNavigationUrlRef.current,
        "The previous website session was stopped. Reload to use the reviewed settings.",
        applicationAuth.error ??
          "Reload to start a new protected website session.",
      ),
    );
  }, [
    applicationAuth,
    proxyInputs,
    connection?.httpApplication,
    stopProxy,
    applyNavigationFailure,
    clearFrame,
    cancelPendingContinuation,
  ]);

  // Initial load
  useEffect(() => {
    navigateToUrl(currentUrl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps, react/exhaustive-deps -- mount-only: initial navigation

  // Cleanup proxy and timeout on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      navGenRef.current += 1;
      cancelTrustRead();
      trustResolveRef.current?.(false);
      trustResolveRef.current = null;
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (loadingIndicatorTimerRef.current !== null)
        clearTimeout(loadingIndicatorTimerRef.current);
      pendingNavigationRef.current = false;
      awaitingFrameGenerationRef.current = null;
      pendingFrameRef.current = null;
      const id = proxySessionIdRef.current;
      proxySessionIdRef.current = "";
      proxyUrlRef.current = "";
      if (id) {
        invoke("stop_basic_auth_proxy", { sessionId: id }).catch(() => {});
      }
    };
  }, [cancelTrustRead]);

  // P3/P4: listen for `proxy-credentials-applied`. The Rust-side
  // themed-auth POST handler emits this after the user submits the
  // inline login form and the credentials land in the live session.
  // Filtered to this tab's session_id so multiple open tabs don't
  // cross-talk.
  //
  // The toast is informational (session-only credentials) plus a
  // pointer to the connection editor for persistence. A richer
  // in-tab "Save these credentials?" banner with one-click persist
  // is the natural follow-up — it requires either a Toast component
  // capable of action buttons or a small in-tab banner above the
  // iframe, neither of which exist today. Documented as a TODO so
  // the next iteration can land it without re-investigation.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen<{
      session_id: string;
      connection_id: string;
      username: string;
    }>("proxy-credentials-applied", (event) => {
      const payload = event.payload;
      if (!payload || payload.session_id !== proxySessionIdRef.current) return;
      const who = payload.username || "(empty user)";
      toast.success(
        `Signed in as ${who}. Save the credentials in the connection editor to avoid re-prompting next time.`,
        6000,
      );
      // TODO(P4b): replace toast with an in-tab banner offering a
      // one-click "Save to this connection" action. Wire to a new
      // `get_session_credentials(sessionId)` IPC command that
      // returns { username, password } from the backend session,
      // then write to the connection record via
      // `useConnections().dispatch({ type: "UPDATE_CONNECTION", ... })`.
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        debugLog("WebBrowser", "Failed to subscribe to proxy auth event", {
          err,
        });
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [toast]);

  // Both manual and automatic recovery share one in-flight operation. A late
  // result belongs only to the same navigation generation and proxy session.
  const restartOwnedProxy = useCallback(
    async (sid: string, gen: number) => {
      await requireNetworkGuard(() => {
        if (gen !== navGenRef.current || proxySessionIdRef.current !== sid)
          throw new Error("The website restart was cancelled.");
      });
      const vault = await resolveVaultCredential(() => {
        if (gen !== navGenRef.current || proxySessionIdRef.current !== sid)
          throw new Error("The website restart was cancelled.");
      }, true);
      vault?.assertCurrent();
      const resp = await invoke<ProxyMediatorResponse>(
        "restart_proxy_session",
        { sessionId: sid },
      );
      let protectedProxyUrl: string;
      try {
        vault?.assertCurrent();
        protectedProxyUrl = validateProtectedProxyUrl(resp);
      } catch (error) {
        await stopProxy(resp.session_id);
        throw error;
      }
      if (gen !== navGenRef.current || proxySessionIdRef.current !== sid) {
        await stopProxy(resp.session_id);
        return false;
      }
      proxySessionIdRef.current = resp.session_id;
      proxyUrlRef.current = protectedProxyUrl;
      deferredLoginRef.current.receive(resp);
      setProxyAlive(true);
      clearNavigationFailure();
      const urlObj = new URL(activeNavigationUrlRef.current);
      pendingNavigationRef.current = true;
      pendingInternalNavigationRef.current = false;
      beginLoadingPresentation(gen);
      armNavigationDeadline(gen, urlObj.toString());
      navigateFrame(
        protectedProxyUrl.replace(/\/+$/, "") +
          urlObj.pathname +
          urlObj.search +
          urlObj.hash,
        gen,
        resp.session_id,
      );
      return true;
    },
    [
      clearNavigationFailure,
      stopProxy,
      armNavigationDeadline,
      navigateFrame,
      beginLoadingPresentation,
      resolveVaultCredential,
      requireNetworkGuard,
    ],
  );

  useEffect(() => {
    if (!settings.proxyKeepaliveEnabled) return;
    const intervalMs = (settings.proxyKeepaliveIntervalSeconds ?? 10) * 1000;
    const id = setInterval(async () => {
      const sid = proxySessionIdRef.current;
      if (!sid || proxyRecoveryBusyRef.current) return;
      const gen = navGenRef.current;
      proxyRecoveryBusyRef.current = true;
      try {
        const results = await invoke<
          Array<{ session_id: string; alive: boolean; error?: string }>
        >("check_proxy_health", { sessionIds: [sid] });
        if (gen !== navGenRef.current || proxySessionIdRef.current !== sid)
          return;
        const entry = results.find((r) => r.session_id === sid);
        if (entry?.alive) {
          setProxyAlive(true);
          return;
        }
        if (!entry) return;
        setProxyAlive(false);
        const maxRestarts = settings.proxyMaxAutoRestarts ?? 5;
        if (
          settings.proxyAutoRestart &&
          (maxRestarts === 0 || autoRestartCountRef.current < maxRestarts)
        ) {
          // Failed attempts consume the limit too: permanent failure must not
          // trigger an unbounded restart/error loop.
          autoRestartCountRef.current += 1;
          await restartOwnedProxy(sid, gen);
        }
      } catch (error) {
        if (gen === navGenRef.current && proxySessionIdRef.current === sid) {
          debugLog("WebBrowser", "Proxy health/recovery failed", { error });
        }
      } finally {
        proxyRecoveryBusyRef.current = false;
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [
    settings.proxyKeepaliveEnabled,
    settings.proxyKeepaliveIntervalSeconds,
    settings.proxyAutoRestart,
    settings.proxyMaxAutoRestarts,
    restartOwnedProxy,
  ]);

  const handleRestartProxy = useCallback(async () => {
    if (proxyRecoveryBusyRef.current) return;
    const sid = proxySessionIdRef.current;
    if (!sid) {
      await navigateToUrl(currentUrl);
      return;
    }
    const gen = navGenRef.current;
    proxyRecoveryBusyRef.current = true;
    setProxyRestarting(true);
    try {
      await restartOwnedProxy(sid, gen);
    } catch {
      if (gen === navGenRef.current && proxySessionIdRef.current === sid) {
        await stopProxy(sid);
        if (gen === navGenRef.current) await navigateToUrl(currentUrl, false);
      }
    } finally {
      proxyRecoveryBusyRef.current = false;
      if (mountedRef.current) setProxyRestarting(false);
    }
  }, [currentUrl, navigateToUrl, restartOwnedProxy, stopProxy]);

  // Track in-proxy navigation
  const baseTargetRef = useRef(buildTargetUrl().replace(/\/+$/, ""));
  useEffect(() => {
    baseTargetRef.current = buildTargetUrl().replace(/\/+$/, "");
  }, [buildTargetUrl]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      const proxyUrl = proxyUrlRef.current;
      if (!iframeWindow || event.source !== iframeWindow || !proxyUrl) return;

      let expectedOrigin: string;
      try {
        expectedOrigin = new URL(proxyUrl).origin;
      } catch {
        return;
      }
      if (event.origin !== expectedOrigin) return;
      if (event.data?.type === "proxy_synology_login_progress") {
        const current = currentDocumentRef.current;
        const report = event.data;
        if (
          current &&
          current.generation === navGenRef.current &&
          current.sessionId === proxySessionIdRef.current &&
          current.ownerScope === trustOwnerScopeRef.current &&
          !navigationFailureRef.current &&
          report.version === 1 &&
          report.sessionId === current.sessionId &&
          report.documentToken === current.token &&
          report.documentSequence === current.sequence &&
          report.navigationToken === current.navigationToken
        )
          deferredLoginRef.current.receivePageProgress(report);
        return;
      }
      if (event.data?.type === "proxy_autologin_result") {
        const current = currentDocumentRef.current;
        // This legacy, unscoped result is only a bounded refresh hint, never
        // status or sign-in proof. Read the exact current native session again;
        // never display a phase or success claim supplied by the page.
        if (
          current &&
          current.generation === navGenRef.current &&
          current.sessionId === proxySessionIdRef.current &&
          current.ownerScope === trustOwnerScopeRef.current &&
          !navigationFailureRef.current &&
          [
            "submitted",
            "cancelled",
            "reviewed-login-timeout",
            "reviewed-login-stopped",
            "autologin-client-unavailable",
          ].includes(event.data?.result?.reason)
        ) {
          if (loggedAutoLoginHints.current?.document !== current)
            loggedAutoLoginHints.current = {
              document: current,
              reasons: new Set(),
            };
          const reason: string = event.data.result.reason;
          if (!loggedAutoLoginHints.current.reasons.has(reason)) {
            loggedAutoLoginHints.current.reasons.add(reason);
            recordSessionActivity(
              activitySessionRef.current.ownerDatabaseId
                ? {
                    sessionId: activitySessionRef.current.id,
                    connectionId: activitySessionRef.current.connectionId,
                    databaseId: activitySessionRef.current.ownerDatabaseId,
                  }
                : undefined,
              "autofill",
              "helper_reported",
            );
          }
          deferredLoginRef.current.refreshFromPage();
        }
        return;
      }
      if (event.data?.type === "sorng_web_network_blocked") {
        const current = currentDocumentRef.current;
        if (
          !current ||
          current.generation !== navGenRef.current ||
          current.sessionId !== proxySessionIdRef.current ||
          current.ownerScope !== trustOwnerScopeRef.current ||
          navigationFailureRef.current
        )
          return;
        const report = parseWebNetworkReport(event.data, current);
        if (!report) return;
        const scope = networkReportScope();
        setNetworkReports((previous) => ({
          scope,
          rows: appendWebNetworkReport(
            previous.scope === scope ? previous.rows : [],
            report,
          ),
        }));
        return;
      }
      const targetUrlFor = (reported: URL) => {
        // Assign components rather than resolving a path: a leading // is a
        // legitimate path here, never permission to change the saved authority.
        const target = new URL(baseTargetRef.current);
        target.pathname = reported.pathname;
        target.search = reported.search;
        target.hash = reported.hash;
        return target.toString();
      };

      if (
        [
          "proxy_document_start",
          "proxy_navigation_start",
          "proxy_dom_ready",
        ].includes(event.data?.type)
      ) {
        const report = event.data;
        const failed = navigationFailureRef.current;
        if (
          (failed &&
            (report.type !== "proxy_dom_ready" ||
              failed.kind !== "page_load_timeout")) ||
          report.version !== 1 ||
          report.sessionId !== proxySessionIdRef.current ||
          typeof report.documentToken !== "string" ||
          !/^[0-9a-f]{32}$/.test(report.documentToken) ||
          !Number.isSafeInteger(report.documentSequence) ||
          report.documentSequence <= 0 ||
          (report.navigationToken !== null &&
            (typeof report.navigationToken !== "string" ||
              !/^[0-9a-f]{32}$/.test(report.navigationToken))) ||
          typeof report.url !== "string" ||
          report.url.length > 16_384
        )
          return;
        let reported: URL;
        try {
          reported = new URL(report.url);
          if (
            reported.origin !== expectedOrigin ||
            reported.username ||
            reported.password ||
            reported.searchParams.has(NAVIGATION_QUERY_KEY)
          )
            return;
        } catch {
          return;
        }
        const url = reported.toString();
        const current = currentDocumentRef.current;
        const sameDocument =
          current !== null &&
          current.sessionId === report.sessionId &&
          current.token === report.documentToken &&
          current.sequence === report.documentSequence &&
          current.navigationToken === report.navigationToken &&
          current.url === url;
        const startInternalNavigation = () => {
          // A document unloading before its app navigation became ready
          // continues that load: a new no-document window, the same cap.
          const continuesLoad = pendingNavigationRef.current;
          const generation = ++navGenRef.current;
          pendingFrameRef.current = null;
          pendingInternalNavigationRef.current = true;
          pendingNavigationRef.current = true;
          awaitingFrameGenerationRef.current = generation;
          beginLoadingPresentation(generation);
          armNavigationDeadline(
            generation,
            activeNavigationUrlRef.current,
            LOAD_TIMEOUT_MS,
            continuesLoad,
          );
        };
        if (report.type === "proxy_navigation_start") {
          // A prior document may unload while the app is already checking a new
          // certificate or navigating. It cannot supersede that generation.
          if (
            !sameDocument ||
            current?.generation !== navGenRef.current ||
            (pendingNavigationRef.current &&
              pendingInternalNavigationRef.current)
          )
            return;
          startInternalNavigation();
          return;
        }
        if (report.type === "proxy_document_start") {
          if (sameDocument) return;
          if (
            current !== null &&
            current.sessionId === report.sessionId &&
            report.documentSequence <= current.sequence
          )
            return;
          const pending = pendingFrameRef.current;
          if (report.navigationToken !== null) {
            if (
              !pending ||
              pending.generation !== navGenRef.current ||
              pending.sessionId !== report.sessionId ||
              report.navigationToken !== pending.token ||
              url !== pending.cleanUrl
            )
              return;
          } else {
            // Markerless documents are normal links/forms/redirects, never a
            // replacement for an app-issued nonce or a pending trust decision.
            if (
              pendingNavigationRef.current &&
              !pendingInternalNavigationRef.current
            ) {
              // A validated current app document may immediately redirect
              // before DOM-ready. The newer document continues that load;
              // an older frame or a trust-pending navigation cannot authorize it.
              if (
                current === null ||
                current.generation !== navGenRef.current ||
                current.sessionId !== report.sessionId
              )
                return;
              pendingInternalNavigationRef.current = true;
              pendingFrameRef.current = null;
            }
            if (!pendingNavigationRef.current) startInternalNavigation();
          }
          currentDocumentRef.current = {
            generation: navGenRef.current,
            sessionId: report.sessionId,
            token: report.documentToken,
            sequence: report.documentSequence,
            navigationToken: report.navigationToken,
            url,
            ownerScope: trustOwnerScopeRef.current,
          };
          const activatedDocument = currentDocumentRef.current;
          void deferredLoginRef.current.refresh();
          const activationScope = networkReportScope();
          setNetworkRouting({
            scope: activationScope,
            value: webNetworkRoutingStatus(
              report.networkRouting,
              expectedNetworkRouting.current,
              expectedAliasRouting.current,
            ),
          });
          void invoke<boolean>("activate_proxy_network_document", {
            sessionId: activatedDocument.sessionId,
            documentSequence: activatedDocument.sequence,
          })
            .then((selected) => {
              if (typeof selected !== "boolean")
                throw new Error("Invalid document activation result");
            })
            .catch(() => {
              if (
                !mountedRef.current ||
                currentDocumentRef.current !== activatedDocument ||
                activatedDocument.generation !== navGenRef.current ||
                activatedDocument.ownerScope !== trustOwnerScopeRef.current
              )
                return;
              setNetworkReports((previous) => ({
                scope: activationScope,
                rows: appendWebNetworkReport(
                  previous.scope === activationScope ? previous.rows : [],
                  {
                    kind: "document",
                    reason: "document-activation-failed",
                    origin: null,
                  },
                ),
              }));
            });
          const realUrl = targetUrlFor(reported);
          activeNavigationUrlRef.current = realUrl;
          setCurrentUrl(realUrl);
          setInputUrl(realUrl);
          setIsSecure(realUrl.startsWith("https:"));
          if (report.navigationToken === null) appendHistory(realUrl);
          // The server answered: this document (a redirect hop or the final
          // page) gets its own readiness window within the load's cap.
          armNavigationDeadline(
            navGenRef.current,
            realUrl,
            DOCUMENT_READY_TIMEOUT_MS,
            true,
          );
          return;
        }
        if (failed) {
          // Only the local deadline is recoverable, and only by the document
          // it timed out. Its failure advanced the generation exactly once;
          // any later navigation, owner or certificate change advances it again.
          if (
            failed.sessionId !== "local" ||
            !sameDocument ||
            !current ||
            current.generation + 1 !== navGenRef.current ||
            current.ownerScope !== trustOwnerScopeRef.current
          )
            return;
          currentDocumentRef.current = {
            ...current,
            generation: navGenRef.current,
          };
          clearNavigationFailure();
        } else if (
          !sameDocument ||
          current?.generation !== navGenRef.current ||
          !pendingNavigationRef.current ||
          awaitingFrameGenerationRef.current !== navGenRef.current
        )
          return;
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
        pendingNavigationRef.current = false;
        pendingInternalNavigationRef.current = false;
        awaitingFrameGenerationRef.current = null;
        setIsLoading(false);
        clearLoadingIndicator();
        // DOM readiness is not successful authentication or full resource load.
        void deferredLoginRef.current.refresh();
        return;
      }
      const failure = parseProxyFailurePayload(
        event.data,
        proxySessionIdRef.current,
        activeNavigationUrlRef.current,
      );
      if (failure) {
        applyNavigationFailure(failure);
        return;
      }

      if (event.data?.type !== "proxy_navigate") return;
      if (pendingNavigationRef.current || navigationFailureRef.current) return;
      const reportedUrl = boundedString(event.data.url, 16_384);
      if (!reportedUrl) return;
      try {
        const reportedProxyUrl = new URL(reportedUrl);
        if (
          reportedProxyUrl.origin !== expectedOrigin ||
          reportedProxyUrl.searchParams.has(NAVIGATION_QUERY_KEY)
        )
          return;
        const realUrl = targetUrlFor(reportedProxyUrl);
        activeNavigationUrlRef.current = realUrl;
        setCurrentUrl(realUrl);
        setInputUrl(realUrl);
        setIsSecure(realUrl.startsWith("https:"));
        appendHistory(realUrl);
      } catch {
        // Ignore malformed or cross-origin navigation reports.
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    applyNavigationFailure,
    clearNavigationFailure,
    clearLoadingIndicator,
    beginLoadingPresentation,
    armNavigationDeadline,
    appendHistory,
    networkReportScope,
  ]);

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
      navigateToUrl(url);
    },
    [inputUrl, navigateToUrl],
  );

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (
      !proxyUrlRef.current ||
      !iframe ||
      iframe.getAttribute("src") === "about:blank"
    ) {
      return;
    }
    // A previous document may finish while a new HTTPS certificate is still
    // being checked. It must not complete or dismiss that newer navigation.
    if (
      pendingNavigationRef.current &&
      awaitingFrameGenerationRef.current !== navGenRef.current
    )
      return;
    // A themed native redirect page may have no accepted readiness/failure
    // message (for example an internal link changed the path). Only a current
    // native receipt can authorize this review; no URL or destination is read
    // from the page, and an ordinary load with no receipt stays unchanged.
    void redirectReviewRef.current.offer(false, true);
    void deferredLoginRef.current.refresh();
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setIsLoading(false);
    pendingNavigationRef.current = false;
    pendingInternalNavigationRef.current = false;
    awaitingFrameGenerationRef.current = null;
    clearLoadingIndicator();
    if (navigationFailureRef.current) return;
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const body = doc.body?.innerText?.trim() ?? "";
        if (
          body.startsWith("Upstream request failed:") ||
          body.startsWith("Failed to read upstream response:")
        ) {
          applyNavigationFailure(
            localNavigationFailure(
              "proxy_start_failed",
              "Unable to load webpage",
              activeNavigationUrlRef.current || currentUrl,
              "The internal proxy could not complete the upstream request.",
              body,
            ),
          );
          return;
        }
      }
    } catch {
      // Cross-origin
    }
    setLoadError("");
  }, [applyNavigationFailure, clearLoadingIndicator, currentUrl]);

  const handleRefresh = useCallback(() => {
    if (!proxyAlive) void handleRestartProxy();
    else void navigateToUrl(currentUrl, false);
  }, [currentUrl, navigateToUrl, proxyAlive, handleRestartProxy]);

  const handleClearSessionData = useCallback(async () => {
    if (clearingSessionRef.current) return;
    clearingSessionRef.current = true;
    setClearingSession(true);
    setShowClearSessionConfirm(false);
    const gen = ++navGenRef.current;
    const sid = proxySessionIdRef.current;
    const runtimeNavigation = getRuntimeWebNavigation(session.connectionId);
    const continuation = runtimeNavigation?.nativeContinuation;
    pendingFrameRef.current = null;
    currentDocumentRef.current = null;
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setTrustPrompt(null);
    clearFrame();
    try {
      if (continuation) {
        await invoke("cancel_proxy_continuation", {
          continuationId: continuation.id,
        });
        if (runtimeNavigation?.nativeContinuation === continuation)
          delete runtimeNavigation.nativeContinuation;
      }
      if (sid) await invoke("stop_basic_auth_proxy", { sessionId: sid });
      if (!mountedRef.current || gen !== navGenRef.current) return;
      proxySessionIdRef.current = "";
      proxyUrlRef.current = "";
      toast.info(
        "Previous session discarded. Opening a fresh session; other tabs and browser data are unchanged.",
      );
      await navigateToUrl(targetResolution.url, false);
    } catch {
      if (mountedRef.current && gen === navGenRef.current) {
        applyNavigationFailure(
          localNavigationFailure(
            "proxy_start_failed",
            "Unable to clear session data",
            currentUrl,
            "The proxy could not confirm that this session was stopped.",
            "Retry clearing this session before opening a new one.",
          ),
        );
        toast.error(
          "Session data could not be cleared. No fresh session was opened.",
        );
      }
    } finally {
      clearingSessionRef.current = false;
      if (mountedRef.current) setClearingSession(false);
    }
  }, [
    applyNavigationFailure,
    currentUrl,
    navigateToUrl,
    targetResolution.url,
    toast,
    clearFrame,
    session.connectionId,
  ]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const handleHistoryJump = useCallback(
    (index: number) => {
      const previous = historyRef.current;
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= previous.entries.length ||
        index === previous.index
      )
        return;
      const next = { ...previous, index };
      historyRef.current = next;
      setNavigationHistory(next);
      void navigateToUrl(previous.entries[index], false);
    },
    [navigateToUrl],
  );

  const handleBack = useCallback(() => {
    handleHistoryJump(historyRef.current.index - 1);
  }, [handleHistoryJump]);

  const handleForward = useCallback(() => {
    handleHistoryJump(historyRef.current.index + 1);
  }, [handleHistoryJump]);

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
  const handleOpenApplicationExternal = useCallback(async () => {
    const externalUrl = applicationExternalTarget?.url;
    if (
      !externalUrl ||
      applicationExternalTargetRef.current !== externalUrl ||
      openingApplicationExternalRef.current
    )
      return;
    openingApplicationExternalRef.current = true;
    setOpeningApplicationExternal(true);
    try {
      // Validated saved HTTPS origin and static profile path only. Never copy
      // the current page's query/callback, proxy URL, or saved credentials.
      await invoke("open_url_external", { url: externalUrl });
    } catch {
      toast.error(
        "Could not open the system browser. Open the saved website's HTTPS address manually.",
      );
    } finally {
      openingApplicationExternalRef.current = false;
      setOpeningApplicationExternal(false);
    }
  }, [applicationExternalTarget?.url, toast]);

  const runDeepDiagnostics = useCallback(async () => {
    const diagnosticUrl = navigationFailure?.url || currentUrl;
    // A separate on-demand probe bound to the failure page that requested it:
    // a late report never lands on a retry or a newer diagnostics run.
    const run = ++diagnosticRunRef.current;
    const generation = navGenRef.current;
    const failure = navigationFailureRef.current;
    const current = () =>
      mountedRef.current &&
      run === diagnosticRunRef.current &&
      generation === navGenRef.current &&
      failure === navigationFailureRef.current;
    setDiagnosticReport(null);
    setDiagnosticError(null);
    setIsRunningDiagnostics(true);
    setDiagnosticsStartedAt(Date.now());
    try {
      const target = new URL(diagnosticUrl);
      if (
        (target.protocol !== "http:" && target.protocol !== "https:") ||
        target.username ||
        target.password
      ) {
        throw new Error(
          "The failed navigation does not contain a valid web URL.",
        );
      }
      const useTls = target.protocol === "https:";
      const defaultPort = useTls ? 443 : 80;
      const port = target.port ? Number.parseInt(target.port, 10) : defaultPort;
      const path = `${target.pathname || "/"}${target.search}`;
      const verifySsl =
        ((connection as unknown as Record<string, unknown>)?.httpVerifySsl ??
          true) !== false;
      const report = await invoke<ProtocolDiagnosticReport>(
        "diagnose_http_connection",
        {
          host: target.hostname,
          port,
          useTls,
          path,
          method: "GET",
          expectedStatus: null,
          connectTimeoutSecs:
            settings.diagnostics?.protocolDiagTimeoutSecs ?? 15,
          verifySsl,
          proxyUrl: getGlobalHttpProxyUrl({ failClosed: true }),
        },
      );
      if (current()) setDiagnosticReport(report);
    } catch (error) {
      if (current())
        setDiagnosticError(
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      // Page changes already reset the running state; a newer run owns it.
      if (mountedRef.current && run === diagnosticRunRef.current) {
        setIsRunningDiagnostics(false);
        setDiagnosticsStartedAt(null);
      }
    }
  }, [connection, currentUrl, navigationFailure?.url, settings.diagnostics]);

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
    try {
      const contentWindow = iframeRef.current?.contentWindow;
      if (!contentWindow) {
        toast.error("Page is not ready to print");
        return;
      }
      contentWindow.focus?.();
      contentWindow.print();
      toast.info(
        "Use the system print dialog to choose Save as PDF or another printer.",
      );
    } catch (e) {
      console.error("Print page failed:", e);
      toast.error("Print failed. Check the console for details.");
    }
  }, [toast]);

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
        settings.webRecording?.recordHeaders ?? false,
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
        import("../../types/recording/macroTypes").WebRecording | null;
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
    navGenRef.current += 1;
    pendingFrameRef.current = null;
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setTrustPrompt(null);
    clearFrame();
    applyNavigationFailure(
      localNavigationFailure(
        "navigation_cancelled",
        "Loading cancelled",
        currentUrl,
        "The navigation was stopped before the page became ready.",
        `Loading ${currentUrl} was cancelled.`,
      ),
    );
  }, [applyNavigationFailure, currentUrl, clearFrame]);

  const getAutomationDocument = useCallback(() => {
    const doc = currentDocumentRef.current;
    return doc &&
      doc.generation === navGenRef.current &&
      doc.sessionId === proxySessionIdRef.current &&
      !pendingNavigationRef.current &&
      !navigationFailureRef.current
      ? doc
      : null;
  }, []);
  const automation = useWebAutomation({
    activityContext: session.ownerDatabaseId
      ? {
          sessionId: session.id,
          connectionId: session.connectionId,
          databaseId: session.ownerDatabaseId,
        }
      : undefined,
    connection,
    ownerDatabaseId: session.ownerDatabaseId,
    settings,
    settingsReady: settingsReady === true,
    appearanceScopeKey:
      databaseAvailability?.status === "ready" &&
      databaseAvailability.databaseId === session.ownerDatabaseId
        ? `${databaseAvailability.databaseId}:${databaseAvailability.generation}`
        : "",
    scopeKey: recycleBin?.snapshot
      ? `${recycleBin.snapshot.scope.databaseId}:${recycleBin.snapshot.scope.generation}`
      : "",
    blocked:
      waitingForTrust ||
      !!trustPrompt ||
      !!loadError ||
      proxyOptions.policy?.pageScripts === "block" ||
      !!proxyOptions.error ||
      clearingSession,
    navigationKey: `${session.id}:${currentUrl}:${isLoading}`,
    iframe: iframeRef,
    getDocument: getAutomationDocument,
    updateConnection: (updated) =>
      dispatchAndFlush({ type: "UPDATE_CONNECTION", payload: updated }),
  });

  const autoMfa = useWebAutoMfa({
    connection: noncredentialConnection,
    vaultTotp: vaultSource ? vaultTotp : undefined,
    ownerDatabaseId: session.ownerDatabaseId,
    availability: databaseAvailability,
    settingsReady: settingsReady === true,
    blocked:
      waitingForTrust ||
      !!trustPrompt ||
      !!loadError ||
      !!sslVerifyDisabled ||
      proxyOptions.policy?.pageScripts === "block" ||
      !!proxyOptions.error ||
      clearingSession,
    currentUrl,
    navigationKey: `${session.id}:${currentUrl}:${isLoading}`,
    iframe: iframeRef,
    getDocument: getAutomationDocument,
  });

  return {
    webNetworkRouting:
      networkRouting?.scope === networkReportScope()
        ? networkRouting.value
        : null,
    webNetworkReports:
      networkReports.scope === networkReportScope() ? networkReports.rows : [],
    webNetworkGuard:
      networkGuard?.scope === trustOwnerScope ? networkGuard.status : null,
    showClearSessionConfirm,
    setShowClearSessionConfirm,
    clearingSession,
    handleClearSessionData,
    automation,
    autoMfa,
    // Context
    session,
    connection: noncredentialConnection,
    settings,
    // Navigation
    currentUrl,
    inputUrl,
    setInputUrl,
    isLoading,
    showLoadingIndicator:
      isLoading && loadingIndicatorReady && !trustPrompt && !loadError,
    loadError,
    navigationFailure,
    diagnosticReport,
    isRunningDiagnostics,
    diagnosticsStartedAt,
    /** The separate deep-diagnostics probe's own TCP connect budget. */
    diagnosticConnectTimeoutSecs:
      settings.diagnostics?.protocolDiagTimeoutSecs ?? 15,
    diagnosticError,
    isSecure,
    canGoBack,
    canGoForward,
    backHistory: history
      .slice(0, historyIndex)
      .map((url, index) => ({ url, index }))
      .reverse(),
    forwardHistory: history
      .slice(historyIndex + 1)
      .map((url, index) => ({ url, index: historyIndex + index + 1 })),
    handleHistoryJump,
    iframeRef,
    attachIframe,
    shouldMountIframe,
    pageInteractionBlocked: waitingForTrust || !!trustPrompt || !!loadError,
    handleUrlSubmit,
    handleIframeLoad,
    handleRefresh,
    handleBack,
    handleForward,
    handleOpenInNewTab,
    handleOpenExternal,
    isCloudflareDashboard,
    applicationExternalTarget,
    openingApplicationExternal,
    handleOpenApplicationExternal,
    runDeepDiagnostics,
    navigateToUrl,
    handleCancelLoading,
    // Auth
    hasAuth,
    deferredLogin: deferredLogin.presentation,
    refreshDeferredLoginStatus: deferredLogin.refresh,
    authLabel:
      ["none", "bitwarden-form", "synology-form"].includes(
        applicationAuth.login?.upstreamAuthMode ?? "",
      ) &&
      applicationAuth.login &&
      applicationAuth.login.autoLogin
        ? "Form login"
        : "Basic Auth",
    redirectReview,
    resolvedCreds,
    sslVerifyDisabled,
    iconPadding,
    // Proxy
    proxyAlive,
    proxyRestarting,
    handleRestartProxy,
    proxySessionIdRef,
    webProxyOrigin:
      proxySessionIdRef.current && proxyUrlRef.current
        ? new URL(proxyUrlRef.current).origin
        : undefined,
    // Certificate
    showCertPopup,
    setShowCertPopup,
    certIdentity,
    certificateInspection,
    certificateHost: normalizedHostname,
    certPopupRef,
    trustPrompt,
    trustCheck,
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
    vaultTotp,
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
