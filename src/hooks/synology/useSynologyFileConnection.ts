import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  SynologyFileAuthResult,
  SynologyFileLogin,
} from "../../types/hardware/synologyFileStation";

const explain = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "The NAS request failed.";
export function useSynologyFileConnection(isOpen: boolean) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(5001);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useHttps, setUseHttps] = useState(true);
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
  const current = useRef({ isOpen });
  current.current = { isOpen };
  const alive = useRef(true),
    generation = useRef(0),
    busy = useRef(false);
  const receipt = useRef<string | null>(null);
  const pendingCredentials = useRef<SynologyFileLogin | null>(null);
  const release = async (id: string) => {
    try {
      await invoke("syn_fs_disconnect", { expectedSessionId: id });
    } catch {
      /* Never use the unscoped disconnect as a fallback. */
    }
  };
  const reset = useCallback(() => {
    generation.current++;
    busy.current = false;
    pendingCredentials.current = null;
    if (alive.current) {
      setPassword("");
      setOtpCode("");
      setChallenge(null);
      setConnectionStatus("disconnected");
      setConnectionError(null);
    }
  }, []);
  const disconnect = useCallback(async () => {
    const id = receipt.current;
    receipt.current = null;
    reset();
    if (alive.current) setSessionId(null);
    if (id) await release(id);
  }, [reset]);
  useEffect(() => {
    alive.current = true;
    const attempts = generation;
    return () => {
      alive.current = false;
      attempts.current++;
      pendingCredentials.current = null;
      const id = receipt.current;
      receipt.current = null;
      if (id) void release(id);
    };
  }, []);
  useEffect(() => {
    if (!isOpen) void disconnect();
  }, [isOpen, disconnect]);
  const attempt = async (config: SynologyFileLogin, otp?: string) => {
    if (busy.current || !current.current.isOpen) return;
    busy.current = true;
    const captured = ++generation.current;
    setConnectionError(null);
    setConnectionStatus("connecting");
    setOtpCode("");
    try {
      const result = await invoke<SynologyFileAuthResult>("syn_fs_connect", {
        ...config,
        otpCode: otp || null,
      });
      if (
        !alive.current ||
        !current.current.isOpen ||
        generation.current !== captured
      ) {
        if (result.status === "connected") await release(result.sessionId);
        return;
      }
      if (result.status === "connected") {
        if (typeof result.sessionId !== "string" || !result.sessionId)
          throw new Error(
            "The NAS did not return a scoped File Station session.",
          );
        receipt.current = result.sessionId;
        setSessionId(result.sessionId);
        pendingCredentials.current = null;
        setPassword("");
        setChallenge(null);
        setConnectionStatus("connected");
      } else if (
        ["otp_required", "otp_invalid", "unsupported_mfa"].includes(
          result.status,
        )
      ) {
        setChallenge(result);
        setPassword("");
        if (result.status === "unsupported_mfa")
          pendingCredentials.current = null;
        setConnectionStatus("disconnected");
      } else
        throw new Error(
          "The NAS returned an unsupported authentication result.",
        );
    } catch (error) {
      if (alive.current && generation.current === captured) {
        setConnectionError(explain(error));
        setConnectionStatus("error");
        if (!otp) pendingCredentials.current = null;
      }
    } finally {
      if (generation.current === captured) busy.current = false;
    }
  };
  const connect = async () => {
    if (busy.current || challenge) return;
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
  return {
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
    cancelChallenge: reset,
  };
}
