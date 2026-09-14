import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement as invoke,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type {
  SynologyFileAuthResult,
  SynologyFileLogin,
} from "../../types/hardware/synologyFileStation";
import { normalizeSynologyEndpoint } from "../../utils/connection/synologyEndpoint";
import { redactSynologyFailureSecrets } from "../../utils/synology/apiFailureDiagnostic";
import { verifySynologyApiTransportCapabilities } from "./synologyApiCapabilities";
import {
  captureSynologyApiRoute,
  SYNOLOGY_ROUTE_CHANGED,
  type SynologyApiRouteSnapshot,
} from "./synologyApiRoute";

export interface SynologyFileConnectionOptions {
  /** One identity for this mounted tab; never a connection id shared by tabs. */
  instanceId?: string;
  initialConfig?: SynologyFileLogin;
  assertCurrent?: () => void;
  /** Saved vault adapter. Secrets stay in this attempt, never form state. */
  resolveCredentials?: (assertAttempt: () => void) => Promise<{
    username: string;
    password: string;
    assertCurrent: () => void;
  }>;
  /** Explicit selected vault authenticator; only invoked after DSM requests OTP. */
  resolveOtp?: (
    assertAttempt: () => void,
  ) => Promise<{ code: string; assertCurrent: () => void }>;
}
const challengeMessages = {
  otp_required: "Enter the current one-time code from your authenticator.",
  otp_invalid: "The one-time code was not accepted. Enter a fresh code.",
  unsupported_mfa:
    "This authentication method requires the DSM website. Browser sign-in does not authorize the native API.",
};

export interface SynologySessionHealth {
  status: "connected" | "degraded" | "authentication-required";
  lastVerifiedAt: string;
  consecutiveFailures: number;
  message: string | null;
}

export function useSynologyFileConnection(
  isOpen: boolean,
  options: SynologyFileConnectionOptions = {},
) {
  const [instanceId] = useState(
    () => options.instanceId ?? crypto.randomUUID(),
  );
  const initialTarget = useRef(
    options.initialConfig
      ? {
          host: options.initialConfig.host,
          port: options.initialConfig.port,
          useHttps: options.initialConfig.useHttps,
        }
      : null,
  );
  const initial = options.initialConfig;
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 5001);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [useHttps, setUseHttps] = useState(initial?.useHttps ?? true);
  const [otpCode, setOtpCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sessionHealth, setSessionHealth] =
    useState<SynologySessionHealth | null>(null);
  const [challenge, setChallenge] = useState<Exclude<
    SynologyFileAuthResult,
    { status: "connected" }
  > | null>(null);
  const current = useRef({
    isOpen,
    assertCurrent: options.assertCurrent,
    resolveCredentials: options.resolveCredentials,
    resolveOtp: options.resolveOtp,
  });
  current.current = {
    isOpen,
    assertCurrent: options.assertCurrent,
    resolveCredentials: options.resolveCredentials,
    resolveOtp: options.resolveOtp,
  };
  const alive = useRef(true),
    generation = useRef(0),
    busy = useRef(false);
  const receipt = useRef<string | null>(null);
  const pendingRequest = useRef<string | null>(null);
  const pendingCredentials = useRef<SynologyFileLogin | null>(null);
  const activeRoute = useRef<SynologyApiRouteSnapshot | null>(null);
  const assertSessionAccess = useCallback(() => {
    if (!alive.current || !current.current.isOpen)
      throw new Error("This NAS session is unavailable.");
    current.current.assertCurrent?.();
    activeRoute.current?.assertCurrent();
  }, []);
  const release = useCallback(
    (id: string) =>
      invoke("syn_fs_disconnect", { instanceId, expectedSessionId: id }),
    [instanceId],
  );
  const cancelPending = useCallback(() => {
    const requestId = pendingRequest.current;
    pendingRequest.current = null;
    if (requestId)
      void invoke("syn_fs_cancel_connect", { instanceId, requestId }).catch(
        () => undefined,
      );
  }, [instanceId]);
  const reset = useCallback(() => {
    generation.current++;
    cancelPending();
    busy.current = false;
    pendingCredentials.current = null;
    activeRoute.current = null;
    if (alive.current) {
      setPassword("");
      setOtpCode("");
      setChallenge(null);
      setConnectionStatus("disconnected");
      setConnectionError(null);
      setSessionHealth(null);
    }
  }, [cancelPending]);
  const disconnect = useCallback(async () => {
    reset();
    const id = receipt.current;
    if (id) {
      try {
        await release(id);
      } catch {
        if (alive.current) {
          setConnectionError(
            "NAS cleanup failed. Retry Disconnect before closing this session.",
          );
          setConnectionStatus("error");
        }
        throw new Error("NAS session cleanup failed.");
      }
      if (receipt.current !== id) return;
      receipt.current = null;
    }
    if (alive.current) setSessionId(null);
  }, [reset, release]);
  useEffect(() => {
    alive.current = true;
    const attempts = generation;
    return () => {
      alive.current = false;
      attempts.current++;
      cancelPending();
      pendingCredentials.current = null;
      activeRoute.current = null;
      const id = receipt.current;
      receipt.current = null;
      if (id) void release(id).catch(() => undefined);
    };
  }, [cancelPending, release]);
  useEffect(() => {
    if (!isOpen) void disconnect().catch(() => undefined);
  }, [isOpen, disconnect]);

  useEffect(() => {
    const checkRoute = () => {
      try {
        activeRoute.current?.assertCurrent();
      } catch {
        void disconnect().catch(() => undefined);
        if (alive.current) {
          setConnectionError(SYNOLOGY_ROUTE_CHANGED);
          setConnectionStatus("error");
        }
      }
    };
    window.addEventListener("settings-updated", checkRoute);
    return () => window.removeEventListener("settings-updated", checkRoute);
  }, [disconnect]);

  useEffect(() => {
    if (!sessionId || !isOpen) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const captured = generation.current;
    const valid = () =>
      !disposed &&
      alive.current &&
      generation.current === captured &&
      receipt.current === sessionId;
    const check = async () => {
      try {
        assertSessionAccess();
      } catch {
        if (valid()) void disconnect().catch(() => undefined);
        return;
      }
      try {
        // Reads redacted native health; the native timer, not this renderer
        // poll, keeps DSM alive even when WebView timers are throttled.
        const health = await invoke<SynologySessionHealth>(
          "syn_fs_session_health",
          { instanceId, expectedSessionId: sessionId },
        );
        if (!valid()) return;
        assertSessionAccess();
        if (
          !health ||
          !["connected", "degraded", "authentication-required"].includes(
            health.status,
          )
        )
          throw new Error("Invalid native session health response");
        if (health.status === "authentication-required") {
          receipt.current = null;
          reset();
          setSessionId(null);
          setConnectionError(
            health.message?.replace(/^SYNOLOGY_SESSION_EXPIRED: /, "") ||
              "The NAS ended this API session. Reconnect; no file operation was retried.",
          );
          void release(sessionId).catch(() => undefined);
          return;
        }
        setSessionHealth(health);
      } catch (error) {
        if (!valid()) return;
        if (
          toSafeManagementError(error).startsWith("SYNOLOGY_SESSION_EXPIRED: ")
        ) {
          receipt.current = null;
          reset();
          setSessionId(null);
          setConnectionError(
            "This File Station session ended. Reconnect; no file operation was retried.",
          );
          return;
        }
        setSessionHealth((previous) => ({
          status: "degraded",
          lastVerifiedAt: previous?.lastVerifiedAt ?? "",
          consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
          message:
            "Session health is temporarily unavailable. Check the desktop connection; authentication has not been retried.",
        }));
      }
      if (valid()) timer = setTimeout(() => void check(), 15_000);
    };
    void check();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    sessionId,
    isOpen,
    instanceId,
    assertSessionAccess,
    disconnect,
    reset,
    release,
  ]);

  const attempt = async (input: SynologyFileLogin, otp?: string) => {
    const config = { ...input };
    if (
      busy.current ||
      receipt.current ||
      !current.current.isOpen ||
      !alive.current
    )
      return;
    const access = current.current.assertCurrent;
    const resolveCredentials = current.current.resolveCredentials;
    const resolveOtp = current.current.resolveOtp;
    let credentialGuard: (() => void) | undefined;
    try {
      access?.();
    } catch {
      reset();
      setConnectionError(
        "The owning database is unavailable. Reopen this connection after unlocking it.",
      );
      return;
    }
    busy.current = true;
    const captured = ++generation.current;
    let requestId = crypto.randomUUID();
    pendingRequest.current = requestId;
    const valid = (includeCredential = true) => {
      if (
        !alive.current ||
        !current.current.isOpen ||
        generation.current !== captured ||
        current.current.assertCurrent !== access ||
        current.current.resolveCredentials !== resolveCredentials ||
        current.current.resolveOtp !== resolveOtp
      )
        return false;
      try {
        access?.();
        if (includeCredential) credentialGuard?.();
        return true;
      } catch {
        return false;
      }
    };
    setConnectionError(null);
    setConnectionStatus("connecting");
    setOtpCode("");
    let routeSnapshot: SynologyApiRouteSnapshot | null = null;
    try {
      routeSnapshot = activeRoute.current ?? captureSynologyApiRoute();
      routeSnapshot.assertCurrent();
      activeRoute.current = routeSnapshot;
      // The resolver's returned guard calls this base guard. It must not recurse
      // through the returned credential guard that is installed afterwards.
      const assertBaseAttempt = () => {
        if (!valid(false))
          throw new Error("This NAS authentication attempt was cancelled.");
        routeSnapshot!.assertCurrent();
      };
      const assertAttempt = () => {
        if (!valid())
          throw new Error("This NAS authentication attempt was cancelled.");
        routeSnapshot!.assertCurrent();
      };
      const checkReturnedRoute = async (result: SynologyFileAuthResult) => {
        try {
          routeSnapshot!.assertCurrent();
        } catch {
          if (
            result?.status === "connected" &&
            typeof result.sessionId === "string" &&
            result.sessionId.length > 0 &&
            result.sessionId.length <= 256 &&
            ![...result.sessionId].some((char) => char.charCodeAt(0) < 32)
          )
            await release(result.sessionId);
          throw new Error(SYNOLOGY_ROUTE_CHANGED);
        }
      };
      await verifySynologyApiTransportCapabilities();
      assertAttempt();
      if (resolveCredentials) {
        const credentials = await resolveCredentials(assertBaseAttempt);
        assertAttempt();
        credentials.assertCurrent();
        credentialGuard = credentials.assertCurrent;
        config.username = credentials.username;
        config.password = credentials.password;
        if (!config.username.trim() || !config.password)
          throw new Error(
            "The selected vault credential needs a username and password for Synology NAS API.",
          );
      }
      assertAttempt();
      let result = await invoke<SynologyFileAuthResult>("syn_fs_connect", {
        ...config,
        instanceId,
        requestId,
        otpCode: otp || null,
        route: routeSnapshot.route,
      });
      await checkReturnedRoute(result);
      if (result?.status === "otp_required" && !otp && resolveOtp && valid()) {
        // One server-requested factor, never an automatic retry of a rejected code.
        const generated = await resolveOtp(assertAttempt);
        assertAttempt();
        generated.assertCurrent();
        otp = generated.code;
        if (!/^\d{6,8}$/.test(otp))
          throw new Error("The vault authenticator returned an invalid code.");
        requestId = crypto.randomUUID();
        pendingRequest.current = requestId;
        generated.assertCurrent();
        result = await invoke<SynologyFileAuthResult>("syn_fs_connect", {
          ...config,
          instanceId,
          requestId,
          otpCode: otp,
          route: routeSnapshot.route,
        });
        await checkReturnedRoute(result);
      }
      if (
        !result ||
        typeof result !== "object" ||
        typeof result.status !== "string"
      )
        throw new Error("The NAS returned an invalid authentication result.");
      if (
        result.status === "connected" &&
        (typeof result.sessionId !== "string" ||
          !result.sessionId ||
          result.sessionId.length > 256 ||
          [...result.sessionId].some((char) => char.charCodeAt(0) < 32))
      )
        throw new Error(
          "The NAS did not return a valid scoped File Station session.",
        );
      if (!valid()) {
        if (result.status === "connected") await release(result.sessionId);
        return;
      }
      if (result.status === "connected") {
        if (typeof result.sessionId !== "string" || !result.sessionId)
          throw new Error();
        receipt.current = result.sessionId;
        setSessionId(result.sessionId);
        pendingCredentials.current = null;
        setPassword("");
        setChallenge(null);
        setConnectionStatus("connected");
      } else if (
        result.status === "otp_required" ||
        result.status === "otp_invalid" ||
        result.status === "unsupported_mfa"
      ) {
        setChallenge({ ...result, message: challengeMessages[result.status] });
        setPassword("");
        if (result.status === "unsupported_mfa")
          pendingCredentials.current = null;
        setConnectionStatus("disconnected");
      } else
        throw new Error(
          "The NAS returned an unsupported authentication result.",
        );
    } catch (error) {
      if (valid()) {
        const safe = redactSynologyFailureSecrets(
          toSafeManagementError(error),
          [
            config.password,
            otp,
            ...(routeSnapshot?.route.kind === "http_proxy"
              ? [routeSnapshot.route.username, routeSnapshot.route.password]
              : []),
          ],
        );
        setConnectionError(safe);
        setConnectionStatus("error");
        pendingCredentials.current = null;
        activeRoute.current = null;
        setChallenge(null);
        setPassword("");
      }
    } finally {
      if (resolveCredentials) config.password = "";
      otp = undefined;
      if (pendingRequest.current === requestId) pendingRequest.current = null;
      if (generation.current === captured) busy.current = false;
    }
  };
  const handlerGeneration = generation.current;
  const connect = async () => {
    if (generation.current !== handlerGeneration) return;
    if (busy.current || challenge || receipt.current) return;
    const target = initialTarget.current;
    if (
      target &&
      (host !== target.host ||
        port !== target.port ||
        useHttps !== target.useHttps)
    ) {
      setConnectionError(
        "Use Edit Connection to change this saved NAS target or transport.",
      );
      return;
    }
    const login = options.initialConfig ?? {
      host,
      port,
      username,
      password,
      useHttps,
    };
    if (
      !host.trim() ||
      (!options.resolveCredentials &&
        (!login.username.trim() || !login.password)) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      setConnectionError(
        target
          ? "This connection has a missing NAS address, invalid port or missing credentials."
          : "Enter the NAS host, valid port, username, and password.",
      );
      setConnectionStatus("error");
      return;
    }
    let endpoint;
    try {
      endpoint = normalizeSynologyEndpoint(host, port, useHttps);
      // A standalone URL can choose its transport, but a saved connection's
      // explicit transport is an authorization boundary. Never downgrade HTTPS
      // (or silently change the target) because its hostname contains a URL.
      if (target && endpoint.useHttps !== target.useHttps)
        throw new Error(
          "The NAS address URL conflicts with this saved connection's HTTP/HTTPS transport. Use Edit Connection to make them consistent before signing in.",
        );
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "The NAS address is invalid.",
      );
      setConnectionStatus("error");
      return;
    }
    const config = {
      ...endpoint,
      username: login.username,
      password: login.password,
    };
    pendingCredentials.current = config;
    await attempt(config);
  };
  const submitOtp = async () => {
    if (generation.current !== handlerGeneration) return;
    const config = pendingCredentials.current;
    if (
      !config ||
      !challenge ||
      challenge.status === "unsupported_mfa" ||
      !/^[0-9]{6,8}$/.test(otpCode.trim())
    )
      return;
    await attempt(config, otpCode.trim());
  };
  const notifySessionExpired = (expectedSessionId: string, reason?: string) => {
    if (receipt.current !== expectedSessionId) return;
    receipt.current = null;
    reset();
    setSessionId(null);
    setConnectionError(
      reason?.replace(/^SYNOLOGY_SESSION_EXPIRED: /, "") ||
        "The NAS session expired. Sign in again; no file operation was retried.",
    );
    void release(expectedSessionId).catch(() => undefined);
  };
  return {
    instanceId,
    targetLocked: initialTarget.current !== null,
    credentialsLocked: !!options.resolveCredentials,
    assertSessionAccess,
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    password,
    setPassword,
    useHttps,
    setUseHttps,
    otpCode,
    setOtpCode,
    sessionId,
    connectionStatus,
    connectionError,
    sessionHealth,
    challenge,
    connect,
    disconnect,
    submitOtp,
    notifySessionExpired,
    cancelChallenge: reset,
  };
}
