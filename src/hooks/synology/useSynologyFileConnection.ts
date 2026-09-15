import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement as invoke,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type {
  SynologyAuthMethod,
  SynologyDeviceTrustAdapter,
  SynologyDeviceTrustWrite,
  SynologyFileAuthChallenge,
  SynologyFileAuthResult,
  SynologyFileLogin,
  SynologySessionProfile,
  SynologyTrustedDevice,
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
  /** Vault trusted-device storage; absent for local credentials and the standalone form. */
  deviceTrust?: SynologyDeviceTrustAdapter;
  /** Saved `synologySettings.trustDevice`: the sign-in checkbox starts from it. */
  trustDevice?: boolean;
  /** Why this saved connection can't trust devices; shown beside a disabled checkbox. */
  deviceTrustUnavailable?: string;
}
export const SYNOLOGY_TRUSTED_DEVICE_REJECTED =
  "This NAS no longer accepts the saved trusted device. Enter a code to continue.";
export const SYNOLOGY_TRUSTED_DEVICE_MISMATCH =
  "The saved trusted device was set up on another computer, so it wasn't used. Enter a code to continue.";
const staleTrustAfterSignIn = {
  rejected:
    "This NAS no longer accepted the saved trusted device, so it was forgotten.",
  mismatch:
    "The saved trusted device was set up on another computer, so it was forgotten.",
};
export const SYNOLOGY_TRUSTED_DEVICE_SAVED =
  "This computer is now a trusted device for this NAS account. Later sign-ins from it skip the one-time code.";
export const SYNOLOGY_TRUSTED_DEVICE_NOT_ISSUED =
  "DSM didn't issue a trusted device for this sign-in, so the next sign-in will ask for a code again.";
export const SYNOLOGY_TRUSTED_DEVICE_FORGOTTEN =
  "This computer is no longer a trusted device for this NAS account. The next sign-in will ask for a code.";
const trustNotRemembered =
  "This device was not remembered. The next sign-in will ask for a code.";
const trustNotForgotten =
  "The trusted device was not forgotten. Remove it from the vault entry instead.";
const printableField = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
/** Copies only a well-formed device; anything else is treated as absent. */
const readTrustedDevice = (value: unknown): SynologyTrustedDevice | null => {
  if (!value || typeof value !== "object") return null;
  const { deviceName, deviceId } = value as Record<string, unknown>;
  return printableField(deviceName, 64) && printableField(deviceId, 1024)
    ? { deviceName, deviceId }
    : null;
};
export const SYNOLOGY_API_SIGNIN_FALLBACK =
  "Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.";
export const SYNOLOGY_OTP_ENROLLMENT_MESSAGE =
  "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.";
export const SYNOLOGY_AUTH_METHOD_LABELS: Record<SynologyAuthMethod, string> = {
  otp: "One-time code",
  secure_signin_approval: "Secure SignIn approval",
  security_key: "Security key",
};
const methodPhrases: Record<SynologyAuthMethod, string> = {
  otp: "a one-time code",
  secure_signin_approval: "Secure SignIn approval",
  security_key: "a security key",
};
const readMethods = (value: unknown) => {
  if (!Array.isArray(value)) return undefined;
  const methods = (
    Object.keys(SYNOLOGY_AUTH_METHOD_LABELS) as SynologyAuthMethod[]
  ).filter((method) => value.includes(method));
  return methods.length ? methods : undefined;
};
const joinPhrases = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : items[0];
/** Only these challenges accept a one-time code in the same sign-in. */
export const acceptsSynologyOtp = (
  challenge: SynologyFileAuthChallenge | null | undefined,
) =>
  challenge?.status === "otp_required" || challenge?.status === "otp_invalid";

/** Rebuilds a native challenge from closed fields; native text is never shown. */
function toChallenge(
  result: SynologyFileAuthChallenge,
): SynologyFileAuthChallenge {
  switch (result.status) {
    case "otp_required": {
      const methods = readMethods(result.methods);
      return {
        status: "otp_required",
        message: methods?.some((method) => method !== "otp")
          ? `Enter the one-time code from your authenticator app or the code shown in Synology Secure SignIn. ${SYNOLOGY_API_SIGNIN_FALLBACK}`
          : "Enter the current one-time code from your authenticator.",
        ...(methods ? { methods } : {}),
        ...(result.trustedDeviceRejected === true
          ? { trustedDeviceRejected: true }
          : {}),
        ...(result.trustedDeviceMismatch === true
          ? { trustedDeviceMismatch: true }
          : {}),
      };
    }
    case "otp_invalid":
      return {
        status: "otp_invalid",
        message: "The one-time code was not accepted. Enter a fresh code.",
      };
    case "otp_enrollment_required":
      return {
        status: "otp_enrollment_required",
        message: SYNOLOGY_OTP_ENROLLMENT_MESSAGE,
      };
    case "unsupported_mfa": {
      const methods = readMethods(result.methods);
      const uses = methods
        ? ` This account uses ${joinPhrases(methods.map((method) => methodPhrases[method]))}.`
        : "";
      return {
        status: "unsupported_mfa",
        message: `DSM requires a sign-in method the NAS API can't complete.${uses} ${SYNOLOGY_API_SIGNIN_FALLBACK}`,
        ...(methods ? { methods } : {}),
      };
    }
  }
}
const challengeStatuses: readonly string[] = [
  "otp_required",
  "otp_invalid",
  "otp_enrollment_required",
  "unsupported_mfa",
] satisfies SynologyFileAuthChallenge["status"][];
const sessionProfiles: readonly string[] = [
  "file_station",
  "dsm_desktop",
] satisfies SynologySessionProfile[];
type PendingLogin = SynologyFileLogin & {
  sessionProfile?: SynologySessionProfile;
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
  const [challenge, setChallenge] = useState<SynologyFileAuthChallenge | null>(
    null,
  );
  const trustDefault = !!options.deviceTrust && options.trustDevice === true;
  const [trustChoice, setTrustChoice] = useState(trustDefault);
  const [trustNotice, setTrustNotice] = useState<string | null>(null);
  /** A saved device is known for the last signed-in account. Never the device itself. */
  const [trustRemembered, setTrustRemembered] = useState(false);
  const [trustForgetting, setTrustForgetting] = useState(false);
  const current = useRef({
    isOpen,
    assertCurrent: options.assertCurrent,
    resolveCredentials: options.resolveCredentials,
    resolveOtp: options.resolveOtp,
    deviceTrust: options.deviceTrust,
    trustDefault,
  });
  current.current = {
    isOpen,
    assertCurrent: options.assertCurrent,
    resolveCredentials: options.resolveCredentials,
    resolveOtp: options.resolveOtp,
    deviceTrust: options.deviceTrust,
    trustDefault,
  };
  /** The checkbox value read by the code-bearing sign-in; mirrors `trustChoice`. */
  const trustChoiceRef = useRef(trustDefault);
  /** DSM account of the last sign-in that used this adapter (not a secret). */
  const trustAccount = useRef<string | null>(null);
  /** A vault write advances the vault revision, so sign-ins wait for it. */
  const trustWrite = useRef<Promise<void> | null>(null);
  const alive = useRef(true),
    generation = useRef(0),
    busy = useRef(false);
  const receipt = useRef<string | null>(null);
  const pendingRequest = useRef<string | null>(null);
  const pendingCredentials = useRef<PendingLogin | null>(null);
  /** Profile for the next user-initiated sign-in only; consumed by that attempt. */
  const requestedProfile = useRef<SynologySessionProfile | null>(null);
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
  /**
   * One trusted-device vault write, after any earlier one. It is bound to this
   * mounted session and its owner, not to a sign-in attempt, and never throws.
   */
  const runTrustWrite = (
    write: (
      adapter: SynologyDeviceTrustAdapter,
      assertCurrent: () => void,
    ) => Promise<SynologyDeviceTrustWrite>,
    fallback: string,
    settled: (outcome: SynologyDeviceTrustWrite) => void,
  ) => {
    const { deviceTrust: adapter, assertCurrent: access } = current.current;
    if (!adapter) return;
    const assertCurrent = () => {
      if (
        !alive.current ||
        !current.current.isOpen ||
        current.current.deviceTrust !== adapter ||
        current.current.assertCurrent !== access
      )
        throw new Error("This trusted-device update was cancelled.");
      access?.();
    };
    const previous = trustWrite.current;
    const task = (async () => {
      await previous;
      let outcome: SynologyDeviceTrustWrite;
      try {
        assertCurrent();
        outcome = await write(adapter, assertCurrent);
        if (
          !outcome ||
          !["saved", "unchanged", "not-saved"].includes(outcome.status)
        )
          throw new Error();
        if (outcome.status === "not-saved")
          outcome = {
            status: "not-saved",
            message:
              typeof outcome.message === "string" && outcome.message
                ? outcome.message
                : fallback,
          };
      } catch {
        outcome = { status: "not-saved", message: fallback };
      }
      if (alive.current) settled(outcome);
    })();
    trustWrite.current = task;
    void task.then(() => {
      if (trustWrite.current === task) trustWrite.current = null;
    });
  };
  const appendTrustNotice = (message: string) =>
    setTrustNotice((previous) =>
      previous && previous !== message ? `${previous} ${message}` : message,
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
    requestedProfile.current = null;
    activeRoute.current = null;
    trustChoiceRef.current = current.current.trustDefault;
    if (alive.current) {
      setPassword("");
      setOtpCode("");
      setTrustChoice(current.current.trustDefault);
      setTrustNotice(null);
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

  const attempt = async (input: PendingLogin, otp?: string) => {
    const { sessionProfile, ...config } = input;
    // Old binaries and plain sign-ins keep the payload without this key.
    const profileArgs = sessionProfile ? { sessionProfile } : {};
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
    const deviceTrust = current.current.deviceTrust;
    let credentialGuard: (() => void) | undefined;
    // Attempt-local; never React state. `device` is offered only without a code.
    let device: SynologyTrustedDevice | null = null;
    let issued: SynologyTrustedDevice | null = null;
    let staleTrust: "rejected" | "mismatch" | null = null;
    let enrolled = false;
    let followUp: (() => void) | null = null;
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
        current.current.resolveOtp !== resolveOtp ||
        current.current.deviceTrust !== deviceTrust
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
      if (trustWrite.current) {
        // A pending write would advance the vault revision under this attempt.
        await trustWrite.current;
        assertAttempt();
      }
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
      const account = config.username;
      if (deviceTrust && !otp) {
        try {
          device = readTrustedDevice(
            await deviceTrust.resolve(assertAttempt, account),
          );
        } catch {
          // An unreadable saved device only means DSM asks for a code as usual.
          device = null;
        }
        assertAttempt();
      }
      // Only a code-bearing sign-in can ask DSM to trust this device.
      const trustArgs = (code?: string) => {
        if (code) {
          enrolled = !!deviceTrust && trustChoiceRef.current;
          return enrolled ? { trustDevice: true } : {};
        }
        return device
          ? { deviceId: device.deviceId, deviceName: device.deviceName }
          : {};
      };
      let result = await invoke<SynologyFileAuthResult>("syn_fs_connect", {
        ...config,
        instanceId,
        requestId,
        otpCode: otp || null,
        route: routeSnapshot.route,
        ...profileArgs,
        ...trustArgs(otp),
      });
      await checkReturnedRoute(result);
      if (device && result?.status === "otp_required")
        staleTrust =
          result.trustedDeviceMismatch === true
            ? "mismatch"
            : result.trustedDeviceRejected === true
              ? "rejected"
              : null;
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
          ...profileArgs,
          ...trustArgs(otp),
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
        // Only a device DSM issued for this opted-in sign-in is remembered.
        issued = enrolled ? readTrustedDevice(result.trustedDevice) : null;
        receipt.current = result.sessionId;
        setSessionId(result.sessionId);
        pendingCredentials.current = null;
        setPassword("");
        setChallenge(null);
        setConnectionStatus("connected");
        if (deviceTrust) {
          trustAccount.current = account;
          const reused = !!device && !staleTrust;
          const trusted = issued;
          const stale = staleTrust;
          setTrustRemembered(reused);
          setTrustNotice(
            stale
              ? staleTrustAfterSignIn[stale]
              : enrolled && !trusted
                ? SYNOLOGY_TRUSTED_DEVICE_NOT_ISSUED
                : null,
          );
          // Storing replaces an older device for this NAS account, so no forget.
          if (trusted)
            followUp = () =>
              runTrustWrite(
                (adapter, guard) => adapter.store(guard, account, trusted),
                trustNotRemembered,
                (outcome) => {
                  if (outcome.status === "not-saved")
                    appendTrustNotice(outcome.message);
                  else {
                    setTrustRemembered(true);
                    appendTrustNotice(SYNOLOGY_TRUSTED_DEVICE_SAVED);
                  }
                },
              );
          else if (stale) followUp = () => forgetStale(account);
        }
      } else if (challengeStatuses.includes(result.status)) {
        const next = toChallenge(result);
        setChallenge(next);
        setPassword("");
        // Enrollment and unsupported methods end this sign-in: no code can follow.
        if (!acceptsSynologyOtp(next)) pendingCredentials.current = null;
        setConnectionStatus("disconnected");
        if (deviceTrust && staleTrust) {
          const stale = staleTrust;
          trustAccount.current = account;
          setTrustRemembered(false);
          setTrustNotice(
            !acceptsSynologyOtp(next)
              ? staleTrustAfterSignIn[stale]
              : stale === "mismatch"
                ? SYNOLOGY_TRUSTED_DEVICE_MISMATCH
                : SYNOLOGY_TRUSTED_DEVICE_REJECTED,
          );
          followUp = () => forgetStale(account);
        }
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
            device?.deviceId,
            issued?.deviceId,
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
        if (deviceTrust && staleTrust) {
          const account = config.username;
          setTrustRemembered(false);
          followUp = () => forgetStale(account);
        }
      }
    } finally {
      if (resolveCredentials) config.password = "";
      otp = undefined;
      device = null;
      issued = null;
      if (pendingRequest.current === requestId) pendingRequest.current = null;
      if (generation.current === captured) busy.current = false;
    }
    // Vault writes start only once this attempt has settled: they advance the
    // vault revision that the attempt's credential guard is bound to.
    followUp?.();
  };
  /** DSM refused the saved device, or it belongs to another computer. */
  const forgetStale = (account: string) =>
    runTrustWrite(
      (adapter, guard) => adapter.forget(guard, account),
      trustNotForgotten,
      (outcome) => {
        if (outcome.status === "not-saved") {
          setTrustRemembered(true);
          appendTrustNotice(outcome.message);
        }
      },
    );
  const handlerGeneration = generation.current;
  const startConnect = async () => {
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
      setConnectionStatus("error");
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
          : requestedProfile.current
            ? "Enter the NAS host, valid port, username, and password to reconnect. The password is not kept after sign-in."
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
    const sessionProfile = requestedProfile.current;
    requestedProfile.current = null;
    const config: PendingLogin = {
      ...endpoint,
      username: login.username,
      password: login.password,
      ...(sessionProfile ? { sessionProfile } : {}),
    };
    // A code submitted for this challenge reuses the same profile.
    pendingCredentials.current = config;
    // Each new sign-in starts from the saved trust preference.
    trustChoiceRef.current = current.current.trustDefault;
    setTrustChoice(current.current.trustDefault);
    setTrustNotice(null);
    await attempt(config);
  };
  const connect = async () => {
    if (generation.current !== handlerGeneration) return;
    if (busy.current || challenge || receipt.current) return;
    await startConnect();
  };
  /**
   * User-initiated only: releases the current receipt, then makes one normal
   * sign-in. A vault authenticator is still tried at most once and a code prompt
   * still appears; nothing is retried automatically.
   */
  const reconnect = async (
    reconnectOptions: { sessionProfile?: SynologySessionProfile } = {},
  ) => {
    if (generation.current !== handlerGeneration) return;
    if (busy.current || challenge) return;
    const { sessionProfile } = reconnectOptions;
    if (
      sessionProfile !== undefined &&
      !sessionProfiles.includes(sessionProfile)
    )
      return;
    const released = disconnect();
    // disconnect() resets synchronously, so this is the reconnect's generation.
    const captured = generation.current;
    busy.current = true;
    setConnectionStatus("connecting");
    try {
      await released;
    } catch {
      // disconnect() already reported the cleanup failure; never sign in over it.
      if (generation.current === captured) busy.current = false;
      return;
    }
    if (
      generation.current !== captured ||
      receipt.current ||
      !alive.current ||
      !current.current.isOpen
    )
      return;
    busy.current = false;
    requestedProfile.current = sessionProfile ?? null;
    await startConnect();
  };
  const submitOtp = async () => {
    if (generation.current !== handlerGeneration) return;
    const config = pendingCredentials.current;
    if (
      !config ||
      !acceptsSynologyOtp(challenge) ||
      !/^[0-9]{6,8}$/.test(otpCode.trim())
    )
      return;
    await attempt(config, otpCode.trim());
  };
  /** The checkbox for the pending code; ignored without vault storage. */
  const setTrustDevice = (enabled: boolean) => {
    if (!current.current.deviceTrust) return;
    trustChoiceRef.current = enabled;
    setTrustChoice(enabled);
  };
  /** Removes this NAS account's saved device from the vault; the session stays. */
  const forgetTrustedDevice = async () => {
    const account = trustAccount.current;
    // A write during a sign-in would cancel it by advancing the vault revision.
    if (
      !current.current.deviceTrust ||
      !account ||
      trustForgetting ||
      busy.current
    )
      return;
    setTrustForgetting(true);
    runTrustWrite(
      (adapter, guard) => adapter.forget(guard, account),
      trustNotForgotten,
      (outcome) => {
        setTrustForgetting(false);
        if (outcome.status === "not-saved") setTrustNotice(outcome.message);
        else {
          setTrustRemembered(false);
          setTrustNotice(SYNOLOGY_TRUSTED_DEVICE_FORGOTTEN);
        }
      },
    );
    await trustWrite.current;
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
    reconnect,
    submitOtp,
    notifySessionExpired,
    cancelChallenge: reset,
    /** Trusted-device state only; the device token never leaves the attempt. */
    deviceTrust: {
      available: !!options.deviceTrust,
      unavailableReason: options.deviceTrust
        ? null
        : (options.deviceTrustUnavailable ?? null),
      enabled: trustChoice,
      setEnabled: setTrustDevice,
      remembered: trustRemembered,
      notice: trustNotice,
      dismissNotice: () => setTrustNotice(null),
      forgetting: trustForgetting,
      forget: forgetTrustedDevice,
    },
  };
}
