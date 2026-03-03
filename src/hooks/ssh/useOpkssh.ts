import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useConnections } from "../../contexts/useConnections";
import type {
  OpksshBinaryStatus,
  OpksshLoginOptions,
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
  ServerInstallOptions,
} from "../../types/opkssh";

// ─── Tauri runtime check ───────────────────────────────────────────

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(
      (window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__,
    )
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function useOpkssh(isOpen: boolean) {
  const { state } = useConnections();

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

  // Login
  const [loginOptions, setLoginOptions] = useState<OpksshLoginOptions>({});
  const [lastLoginResult, setLastLoginResult] = useState<OpksshLoginResult | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
      setBinaryStatus(status.binary);
      setActiveKeys(status.activeKeys);
      if (status.clientConfig) {
        setClientConfig(status.clientConfig);
      }
    } catch (err: any) {
      setError(`Status refresh failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Login via OIDC ─────────────────────────────────────
  const login = useCallback(
    async (opts?: OpksshLoginOptions) => {
      if (!isTauri()) {
        setError("opkssh login requires the Tauri runtime.");
        return null;
      }
      const options = opts || loginOptions;
      try {
        setIsLoggingIn(true);
        setError(null);
        const result = await invoke<OpksshLoginResult>("opkssh_login", {
          options,
        });
        setLastLoginResult(result);
        if (result.success) {
          // Refresh keys after successful login
          await refreshKeys();
        }
        return result;
      } catch (err: any) {
        const msg = `Login failed: ${err?.message || err}`;
        setError(msg);
        setLastLoginResult({
          success: false,
          keyPath: null,
          identity: null,
          provider: null,
          expiresAt: null,
          message: msg,
          rawOutput: "",
        });
        return null;
      } finally {
        setIsLoggingIn(false);
      }
    },
    [loginOptions],
  );

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
    async (keyId: string) => {
      if (!isTauri()) return false;
      try {
        setError(null);
        await invoke<void>("opkssh_remove_key", { keyId });
        await refreshKeys();
        return true;
      } catch (err: any) {
        setError(`Failed to remove key: ${err?.message || err}`);
        return false;
      }
    },
    [refreshKeys],
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
        const script = await invoke<string>("opkssh_server_read_config_script", {
          sessionId: backendId,
        });

        // Execute the script on the remote server
        const output = await invoke<string>("execute_command", {
          sessionId: backendId,
          command: script,
          timeout: 15000,
        });

        // Parse the output
        const config = await invoke<ServerOpksshConfig>(
          "opkssh_parse_server_config",
          { sessionId: backendId, rawOutput: output },
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
          principal,
          identity,
          issuer,
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
          identity: entry.identity,
          issuer: entry.issuer,
          principal: entry.principal,
          scope,
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
          issuer,
          clientId,
          expirationPolicy,
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
      issuer: string,
    ): Promise<boolean> => {
      if (!isTauri()) return false;
      const backendId = getBackendSessionId(sessionId);
      if (!backendId) return false;
      try {
        setError(null);
        const cmd = await invoke<string>("opkssh_build_remove_provider_cmd", {
          issuer,
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

  // ── Cleanup on close ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setLastLoginResult(null);
    }
  }, [isOpen]);

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
    overallStatus,

    // Actions – binary
    checkBinary,
    refreshStatus,

    // Actions – login
    loginOptions,
    setLoginOptions,
    login,
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
