import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import type {
  OpksshBinaryStatus,
  OpksshLoginOptions,
  OpksshLoginOperation,
  OpksshLoginResult,
  OpksshKey,
  OpksshClientConfig,
  ServerOpksshConfig,
  CustomProvider,
  AuditResult,
  OpksshStatus,
  OpksshTab,
  AuthIdEntry,
  ProviderEntry,
  ExpirationPolicy,
  OpksshRuntimeStatus,
  ServerInstallOptions,
} from "../../types/security/opkssh";

// ─── Tauri runtime check ───────────────────────────────────────────

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

function fallbackLoginResult(
  operation: Pick<OpksshLoginOperation, "provider" | "message">,
): OpksshLoginResult {
  return {
    success: false,
    keyPath: null,
    identity: null,
    provider: operation.provider,
    expiresAt: null,
    message: operation.message || "Login failed.",
    rawOutput: "",
  };
}

const DEFAULT_LOGIN_POLL_INTERVAL_MS = 1000;
const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 90_000;

interface UseOpksshOptions {
  loginPollIntervalMs?: number;
  loginWaitTimeoutMs?: number;
}

type OpksshCliRetirementDecision =
  | "retain-cli-fallback"
  | "defer-until-evidence"
  | "blocked-no-runtime";

interface OpksshRolloutSignal {
  preferredMode: OpksshRuntimeStatus["mode"];
  activeBackend: OpksshRuntimeStatus["activeBackend"];
  usingFallback: boolean;
  fallbackReason: string | null;
  cliRetirementDecision: OpksshCliRetirementDecision;
  cliRetirementMessage: string;
}

function isTerminalLoginOperation(operation: OpksshLoginOperation): boolean {
  return operation.status !== "running";
}

function buildRunningLoginNotice(operation: OpksshLoginOperation): string {
  if (operation.browserUrl) {
    return "Continue the system-browser sign-in flow while OPKSSH waits for the provider-owned callback listener to finish.";
  }

  return "OPKSSH owns browser launch and callback listening in this slice. If the system browser did not open, the app cannot detect that failure directly; retry, refresh the snapshot, or cancel the local wait.";
}

function buildLoginTimeoutNotice(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `The app stopped actively waiting after ${seconds}s. OPKSSH may still be waiting on the system browser or provider-owned callback. Keep waiting, refresh the snapshot, or cancel the local wait.`;
}

function buildBackgroundLoginNotice(): string {
  return "An OPKSSH login is still running in the background. Reopen the panel to refresh, keep waiting, or cancel the local wait.";
}

function deriveFallbackReason(runtime: OpksshRuntimeStatus): string | null {
  if (runtime.activeBackend !== "cli") {
    return null;
  }

  if (runtime.mode === "cli") {
    return "CLI mode is explicitly selected for the current release-cycle fallback seam.";
  }

  if (runtime.mode === "library") {
    return (
      runtime.library.message
      || runtime.message
      || "Library mode was requested, but the wrapped in-process backend is not available so CLI fallback remained active."
    );
  }

  return (
    runtime.message
    || runtime.library.message
    || "Auto mode kept the CLI fallback because the wrapped in-process backend is not available in this build."
  );
}

function deriveRolloutSignal(
  runtime: OpksshRuntimeStatus | null,
): OpksshRolloutSignal | null {
  if (!runtime) {
    return null;
  }

  const fallbackReason = deriveFallbackReason(runtime);

  if (!runtime.activeBackend) {
    return {
      preferredMode: runtime.mode,
      activeBackend: runtime.activeBackend,
      usingFallback: runtime.usingFallback,
      fallbackReason,
      cliRetirementDecision: "blocked-no-runtime",
      cliRetirementMessage:
        "CLI retirement is blocked: this build cannot prove a working wrapped OPKSSH runtime yet.",
    };
  }

  if (runtime.activeBackend === "cli") {
    return {
      preferredMode: runtime.mode,
      activeBackend: runtime.activeBackend,
      usingFallback: runtime.usingFallback,
      fallbackReason,
      cliRetirementDecision: "retain-cli-fallback",
      cliRetirementMessage: runtime.mode === "cli"
        ? "CLI retirement is deferred: this build is still running in explicit CLI mode for the current rollout seam."
        : "CLI retirement is deferred: the wrapped contract is still running on CLI fallback, so keep it visible for at least one release cycle.",
    };
  }

  return {
    preferredMode: runtime.mode,
    activeBackend: runtime.activeBackend,
    usingFallback: runtime.usingFallback,
    fallbackReason,
    cliRetirementDecision: "defer-until-evidence",
    cliRetirementMessage:
      "CLI retirement is still deferred: this seam can prove runtime selection, but it does not yet encode bundle/install evidence for removing fallback.",
  };
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useOpkssh(
  isOpen: boolean,
  options: UseOpksshOptions = {},
) {
  const { state } = useConnections();
  const loginPollIntervalMs = options.loginPollIntervalMs ?? DEFAULT_LOGIN_POLL_INTERVAL_MS;
  const loginWaitTimeoutMs = options.loginWaitTimeoutMs ?? DEFAULT_LOGIN_WAIT_TIMEOUT_MS;

  // ── SSH sessions for server-side operations ────────────
  const sshSessions = useMemo(
    () =>
      state.sessions.filter(
        (s) =>
          s.protocol === "ssh" &&
          (s.status === "connected" || s.status === "connecting"),
      ),
    [state.sessions],
  );

  // ── State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<OpksshTab>("overview");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Binary / status
  const [binaryStatus, setBinaryStatus] = useState<OpksshBinaryStatus | null>(null);
  const [overallStatus, setOverallStatus] = useState<OpksshStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<OpksshRuntimeStatus | null>(null);

  // Login
  const [loginOptions, setLoginOptions] = useState<OpksshLoginOptions>({});
  const [lastLoginResult, setLastLoginResult] = useState<OpksshLoginResult | null>(null);
  const [loginOperation, setLoginOperation] = useState<OpksshLoginOperation | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginPhase, setLoginPhase] = useState<
    "idle" | "starting" | "waiting" | "timedOut" | "cancelling"
  >("idle");
  const [loginWaitTimedOut, setLoginWaitTimedOut] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [loginElapsedMs, setLoginElapsedMs] = useState(0);
  const loginFlowRef = useRef(0);
  const wasOpenRef = useRef(isOpen);

  // Keys
  const [activeKeys, setActiveKeys] = useState<OpksshKey[]>([]);

  // Client config (local ~/.opk)
  const [clientConfig, setClientConfig] = useState<OpksshClientConfig | null>(null);

  // Server config (per SSH session)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [serverConfigs, setServerConfigs] = useState<Record<string, ServerOpksshConfig>>({});
  const [isLoadingServer, setIsLoadingServer] = useState(false);

  // Audit
  const [auditResults, setAuditResults] = useState<Record<string, AuditResult>>({});
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  // Well-known providers cache
  const [wellKnownProviders, setWellKnownProviders] = useState<CustomProvider[]>([]);

  const rolloutSignal = useMemo(
    () => deriveRolloutSignal(runtimeStatus ?? overallStatus?.runtime ?? null),
    [runtimeStatus, overallStatus?.runtime],
  );

  // ── Auto-select first session ──────────────────────────
  useEffect(() => {
    if (isOpen && !selectedSessionId && sshSessions.length > 0) {
      setSelectedSessionId(sshSessions[0].id);
    }
  }, [isOpen, selectedSessionId, sshSessions]);

  // ── Binary check ───────────────────────────────────────
  const checkBinary = useCallback(async () => {
    if (!isTauri()) {
      setError("opkssh requires the Tauri runtime.");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const status = await invoke<OpksshBinaryStatus>("opkssh_check_binary");
      setBinaryStatus(status);
      setRuntimeStatus((current) =>
        current
          ? {
              ...current,
              cli: status,
            }
          : current,
      );
    } catch (err: any) {
      setError(`Binary check failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Get overall status ─────────────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setIsLoading(true);
      setError(null);
      const status = await invoke<OpksshStatus>("opkssh_get_status");
      setOverallStatus(status);
      setRuntimeStatus(status.runtime);
      setBinaryStatus(status.runtime?.cli ?? status.binary);
      setActiveKeys(status.activeKeys);
      setClientConfig(status.clientConfig ?? null);
    } catch (err: any) {
      setError(`Status refresh failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Key management ─────────────────────────────────────
  const refreshKeys = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const keys = await invoke<OpksshKey[]>("opkssh_list_keys");
      setActiveKeys(keys);
    } catch (err: any) {
      setError(`Failed to list keys: ${err?.message || err}`);
    }
  }, []);

  const removeKey = useCallback(
    async (keyRef: string) => {
      if (!isTauri()) return false;
      try {
        setError(null);
        const keyPath = activeKeys.find((key) => key.id === keyRef)?.path || keyRef;
        await invoke<void>("opkssh_remove_key", { keyPath });
        await refreshKeys();
        return true;
      } catch (err: any) {
        setError(`Failed to remove key: ${err?.message || err}`);
        return false;
      }
    },
    [activeKeys, refreshKeys],
  );

  const applyLoginOperationSnapshot = useCallback((operation: OpksshLoginOperation) => {
    setLoginOperation(operation);
    setRuntimeStatus(operation.runtime);
    setBinaryStatus(operation.runtime.cli);
  }, []);

  const finalizeLoginOperation = useCallback(
    async (operation: OpksshLoginOperation) => {
      applyLoginOperationSnapshot(operation);
      setLoginWaitTimedOut(false);
      setLoginPhase("idle");
      setIsLoggingIn(false);

      if (operation.status === "cancelled") {
        setLastLoginResult(null);
        setError(null);
        setLoginNotice(
          operation.message
            || "Login wait cancelled locally. Browser/provider activity may still continue until OPKSSH stops on its own.",
        );
        return null;
      }

      const result = operation.result ?? fallbackLoginResult(operation);
      setLastLoginResult(result);

      if (result.success && operation.status === "succeeded") {
        setLoginNotice(null);
        setError(null);
        await refreshKeys();
        return result;
      }

      setLoginNotice(operation.message ?? result.message);
      setError(result.message);
      return result;
    },
    [applyLoginOperationSnapshot, refreshKeys],
  );

  const waitForLoginOperation = useCallback(
    async (operationId: string, flowId: number, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;

      while (loginFlowRef.current === flowId) {
        const operation = await invoke<OpksshLoginOperation | null>(
          "opkssh_get_login_operation",
          { operationId },
        );

        if (loginFlowRef.current !== flowId) {
          return null;
        }

        if (!operation) {
          setIsLoggingIn(false);
          setLoginPhase("idle");
          setLoginWaitTimedOut(false);
          setLoginOperation(null);
          setError("The current OPKSSH login operation is no longer available.");
          setLoginNotice(
            "The app lost track of the running OPKSSH login operation. Start a new login attempt if needed.",
          );
          return null;
        }

        applyLoginOperationSnapshot(operation);

        if (operation.startedAt) {
          setLoginElapsedMs(Math.max(0, Date.now() - Date.parse(operation.startedAt)));
        }

        if (isTerminalLoginOperation(operation)) {
          return operation;
        }

        setLoginPhase("waiting");
        setLoginNotice(buildRunningLoginNotice(operation));

        if (Date.now() >= deadline) {
          setLoginWaitTimedOut(true);
          setLoginPhase("timedOut");
          setLoginNotice(buildLoginTimeoutNotice(timeoutMs));
          return null;
        }

        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, loginPollIntervalMs);
        });
      }

      return null;
    },
    [applyLoginOperationSnapshot, loginPollIntervalMs],
  );

  // ── Login via OIDC ─────────────────────────────────────
  const login = useCallback(
    async (opts?: OpksshLoginOptions) => {
      if (!isTauri()) {
        setError("opkssh login requires the Tauri runtime.");
        return null;
      }
      const options = opts || loginOptions;
      const flowId = loginFlowRef.current + 1;
      loginFlowRef.current = flowId;

      try {
        setIsLoggingIn(true);
        setLoginPhase("starting");
        setLoginWaitTimedOut(false);
        setLoginElapsedMs(0);
        setLoginNotice(null);
        setError(null);
        setLastLoginResult(null);

        const operation = await invoke<OpksshLoginOperation>("opkssh_start_login", {
          options,
        });

        if (loginFlowRef.current !== flowId) {
          return null;
        }

        applyLoginOperationSnapshot(operation);

        if (isTerminalLoginOperation(operation)) {
          return await finalizeLoginOperation(operation);
        }

        setLoginPhase("waiting");
        setLoginNotice(buildRunningLoginNotice(operation));

        const completed = await waitForLoginOperation(
          operation.id,
          flowId,
          loginWaitTimeoutMs,
        );

        if (!completed) {
          return null;
        }

        return await finalizeLoginOperation(completed);
      } catch (err: any) {
        const msg = `Login failed: ${err?.message || err}`;
        setError(msg);
        setLoginNotice(msg);
        setLastLoginResult({
          success: false,
          keyPath: null,
          identity: null,
          provider: options.provider ?? null,
          expiresAt: null,
          message: msg,
          rawOutput: "",
        });
        setLoginWaitTimedOut(false);
        setLoginPhase("idle");
        setIsLoggingIn(false);
        return null;
      }
    },
    [
      applyLoginOperationSnapshot,
      finalizeLoginOperation,
      loginOptions,
      loginWaitTimeoutMs,
      waitForLoginOperation,
    ],
  );

  const refreshLoginOperation = useCallback(
    async (operationId?: string) => {
      if (!isTauri()) return null;
      const targetId = operationId || loginOperation?.id;
      if (!targetId) return null;
      try {
        setError(null);
        const operation = await invoke<OpksshLoginOperation | null>(
          "opkssh_get_login_operation",
          { operationId: targetId },
        );
        if (operation) {
          if (isTerminalLoginOperation(operation)) {
            await finalizeLoginOperation(operation);
          } else {
            applyLoginOperationSnapshot(operation);
            setIsLoggingIn(true);
            setLoginPhase(loginWaitTimedOut ? "timedOut" : "waiting");
            setLoginNotice(
              loginWaitTimedOut
                ? buildLoginTimeoutNotice(loginWaitTimeoutMs)
                : buildRunningLoginNotice(operation),
            );
          }
        } else {
          setLoginOperation(null);
          setIsLoggingIn(false);
          setLoginPhase("idle");
        }
        return operation;
      } catch (err: any) {
        setError(`Failed to refresh login operation: ${err?.message || err}`);
        return null;
      }
    },
    [
      applyLoginOperationSnapshot,
      finalizeLoginOperation,
      loginOperation?.id,
      loginWaitTimedOut,
      loginWaitTimeoutMs,
    ],
  );

  const cancelLogin = useCallback(
    async (operationId?: string) => {
      if (!isTauri()) return null;
      const targetId = operationId || loginOperation?.id;
      if (!targetId) return null;
      loginFlowRef.current += 1;
      try {
        setError(null);
        setLoginPhase("cancelling");
        setLoginNotice(
          "Cancelling the local wait. Browser/provider activity may still continue until OPKSSH stops on its own.",
        );
        const operation = await invoke<OpksshLoginOperation>("opkssh_cancel_login", {
          operationId: targetId,
        });
        await finalizeLoginOperation(operation);
        return operation;
      } catch (err: any) {
        setError(`Failed to cancel login: ${err?.message || err}`);
        setLoginNotice(`Failed to cancel login: ${err?.message || err}`);
        setLoginPhase("idle");
        setIsLoggingIn(false);
        return null;
      }
    },
    [finalizeLoginOperation, loginOperation?.id],
  );

  const continueLoginWait = useCallback(
    async (operationId?: string) => {
      if (!isTauri()) return null;
      const targetId = operationId || loginOperation?.id;
      if (!targetId) return null;

      const flowId = loginFlowRef.current + 1;
      loginFlowRef.current = flowId;

      try {
        setError(null);
        setIsLoggingIn(true);
        setLoginWaitTimedOut(false);
        setLoginPhase("waiting");

        const operation =
          operationId || !loginOperation
            ? await invoke<OpksshLoginOperation | null>("opkssh_get_login_operation", {
                operationId: targetId,
              })
            : loginOperation;

        if (!operation) {
          setIsLoggingIn(false);
          setLoginPhase("idle");
          setLoginNotice(
            "The current OPKSSH login operation is no longer available. Start a new login attempt if needed.",
          );
          return null;
        }

        if (isTerminalLoginOperation(operation)) {
          return await finalizeLoginOperation(operation);
        }

        applyLoginOperationSnapshot(operation);
        setLoginNotice(buildRunningLoginNotice(operation));

        const completed = await waitForLoginOperation(
          targetId,
          flowId,
          loginWaitTimeoutMs,
        );

        if (!completed) {
          return null;
        }

        return await finalizeLoginOperation(completed);
      } catch (err: any) {
        const msg = `Failed to keep waiting for login: ${err?.message || err}`;
        setError(msg);
        setLoginNotice(msg);
        setLoginPhase("idle");
        setIsLoggingIn(false);
        return null;
      }
    },
    [
      applyLoginOperationSnapshot,
      finalizeLoginOperation,
      loginOperation,
      loginWaitTimeoutMs,
      waitForLoginOperation,
    ],
  );

  // ── Client config ──────────────────────────────────────
  const refreshClientConfig = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const config = await invoke<OpksshClientConfig>("opkssh_get_client_config");
      setClientConfig(config);
    } catch (err: any) {
      setError(`Failed to read client config: ${err?.message || err}`);
    }
  }, []);

  const updateClientConfig = useCallback(
    async (config: OpksshClientConfig) => {
      if (!isTauri()) return false;
      try {
        setError(null);
        await invoke<void>("opkssh_update_client_config", { config });
        setClientConfig(config);
        return true;
      } catch (err: any) {
        setError(`Failed to update config: ${err?.message || err}`);
        return false;
      }
    },
    [],
  );

  const buildEnvString = useCallback(async (): Promise<string | null> => {
    if (!isTauri()) return null;
    try {
      return await invoke<string>("opkssh_build_env_string");
    } catch (err: any) {
      setError(`Failed to build env string: ${err?.message || err}`);
      return null;
    }
  }, []);

  // ── Well-known providers ───────────────────────────────
  const refreshWellKnownProviders = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const providers = await invoke<CustomProvider[]>("opkssh_well_known_providers");
      setWellKnownProviders(providers);
    } catch (err: any) {
      setError(`Failed to fetch providers: ${err?.message || err}`);
    }
  }, []);

  // ── Server config (over SSH) ───────────────────────────
  const getBackendSessionId = useCallback(
    (sessionId: string): string | null => {
      const session = sshSessions.find((s) => s.id === sessionId);
      return session?.backendSessionId || null;
    },
    [sshSessions],
  );

  const refreshServerConfig = useCallback(
    async (sessionId: string) => {
      if (!isTauri()) return;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) {
        setError("SSH session not found or not fully connected.");
        return;
      }
      try {
        setIsLoadingServer(true);
        setError(null);

        // Get the script to read server config
        const script = await invoke<string>("opkssh_server_read_config_script");

        // Execute the script on the remote server
        const output = await invoke<string>("execute_command", {
          sessionId: backendId,
          command: script,
          timeout: 15000,
        });

        // Parse the output
        const config = await invoke<ServerOpksshConfig>(
          "opkssh_parse_server_config",
          { sessionId, rawOutput: output },
        );

        setServerConfigs((prev) => ({ ...prev, [sessionId]: config }));
      } catch (err: any) {
        setError(`Failed to read server config: ${err?.message || err}`);
      } finally {
        setIsLoadingServer(false);
      }
    },
    [getBackendSessionId],
  );

  // ── Server identity management ─────────────────────────
  const addServerIdentity = useCallback(
    async (
      sessionId: string,
      principal: string,
      identity: string,
      issuer: string,
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        const cmd = await invoke<string>("opkssh_build_add_identity_cmd", {
          entry: {
            principal,
            identity,
            issuer,
          },
        });
        await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 15000,
        });
        await refreshServerConfig(sessionId);
        return true;
      } catch (err: any) {
        setError(`Failed to add identity: ${err?.message || err}`);
        return false;
      }
    },
    [getBackendSessionId, refreshServerConfig],
  );

  const removeServerIdentity = useCallback(
    async (
      sessionId: string,
      entry: AuthIdEntry,
      scope: "global" | "user",
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        const cmd = await invoke<string>("opkssh_build_remove_identity_cmd", {
          entry,
          userLevel: scope === "user",
        });
        await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 15000,
        });
        await refreshServerConfig(sessionId);
        return true;
      } catch (err: any) {
        setError(`Failed to remove identity: ${err?.message || err}`);
        return false;
      }
    },
    [getBackendSessionId, refreshServerConfig],
  );

  // ── Server provider management ─────────────────────────
  const addServerProvider = useCallback(
    async (
      sessionId: string,
      issuer: string,
      clientId: string,
      expirationPolicy: ExpirationPolicy,
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        const cmd = await invoke<string>("opkssh_build_add_provider_cmd", {
          entry: {
            issuer,
            clientId,
            expirationPolicy,
          },
        });
        await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 15000,
        });
        await refreshServerConfig(sessionId);
        return true;
      } catch (err: any) {
        setError(`Failed to add provider: ${err?.message || err}`);
        return false;
      }
    },
    [getBackendSessionId, refreshServerConfig],
  );

  const removeServerProvider = useCallback(
    async (
      sessionId: string,
      entry: ProviderEntry,
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        const cmd = await invoke<string>("opkssh_build_remove_provider_cmd", {
          entry,
        });
        await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 15000,
        });
        await refreshServerConfig(sessionId);
        return true;
      } catch (err: any) {
        setError(`Failed to remove provider: ${err?.message || err}`);
        return false;
      }
    },
    [getBackendSessionId, refreshServerConfig],
  );

  // ── Server install ─────────────────────────────────────
  const installOnServer = useCallback(
    async (options: ServerInstallOptions): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(options.sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        setIsLoadingServer(true);
        const cmd = await invoke<string>("opkssh_build_install_cmd", {
          options: { ...options, sessionId: backendId },
        });
        await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 120000,
        });
        await refreshServerConfig(options.sessionId);
        return true;
      } catch (err: any) {
        setError(`Server install failed: ${err?.message || err}`);
        return false;
      } finally {
        setIsLoadingServer(false);
      }
    },
    [getBackendSessionId, refreshServerConfig],
  );

  // ── Audit ──────────────────────────────────────────────
  const runAudit = useCallback(
    async (
      sessionId: string,
      principal?: string,
      limit?: number,
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setIsLoadingAudit(true);
        setError(null);
        const cmd = await invoke<string>("opkssh_build_audit_cmd", {
          principal: principal || null,
          limit: limit || null,
        });
        const output = await invoke<string>("execute_command", {
          sessionId: backendId,
          command: cmd,
          timeout: 30000,
        });
        const result = await invoke<AuditResult>("opkssh_parse_audit_output", {
          sessionId,
          rawOutput: output,
        });
        setAuditResults((prev) => ({ ...prev, [sessionId]: result }));
        return true;
      } catch (err: any) {
        setError(`Audit failed: ${err?.message || err}`);
        return false;
      } finally {
        setIsLoadingAudit(false);
      }
    },
    [getBackendSessionId],
  );

  // ── Initial load when panel opens ──────────────────────
  useEffect(() => {
    if (isOpen) {
      refreshStatus();
      refreshWellKnownProviders();
    }
  }, [isOpen, refreshStatus, refreshWellKnownProviders]);

  useEffect(() => {
    if (isOpen && loginOperation?.status === "running") {
      void refreshLoginOperation(loginOperation.id);
    }
  }, [isOpen, loginOperation?.id, loginOperation?.status, refreshLoginOperation]);

  useEffect(() => {
    if (loginOperation?.status !== "running") {
      setLoginElapsedMs(0);
      return;
    }

    const updateElapsed = () => {
      setLoginElapsedMs(Math.max(0, Date.now() - Date.parse(loginOperation.startedAt)));
    };

    updateElapsed();
    const intervalId = globalThis.setInterval(updateElapsed, 1000);
    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [loginOperation?.startedAt, loginOperation?.status]);

  // ── Cleanup on close ───────────────────────────────────
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (wasOpen && !isOpen) {
      loginFlowRef.current += 1;
      setError(null);
      if (loginOperation?.status === "running") {
        setLoginNotice(buildBackgroundLoginNotice());
        return;
      }

      setIsLoggingIn(false);
      setLoginPhase("idle");
      setLoginWaitTimedOut(false);
      setLoginNotice(null);
      setLastLoginResult(null);
      setLoginOperation(null);
    }
  }, [isOpen, loginOperation?.status]);

  return {
    // Navigation
    activeTab,
    setActiveTab,

    // Status
    isLoading,
    isLoggingIn,
    isLoadingServer,
    isLoadingAudit,
    error,
    setError,
    binaryStatus,
    runtimeStatus,
    overallStatus,
    rolloutSignal,

    // Actions – binary
    checkBinary,
    refreshStatus,

    // Actions – login
    loginOptions,
    setLoginOptions,
    login,
    loginOperation,
    loginPhase,
    loginWaitTimedOut,
    loginNotice,
    loginElapsedMs,
    refreshLoginOperation,
    continueLoginWait,
    cancelLogin,
    lastLoginResult,

    // Actions – keys
    activeKeys,
    refreshKeys,
    removeKey,

    // Actions – client config
    clientConfig,
    refreshClientConfig,
    updateClientConfig,
    buildEnvString,

    // Actions – providers
    wellKnownProviders,
    refreshWellKnownProviders,

    // Actions – server config
    sshSessions,
    selectedSessionId,
    setSelectedSessionId,
    serverConfigs,
    refreshServerConfig,
    addServerIdentity,
    removeServerIdentity,
    addServerProvider,
    removeServerProvider,
    installOnServer,

    // Actions – audit
    auditResults,
    runAudit,
  };
}
