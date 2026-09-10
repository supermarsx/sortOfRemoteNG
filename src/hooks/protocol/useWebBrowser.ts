import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { debugLog } from "../../utils/core/debugLogger";
import {
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
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
import * as macroService from "../../utils/recording/macroService";
import {
  verifyIdentity,
  trustIdentity,
  resolveEffectiveTrustPolicy,
  validateCertificateIdentity,
  type CertIdentity,
  type TrustVerifyResult,
} from "../../utils/auth/trustStore";
import { parseCanonicalWebAuthority } from "../../utils/connection/sanitizeHostname";
import { resolveRuntimeConnection } from "../../utils/session/runtimeConnectionRegistry";
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
import type {
  CertificateInspection,
  NativeTlsCertificateInfo,
} from "../../types/security/certificateInspection";
import { validateCertificateInspection } from "../../utils/security/certificateInspection";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

export interface ProxyMediatorResponse {
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
  | "upstream_failure"
  | "http_status"
  | "invalid_navigation"
  | "proxy_start_failed"
  | "trust_failure"
  | "certificate_rejected";

export interface ProxyNavigationFailure {
  version: 1;
  sessionId: string;
  kind: ProxyFailureKind;
  status: number | null;
  title: string;
  url: string;
  reason: string;
  detail: string;
}

const PROXY_FAILURE_KINDS = new Set<ProxyFailureKind>([
  "timeout",
  "connection_refused",
  "dns_failure",
  "tls_failure",
  "connection_failed",
  "bad_request",
  "redirect_loop",
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
    status < 400 ||
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

function localNavigationFailure(
  kind: Extract<
    ProxyFailureKind,
    | "timeout"
    | "page_load_timeout"
    | "navigation_cancelled"
    | "invalid_navigation"
    | "proxy_start_failed"
    | "certificate_rejected"
    | "trust_failure"
    | "tls_failure"
  >,
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
  } = useConnections();
  const { settings, settingsReady } = useSettings();
  const { toast } = useToastContext();
  const connection = resolveRuntimeConnection(
    state.connections,
    session.connectionId,
  );
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
      else if (profile?.loginPath) target.pathname = profile.loginPath;
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
        url: target.toString(),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Saved web hostname is invalid.",
        hostname: "",
        url: "",
      };
    }
  }, [
    connection?.port,
    connection?.httpApplication,
    session.hostname,
    session.protocol,
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
  const previousApplicationAuth = useRef({
    auth: applicationAuth,
    profile: connection?.httpApplication,
  });

  const hasAuth = resolvedCreds !== null;
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
        ...session,
        status: "connected",
        errorMessage: undefined,
      },
    });
  }, [dispatch, session]);

  // ── State ───────────────────────────────────────────────────
  const [currentUrl, setCurrentUrl] = useState(targetResolution.url);
  const [inputUrl, setInputUrl] = useState(currentUrl);
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
    connection?.port || 443,
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
  const certPopupRef = useRef<HTMLDivElement>(null);

  // ── Proxy tracking ─────────────────────────────────────────
  const proxySessionIdRef = useRef<string>("");
  const proxyUrlRef = useRef<string>("");
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navGenRef = useRef(0);
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
  } | null>(null);
  const pendingFrameRef = useRef<{
    generation: number;
    url: string;
    cleanUrl: string;
    token: string;
    sessionId: string;
  } | null>(null);
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
    clearLoadingIndicator();
    awaitingFrameGenerationRef.current = null;
    setCertificateCapture(null);
    setShowCertPopup(false);
    setTrustPrompt(null);
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
  }, [certificateScope, clearLoadingIndicator]);
  const navigationFailureRef = useRef<ProxyNavigationFailure | null>(
    navigationFailure,
  );

  const clearNavigationFailure = useCallback(() => {
    navigationFailureRef.current = null;
    setNavigationFailure(null);
    setLoadError("");
    setDiagnosticReport(null);
    setDiagnosticError(null);
  }, []);

  const applyNavigationFailure = useCallback(
    (failure: ProxyNavigationFailure) => {
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
      setDiagnosticReport(null);
      setDiagnosticError(null);
    },
    [clearLoadingIndicator],
  );
  /**
   * Set once `fetchAndVerifyCert` has resolved trust for this tab.
   * The proxy receives this SHA-256 leaf certificate fingerprint and pins
   * outbound TLS to that exact certificate instead of disabling TLS
   * verification for the whole session.
   */
  const acceptedCertFingerprintRef = useRef<string | null>(null);
  const LOAD_TIMEOUT_MS = 30_000;
  const armNavigationDeadline = useCallback(
    (generation: number, url: string) => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
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
            `Page readiness was not confirmed within ${LOAD_TIMEOUT_MS / 1000} seconds. Proxy startup, page scripts or resources, and browser loading can cause this; it does not prove the server failed to respond.`,
          ),
        );
      }, LOAD_TIMEOUT_MS);
    },
    [applyNavigationFailure],
  );

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
      const port = connection?.port || 443;
      const policy = resolveEffectiveTrustPolicy(
        connection?.httpsTrustPolicy,
        settings.httpsTrustPolicy,
        settings.trustPolicy,
        connection?.tlsTrustPolicy ?? settings.tlsTrustPolicy ?? "always-ask",
      );
      // Capture the navigation generation BEFORE the async gap so we can
      // detect whether a newer navigation has superseded us after the
      // await completes (e.g. React StrictMode double-mount race).
      const genBefore = navGenRef.current;
      let stage: "inspection" | "identity" | "verification" | "persistence" =
        "inspection";

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
        const result = await verifyIdentity(
          normalizedHostname,
          port,
          "https",
          identity,
          connId,
        );
        if (genBefore !== navGenRef.current) return false;
        if (result.status === "trusted") {
          // The cert was previously accepted (this session or a prior one).
          // Pin the proxy to the same fingerprint.
          acceptedCertFingerprintRef.current = identity.fingerprint;
          return true;
        }
        if (
          result.status === "first-use" &&
          policy === "tofu" &&
          !result.requiresApproval
        ) {
          stage = "persistence";
          await trustIdentity(
            normalizedHostname,
            port,
            "https",
            identity,
            false,
            connId,
          );
          if (genBefore !== navGenRef.current) return false;
          // P6c: TOFU auto-trusted on first contact — same as above.
          acceptedCertFingerprintRef.current = identity.fingerprint;
          return true;
        }
        if (
          result.status === "mismatch" ||
          result.status === "expired" ||
          (result.status === "first-use" && result.requiresApproval) ||
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
        if (genBefore !== navGenRef.current) return false;
        debugLog("WebBrowser", "HTTPS trust pipeline failed", { stage, err });
        acceptedCertFingerprintRef.current = null;
        applyNavigationFailure(
          localNavigationFailure(
            stage === "inspection" || stage === "identity"
              ? "tls_failure"
              : "trust_failure",
            stage === "inspection"
              ? "Unable to inspect the HTTPS certificate"
              : stage === "identity"
                ? "Invalid HTTPS certificate identity"
                : stage === "persistence"
                  ? "Unable to save the HTTPS trust decision"
                  : "Unable to verify HTTPS trust",
            activeNavigationUrlRef.current,
            stage === "inspection" || stage === "identity"
              ? "Certificate inspection or identity validation failed on the configured route. The connection was not opened without the trust check."
              : "The certificate was inspected, but the database Trust Center could not complete its decision. Open or unlock the correct database and inspect its Trust Center; TLS verification was not bypassed.",
            err instanceof Error ? err.message : String(err),
          ),
        );
        return false;
      }
    },
    [
      session.protocol,
      normalizedHostname,
      connection,
      settings.httpsTrustPolicy,
      settings.trustPolicy,
      settings.tlsTrustPolicy,
      applyNavigationFailure,
      certificateScope,
    ],
  );

  const handleTrustAccept = useCallback(
    async (remember = true) => {
      const generation = navGenRef.current;
      armNavigationDeadline(generation, activeNavigationUrlRef.current);
      if (trustPrompt && certIdentity && remember) {
        const port = connection?.port || 443;
        try {
          await trustIdentity(
            normalizedHostname,
            port,
            "https",
            certIdentity,
            true,
            connection?.id,
          );
          if (generation !== navGenRef.current) return;
        } catch (err) {
          if (generation !== navGenRef.current) return;
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
      acceptedCertFingerprintRef.current = certIdentity?.fingerprint ?? null;
      setTrustPrompt(null);
      trustResolveRef.current?.(true);
      trustResolveRef.current = null;
    },
    [
      trustPrompt,
      certIdentity,
      normalizedHostname,
      connection,
      applyNavigationFailure,
      armNavigationDeadline,
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

  // ── Navigation ─────────────────────────────────────────────
  const navigateToUrl = useCallback(
    async (url: string, addToHistory = true) => {
      const gen = ++navGenRef.current;
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
      if (applicationAuth.error) {
        applyNavigationFailure(
          localNavigationFailure(
            "invalid_navigation",
            "Application login needs review",
            url || session.hostname,
            "No connection was started with these application settings.",
            applicationAuth.error,
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
      try {
        const upstreamProxyUrl = getGlobalHttpProxyUrl({ failClosed: true });
        if (urlObj.protocol === "https:") {
          const trusted = await fetchAndVerifyCert(upstreamProxyUrl);
          if (!trusted || gen !== navGenRef.current) return;
          armNavigationDeadline(gen, url);
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
          const response = await invoke<ProxyMediatorResponse>(
            "start_basic_auth_proxy",
            {
              config: {
                target_url: targetOrigin,
                // Empty strings when no auth — the backend treats
                // (empty, empty) as "no credentials" and skips the
                // basic_auth() call on every upstream request.
                username: resolvedCreds?.username ?? "",
                password: resolvedCreds?.password ?? "",
                ...(applicationAuth.login?.upstreamAuthMode
                  ? {
                      upstream_auth_mode:
                        applicationAuth.login.upstreamAuthMode,
                    }
                  : {}),
                local_port: 0,
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
                http_auto_login: applicationAuth.login?.autoLogin ?? false,
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
          );
          if (gen !== navGenRef.current) {
            invoke("stop_basic_auth_proxy", {
              sessionId: response.session_id,
            }).catch(() => {});
            return;
          }
          let protectedProxyUrl: string;
          try {
            protectedProxyUrl = validateProtectedProxyUrl(response);
          } catch (error) {
            await stopProxy(response.session_id);
            throw error;
          }
          proxySessionIdRef.current = response.session_id;
          proxyUrlRef.current = protectedProxyUrl;
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
        console.error("Navigation failed:", error);
        const msg = error instanceof Error ? error.message : String(error);
        const errorMessage =
          msg.includes("401") || msg.includes("Unauthorized")
            ? applicationAuth.login?.upstreamAuthMode === "none"
              ? "The website requires authentication. Review its Application login mode or sign in manually; form credentials are not sent as HTTP Basic."
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
      }
    },
    [
      hasAuth,
      resolvedCreds,
      applicationAuth,
      connection,
      targetResolution,
      stopProxy,
      readThemeTokens,
      appendHistory,
      fetchAndVerifyCert,
      settings.webRecording,
      webRecorder,
      markSessionConnected,
      session.hostname,
      clearNavigationFailure,
      applyNavigationFailure,
      beginLoadingPresentation,
      armNavigationDeadline,
      navigateFrame,
      session.protocol,
    ],
  );

  // ── Effects ────────────────────────────────────────────────
  // Profile edits revoke the prior one-shot credential dispenser. Do not send
  // newly edited credentials until an explicit navigation/reload. Unrelated
  // connection metadata updates must not interrupt a working page.
  useEffect(() => {
    const previous = previousApplicationAuth.current;
    previousApplicationAuth.current = {
      auth: applicationAuth,
      profile: connection?.httpApplication,
    };
    if (
      previous.profile === undefined &&
      connection?.httpApplication === undefined
    )
      return;
    if (
      previous.profile?.id === connection?.httpApplication?.id &&
      previous.auth.error === applicationAuth.error &&
      sameHttpApplicationLogin(previous.auth.login, applicationAuth.login)
    )
      return;
    navGenRef.current += 1;
    trustResolveRef.current?.(false);
    trustResolveRef.current = null;
    setTrustPrompt(null);
    clearWebBrowserFrame(iframeRef.current);
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
    connection?.httpApplication,
    stopProxy,
    applyNavigationFailure,
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
  }, []);

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
      const resp = await invoke<ProxyMediatorResponse>(
        "restart_proxy_session",
        { sessionId: sid },
      );
      let protectedProxyUrl: string;
      try {
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
        if (
          navigationFailureRef.current ||
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
          const generation = ++navGenRef.current;
          pendingFrameRef.current = null;
          pendingInternalNavigationRef.current = true;
          pendingNavigationRef.current = true;
          awaitingFrameGenerationRef.current = generation;
          beginLoadingPresentation(generation);
          armNavigationDeadline(generation, activeNavigationUrlRef.current);
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
          };
          const realUrl = targetUrlFor(reported);
          activeNavigationUrlRef.current = realUrl;
          setCurrentUrl(realUrl);
          setInputUrl(realUrl);
          setIsSecure(realUrl.startsWith("https:"));
          if (report.navigationToken === null) appendHistory(realUrl);
          return;
        }
        if (
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
    clearLoadingIndicator,
    beginLoadingPresentation,
    armNavigationDeadline,
    appendHistory,
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
    setDiagnosticReport(null);
    setDiagnosticError(null);
    setIsRunningDiagnostics(true);
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
      setDiagnosticReport(report);
    } catch (error) {
      setDiagnosticError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsRunningDiagnostics(false);
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
    clearWebBrowserFrame(iframeRef.current);
    applyNavigationFailure(
      localNavigationFailure(
        "navigation_cancelled",
        "Loading cancelled",
        currentUrl,
        "The navigation was stopped before the page became ready.",
        `Loading ${currentUrl} was cancelled.`,
      ),
    );
  }, [applyNavigationFailure, currentUrl]);

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
    connection,
    ownerDatabaseId: session.ownerDatabaseId,
    settings,
    settingsReady: settingsReady === true,
    scopeKey: recycleBin?.snapshot
      ? `${recycleBin.snapshot.scope.databaseId}:${recycleBin.snapshot.scope.generation}`
      : "",
    blocked: waitingForTrust || !!trustPrompt || !!loadError,
    navigationKey: `${session.id}:${currentUrl}:${isLoading}`,
    iframe: iframeRef,
    getDocument: getAutomationDocument,
    updateConnection: (updated) =>
      dispatchAndFlush({ type: "UPDATE_CONNECTION", payload: updated }),
  });

  const autoMfa = useWebAutoMfa({
    connection,
    ownerDatabaseId: session.ownerDatabaseId,
    availability: databaseAvailability,
    settingsReady: settingsReady === true,
    blocked:
      waitingForTrust || !!trustPrompt || !!loadError || !!sslVerifyDisabled,
    currentUrl,
    navigationKey: `${session.id}:${currentUrl}:${isLoading}`,
    iframe: iframeRef,
    getDocument: getAutomationDocument,
  });

  return {
    automation,
    autoMfa,
    // Context
    session,
    connection,
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
    authLabel:
      applicationAuth.login?.upstreamAuthMode === "none" &&
      applicationAuth.login.autoLogin
        ? "Form login"
        : "Basic Auth",
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
    certificateInspection,
    certificateHost: normalizedHostname,
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
