import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeManagement as invoke,
  toSafeManagementError,
} from "../../utils/security/managementInvoke";
import type {
  SynologyFileAuthResult,
  SynologyFileLogin,
} from "../../types/hardware/synologyFileStation";

export interface SynologyFileConnectionOptions {
  /** One identity for this mounted tab; never a connection id shared by tabs. */
  instanceId?: string;
  initialConfig?: SynologyFileLogin;
  assertCurrent?: () => void;
}
const challengeMessages = {
  otp_required: "Enter the current one-time code from your authenticator.",
  otp_invalid: "The one-time code was not accepted. Enter a fresh code.",
  unsupported_mfa:
    "This authentication method requires the DSM website. Browser sign-in does not authorize the native API.",
};

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
  const [challenge, setChallenge] = useState<Exclude<
    SynologyFileAuthResult,
    { status: "connected" }
  > | null>(null);
  const current = useRef({ isOpen, assertCurrent: options.assertCurrent });
  current.current = { isOpen, assertCurrent: options.assertCurrent };
  const alive = useRef(true),
    generation = useRef(0),
    busy = useRef(false);
  const receipt = useRef<string | null>(null);
  const pendingRequest = useRef<string | null>(null);
  const pendingCredentials = useRef<SynologyFileLogin | null>(null);
  const assertSessionAccess = useCallback(() => {
    if (!alive.current || !current.current.isOpen)
      throw new Error("This NAS session is unavailable.");
    current.current.assertCurrent?.();
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
    if (alive.current) {
      setPassword("");
      setOtpCode("");
      setChallenge(null);
      setConnectionStatus("disconnected");
      setConnectionError(null);
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
      const id = receipt.current;
      receipt.current = null;
      if (id) void release(id).catch(() => undefined);
    };
  }, [cancelPending, release]);
  useEffect(() => {
    if (!isOpen) void disconnect().catch(() => undefined);
  }, [isOpen, disconnect]);

  const attempt = async (config: SynologyFileLogin, otp?: string) => {
    if (
      busy.current ||
      receipt.current ||
      !current.current.isOpen ||
      !alive.current
    )
      return;
    const access = current.current.assertCurrent;
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
    const captured = ++generation.current,
      requestId = crypto.randomUUID();
    pendingRequest.current = requestId;
    const valid = () => {
      if (
        !alive.current ||
        !current.current.isOpen ||
        generation.current !== captured ||
        current.current.assertCurrent !== access
      )
        return false;
      try {
        access?.();
        return true;
      } catch {
        return false;
      }
    };
    setConnectionError(null);
    setConnectionStatus("connecting");
    setOtpCode("");
    try {
      const result = await invoke<SynologyFileAuthResult>("syn_fs_connect", {
        ...config,
        instanceId,
        requestId,
        otpCode: otp || null,
      });
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
        let safe = toSafeManagementError(error);
        for (const secret of [config.password, otp])
          if (secret) safe = safe.split(secret).join("[REDACTED]");
        setConnectionError(safe);
        setConnectionStatus("error");
        pendingCredentials.current = null;
        setChallenge(null);
        setPassword("");
      }
    } finally {
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
    if (
      !host.trim() ||
      !username.trim() ||
      !password ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      setConnectionError(
        "Enter the NAS host, valid port, username, and password.",
      );
      return;
    }
    const config = { host: host.trim(), port, username, password, useHttps };
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
  const notifySessionExpired = (expectedSessionId: string) => {
    if (receipt.current !== expectedSessionId) return;
    receipt.current = null;
    reset();
    setSessionId(null);
    setConnectionError(
      "The NAS session expired. Sign in again; no file operation was retried.",
    );
  };
  return {
    instanceId,
    targetLocked: initialTarget.current !== null,
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
    challenge,
    connect,
    disconnect,
    submitOtp,
    notifySessionExpired,
    cancelChallenge: reset,
  };
}
