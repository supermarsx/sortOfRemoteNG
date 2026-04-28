import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

// Mock useConnections
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      connections: [],
      sessions: [
        {
          id: "sess-1",
          protocol: "ssh",
          status: "connected",
          backendSessionId: "backend-1",
        },
        {
          id: "sess-2",
          protocol: "ssh",
          status: "connecting",
          backendSessionId: "backend-2",
        },
        {
          id: "sess-3",
          protocol: "rdp",
          status: "connected",
          backendSessionId: "backend-3",
        },
      ],
      selectedConnection: null,
    },
    dispatch: vi.fn(),
  }),
}));

import { useOpkssh } from "../../src/hooks/ssh/useOpkssh";

const mockInvoke = vi.mocked(invoke);

// ── Helpers ──────────────────────────────────────────────

const makeBackendStatus = (overrides: Record<string, unknown> = {}) => ({
  kind: "cli",
  available: true,
  availability: "available",
  version: "0.4.0",
  path: "/usr/local/bin/opkssh",
  message: null,
  providerOwnsCallbackListener: true,
  providerOwnsCallbackShutdown: true,
  ...overrides,
});

const makeBinaryStatus = (overrides: Record<string, unknown> = {}) => ({
  installed: true,
  path: "/usr/local/bin/opkssh",
  version: "0.4.0",
  platform: "linux",
  arch: "x86_64",
  downloadUrl: null,
  backend: makeBackendStatus(),
  ...overrides,
});

const makeRuntimeStatus = (overrides: Record<string, unknown> = {}) => {
  const cli =
    (overrides.cli as ReturnType<typeof makeBinaryStatus> | undefined)
    ?? makeBinaryStatus();

  return {
    mode: "auto",
    activeBackend: cli.installed ? "cli" : null,
    usingFallback: cli.installed,
    library: makeBackendStatus({
      kind: "library",
      available: false,
      availability: "planned",
      version: null,
      path: null,
      message: "The in-process OPKSSH library backend is not linked in this build.",
    }),
    cli,
    message: cli.installed
      ? "Using CLI fallback until the in-process library backend is linked."
      : "No OPKSSH runtime is currently available. The in-process library path is not linked yet and the CLI fallback was not found.",
    ...overrides,
  };
};

const makeOverallStatus = (overrides: Record<string, unknown> = {}) => ({
  runtime: makeRuntimeStatus(),
  binary: makeBinaryStatus(),
  activeKeys: [makeKey()],
  clientConfig: makeClientConfig(),
  lastLogin: null,
  lastError: null,
  ...overrides,
});

const makeKey = (overrides: Record<string, unknown> = {}) => ({
  id: "key-1",
  path: "/home/user/.ssh/id_ecdsa",
  publicKeyPath: "/home/user/.ssh/id_ecdsa.pub",
  identity: "user@example.com",
  provider: "google",
  createdAt: "2026-03-31T00:00:00Z",
  expiresAt: "2026-04-01T00:00:00Z",
  isExpired: false,
  algorithm: "ecdsa-sha2-nistp256",
  fingerprint: "SHA256:abc123",
  ...overrides,
});

const makeClientConfig = (overrides: Record<string, unknown> = {}) => ({
  configPath: "/home/user/.opk/config.yml",
  providers: [],
  defaultProvider: null,
  ...overrides,
});

const makeServerConfig = (overrides: Record<string, unknown> = {}) => ({
  installed: true,
  version: "0.4.0",
  providers: [],
  globalAuthIds: [],
  userAuthIds: [],
  sshdConfigSnippet: null,
  ...overrides,
});

const makeLoginResult = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  keyPath: "/home/user/.ssh/id_ecdsa",
  identity: "user@example.com",
  provider: "google",
  expiresAt: "2026-04-01T00:00:00Z",
  message: "Login successful",
  rawOutput: "ok",
  ...overrides,
});

const makeLoginOperation = (overrides: Record<string, unknown> = {}) => ({
  id: "operation-1",
  status: "succeeded",
  provider: "google",
  runtime: makeRuntimeStatus(),
  browserUrl: null,
  canCancel: false,
  message: "Login successful",
  result: makeLoginResult(),
  startedAt: "2026-04-01T00:00:00Z",
  finishedAt: "2026-04-01T00:00:05Z",
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────

describe("useOpkssh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined as never);

    // Set Tauri runtime flag
    (window as any).__TAURI_INTERNALS__ = true;
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI__;
  });

  // ── Initial state ────────────────────────────────────

  it("returns correct initial state", () => {
    const { result } = renderHook(() => useOpkssh(false));

    expect(result.current.activeTab).toBe("overview");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isLoggingIn).toBe(false);
    expect(result.current.isLoadingServer).toBe(false);
    expect(result.current.isLoadingAudit).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.binaryStatus).toBeNull();
    expect(result.current.runtimeStatus).toBeNull();
    expect(result.current.overallStatus).toBeNull();
    expect(result.current.rolloutSignal).toBeNull();
    expect(result.current.activeKeys).toEqual([]);
    expect(result.current.clientConfig).toBeNull();
    expect(result.current.serverConfigs).toEqual({});
    expect(result.current.auditResults).toEqual({});
    expect(result.current.wellKnownProviders).toEqual([]);
    expect(result.current.loginOperation).toBeNull();
    expect(result.current.lastLoginResult).toBeNull();
    expect(result.current.loginPhase).toBe("idle");
    expect(result.current.loginWaitTimedOut).toBe(false);
    expect(result.current.loginNotice).toBeNull();
    expect(result.current.loginElapsedMs).toBe(0);
  });

  it("filters SSH sessions from all sessions", () => {
    const { result } = renderHook(() => useOpkssh(false));
    // Only ssh sessions with connected/connecting status
    expect(result.current.sshSessions).toHaveLength(2);
    expect(result.current.sshSessions[0].id).toBe("sess-1");
    expect(result.current.sshSessions[1].id).toBe("sess-2");
  });

  it("auto-selects first SSH session when opened", async () => {
    const { result, rerender } = renderHook(
      ({ isOpen }) => useOpkssh(isOpen),
      { initialProps: { isOpen: false } },
    );

    expect(result.current.selectedSessionId).toBeNull();

    await act(async () => {
      rerender({ isOpen: true });
    });

    expect(result.current.selectedSessionId).toBe("sess-1");
  });

  // ── Tab management ───────────────────────────────────

  it("allows changing the active tab", () => {
    const { result } = renderHook(() => useOpkssh(false));

    act(() => {
      result.current.setActiveTab("login" as any);
    });

    expect(result.current.activeTab).toBe("login");
  });

  // ── checkBinary ──────────────────────────────────────

  it("checkBinary invokes opkssh_check_binary and sets binaryStatus", async () => {
    const status = makeBinaryStatus();
    mockInvoke.mockResolvedValueOnce(status as never);

    const { result } = renderHook(() => useOpkssh(false));

    await act(async () => {
      await result.current.checkBinary();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_check_binary");
    expect(result.current.binaryStatus).toEqual(status);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("checkBinary sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() => useOpkssh(false));

    await act(async () => {
      await result.current.checkBinary();
    });

    expect(result.current.error).toContain("Binary check failed");
    expect(result.current.isLoading).toBe(false);
  });

  it("checkBinary sets error when not in Tauri runtime", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI__;

    const { result } = renderHook(() => useOpkssh(false));

    await act(async () => {
      await result.current.checkBinary();
    });

    expect(result.current.error).toContain("Tauri runtime");
  });

  // ── refreshStatus ────────────────────────────────────

  it("refreshStatus sets overall status, binary, keys and config", async () => {
    const status = makeOverallStatus();

    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(status as never);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_status");
    expect(result.current.overallStatus).toEqual(status);
    expect(result.current.binaryStatus).toEqual(status.binary);
    expect(result.current.runtimeStatus).toEqual(status.runtime);
    expect(result.current.rolloutSignal).toEqual({
      preferredMode: "auto",
      activeBackend: "cli",
      usingFallback: true,
      fallbackReason: "Using CLI fallback until the in-process library backend is linked.",
      cliRetirementDecision: "retain-cli-fallback",
      cliRetirementMessage:
        "CLI retirement is deferred: the wrapped contract is still running on CLI fallback, so keep it visible for at least one release cycle.",
    });
    expect(result.current.activeKeys).toEqual(status.activeKeys);
    expect(result.current.clientConfig).toEqual(status.clientConfig);
    expect(result.current.isLoading).toBe(false);
  });

  it("derives a defer-until-evidence rollout signal when the library runtime is selected", async () => {
    const runtime = makeRuntimeStatus({
      mode: "library",
      activeBackend: "library",
      usingFallback: false,
      library: makeBackendStatus({
        kind: "library",
        available: true,
        availability: "available",
        version: "0.4.0-lib",
        path: "C:/wrapped/opkssh.dll",
        message: null,
      }),
      message: "Library runtime active",
    });
    const status = makeOverallStatus({
      runtime,
      binary: makeBinaryStatus(),
    });

    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(status as never);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.rolloutSignal).toEqual({
      preferredMode: "library",
      activeBackend: "library",
      usingFallback: false,
      fallbackReason: null,
      cliRetirementDecision: "defer-until-evidence",
      cliRetirementMessage:
        "CLI retirement is still deferred: this seam can prove runtime selection, but it does not yet encode bundle/install evidence for removing fallback.",
    });
  });

  it("refreshStatus sets error on failure", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(result.current.error).toContain("Status refresh failed");
  });

  // ── login ────────────────────────────────────────────

  it("login polls operation snapshots and refreshes keys on success", async () => {
    const loginResult = makeLoginResult();
    const started = makeLoginOperation({
      status: "running",
      result: null,
      canCancel: true,
      finishedAt: null,
      message: "Using CLI fallback until the in-process library backend is linked.",
    });
    const completed = makeLoginOperation({
      id: started.id,
      result: loginResult,
    });
    const keys = [makeKey()];

    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce(started as never) // opkssh_start_login
      .mockResolvedValueOnce(completed as never) // opkssh_get_login_operation
      .mockResolvedValueOnce(keys as never); // opkssh_list_keys (refreshKeys)

    const opts = { provider: "google" };
    let ret: any;
    await act(async () => {
      ret = await result.current.login(opts as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_start_login", { options: opts });
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_login_operation", {
      operationId: started.id,
    });
    expect(ret).toEqual(loginResult);
    expect(result.current.loginOperation).toEqual(completed);
    expect(result.current.runtimeStatus).toEqual(completed.runtime);
    expect(result.current.lastLoginResult).toEqual(loginResult);
    expect(result.current.activeKeys).toEqual(keys);
    expect(result.current.isLoggingIn).toBe(false);
    expect(result.current.loginWaitTimedOut).toBe(false);
  });

  it("login sets error on failure and returns null", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockRejectedValueOnce(new Error("auth failed"));

    let ret: any;
    await act(async () => {
      ret = await result.current.login();
    });

    expect(ret).toBeNull();
    expect(result.current.error).toContain("Login failed");
    expect(result.current.lastLoginResult?.success).toBe(false);
    expect(result.current.isLoggingIn).toBe(false);
  });

  it("login uses loginOptions from state when no opts provided", async () => {
    const loginResult = makeLoginResult();
    const started = makeLoginOperation({
      id: "operation-2",
      status: "running",
      provider: "microsoft",
      result: null,
      canCancel: true,
      finishedAt: null,
    });
    const completed = makeLoginOperation({
      id: started.id,
      provider: "microsoft",
      result: loginResult,
    });
    const { result } = renderHook(() => useOpkssh(false));

    act(() => {
      result.current.setLoginOptions({ provider: "microsoft" } as any);
    });

    mockInvoke
      .mockResolvedValueOnce(started as never)
      .mockResolvedValueOnce(completed as never)
      .mockResolvedValueOnce([] as never);

    await act(async () => {
      await result.current.login();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_start_login", {
      options: { provider: "microsoft" },
    });
  });

  it("login times out locally but keeps the running operation visible", async () => {
    const started = makeLoginOperation({
      status: "running",
      result: null,
      canCancel: true,
      finishedAt: null,
      message: "Waiting for browser callback",
    });
    const { result } = renderHook(() =>
      useOpkssh(false, { loginWaitTimeoutMs: 0 }),
    );

    mockInvoke
      .mockResolvedValueOnce(started as never)
      .mockResolvedValueOnce(started as never);

    let ret: any;
    await act(async () => {
      ret = await result.current.login({ provider: "google" } as any);
    });

    expect(ret).toBeNull();
    expect(result.current.isLoggingIn).toBe(true);
    expect(result.current.loginPhase).toBe("timedOut");
    expect(result.current.loginWaitTimedOut).toBe(true);
    expect(result.current.loginOperation?.status).toBe("running");
    expect(result.current.loginNotice).toContain("provider-owned callback");
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_login_operation", {
      operationId: started.id,
    });
  });

  it("cancelLogin ends a timed-out local wait without fabricating a failed login result", async () => {
    const started = makeLoginOperation({
      status: "running",
      result: null,
      canCancel: true,
      finishedAt: null,
      message: "Waiting for browser callback",
    });
    const cancelled = makeLoginOperation({
      id: started.id,
      status: "cancelled",
      result: null,
      canCancel: false,
      finishedAt: "2026-04-01T00:00:05Z",
      message:
        "Login wait cancelled locally. Callback listener bind/shutdown remain provider-owned in this Phase C slice, so external browser/provider activity may still continue.",
    });
    const { result } = renderHook(() =>
      useOpkssh(false, { loginWaitTimeoutMs: 0 }),
    );

    mockInvoke
      .mockResolvedValueOnce(started as never)
      .mockResolvedValueOnce(started as never);

    await act(async () => {
      await result.current.login({ provider: "google" } as any);
    });

    mockInvoke.mockResolvedValueOnce(cancelled as never);

    await act(async () => {
      await result.current.cancelLogin();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_cancel_login", {
      operationId: started.id,
    });
    expect(result.current.isLoggingIn).toBe(false);
    expect(result.current.loginWaitTimedOut).toBe(false);
    expect(result.current.loginOperation).toEqual(cancelled);
    expect(result.current.lastLoginResult).toBeNull();
    expect(result.current.loginNotice).toContain("provider-owned");
  });

  it("continueLoginWait resumes a timed-out operation and settles on success", async () => {
    const loginResult = makeLoginResult();
    const started = makeLoginOperation({
      status: "running",
      result: null,
      canCancel: true,
      finishedAt: null,
      message: "Waiting for browser callback",
    });
    const completed = makeLoginOperation({
      id: started.id,
      status: "succeeded",
      canCancel: false,
      finishedAt: "2026-04-01T00:00:05Z",
      result: loginResult,
    });
    const keys = [makeKey()];
    const { result } = renderHook(() =>
      useOpkssh(false, { loginWaitTimeoutMs: 0 }),
    );

    mockInvoke
      .mockResolvedValueOnce(started as never)
      .mockResolvedValueOnce(started as never);

    await act(async () => {
      await result.current.login({ provider: "google" } as any);
    });

    mockInvoke
      .mockResolvedValueOnce(completed as never)
      .mockResolvedValueOnce(keys as never);

    let resumed: any;
    await act(async () => {
      resumed = await result.current.continueLoginWait();
    });

    expect(resumed).toEqual(loginResult);
    expect(result.current.isLoggingIn).toBe(false);
    expect(result.current.loginWaitTimedOut).toBe(false);
    expect(result.current.lastLoginResult).toEqual(loginResult);
    expect(result.current.activeKeys).toEqual(keys);
  });

  // ── Key management ───────────────────────────────────

  it("refreshKeys lists keys via invoke", async () => {
    const keys = [makeKey(), makeKey({ id: "key-2" })];
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(keys as never);

    await act(async () => {
      await result.current.refreshKeys();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_list_keys");
    expect(result.current.activeKeys).toEqual(keys);
  });

  it("removeKey resolves ids to key paths before calling the backend", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce(makeOverallStatus() as never) // opkssh_get_status
      .mockResolvedValueOnce(undefined as never) // opkssh_remove_key
      .mockResolvedValueOnce([] as never); // opkssh_list_keys

    await act(async () => {
      await result.current.refreshStatus();
    });

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeKey("key-1");
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_remove_key", {
      keyPath: "/home/user/.ssh/id_ecdsa",
    });
  });

  it("removeKey returns false on failure", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockRejectedValueOnce(new Error("not found"));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeKey("bad-key");
    });

    expect(success).toBe(false);
    expect(result.current.error).toContain("Failed to remove key");
  });

  // ── Client config ────────────────────────────────────

  it("refreshClientConfig fetches and sets client config", async () => {
    const config = makeClientConfig({ defaultProvider: "google" });
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(config as never);

    await act(async () => {
      await result.current.refreshClientConfig();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_client_config");
    expect(result.current.clientConfig).toEqual(config);
  });

  it("updateClientConfig invokes update and sets local state", async () => {
    const config = makeClientConfig({ defaultProvider: "microsoft" });
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(undefined as never);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.updateClientConfig(config as any);
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_update_client_config", {
      config,
    });
    expect(result.current.clientConfig).toEqual(config);
  });

  it("updateClientConfig returns false on failure", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockRejectedValueOnce(new Error("write error"));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.updateClientConfig({} as any);
    });

    expect(success).toBe(false);
    expect(result.current.error).toContain("Failed to update config");
  });

  // ── buildEnvString ───────────────────────────────────

  it("buildEnvString returns env string from invoke", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce("SSH_AUTH_SOCK=/tmp/opkssh" as never);

    let envStr: string | null = null;
    await act(async () => {
      envStr = await result.current.buildEnvString();
    });

    expect(envStr).toBe("SSH_AUTH_SOCK=/tmp/opkssh");
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_env_string");
  });

  // ── Well-known providers ─────────────────────────────

  it("refreshWellKnownProviders fetches and sets providers", async () => {
    const providers = [
      { alias: "google", label: "Google", issuer: "https://accounts.google.com" },
    ];
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(providers as never);

    await act(async () => {
      await result.current.refreshWellKnownProviders();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_well_known_providers");
    expect(result.current.wellKnownProviders).toEqual(providers);
  });

  // ── Server config ────────────────────────────────────

  it("refreshServerConfig reads, executes, and parses server config", async () => {
    const serverConfig = makeServerConfig();
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("read-script" as never) // opkssh_server_read_config_script
      .mockResolvedValueOnce("raw output" as never) // execute_command
      .mockResolvedValueOnce(serverConfig as never); // opkssh_parse_server_config

    await act(async () => {
      await result.current.refreshServerConfig("sess-1");
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_server_read_config_script");
    expect(mockInvoke).toHaveBeenCalledWith("execute_command", {
      sessionId: "backend-1",
      command: "read-script",
      timeout: 15000,
    });
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_parse_server_config", {
      sessionId: "sess-1",
      rawOutput: "raw output",
    });
    expect(result.current.serverConfigs["sess-1"]).toEqual(serverConfig);
    expect(result.current.isLoadingServer).toBe(false);
  });

  it("refreshServerConfig sets error when session not found", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    await act(async () => {
      await result.current.refreshServerConfig("nonexistent");
    });

    expect(result.current.error).toContain("SSH session not found");
  });

  // ── Server identity management ───────────────────────

  it("addServerIdentity builds command, executes it, and refreshes config", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("add-id-cmd" as never) // opkssh_build_add_identity_cmd
      .mockResolvedValueOnce("ok" as never) // execute_command
      .mockResolvedValueOnce("script" as never) // refreshServerConfig chain
      .mockResolvedValueOnce("output" as never)
      .mockResolvedValueOnce(makeServerConfig() as never);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.addServerIdentity(
        "sess-1",
        "root",
        "user@example.com",
        "https://accounts.google.com",
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_add_identity_cmd", {
      entry: {
        principal: "root",
        identity: "user@example.com",
        issuer: "https://accounts.google.com",
      },
    });
  });

  it("removeServerIdentity returns false on failure", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("rm-cmd" as never) // opkssh_build_remove_identity_cmd
      .mockRejectedValueOnce(new Error("permission denied")); // execute_command

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeServerIdentity(
        "sess-1",
        { identity: "user@example.com", issuer: "https://accounts.google.com", principal: "root" } as any,
        "global",
      );
    });

    expect(success).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_remove_identity_cmd", {
      entry: {
        identity: "user@example.com",
        issuer: "https://accounts.google.com",
        principal: "root",
      },
      userLevel: false,
    });
    expect(result.current.error).toContain("Failed to remove identity");
  });

  // ── Server provider management ───────────────────────

  it("addServerProvider builds command and refreshes config on success", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("add-provider-cmd" as never)
      .mockResolvedValueOnce("ok" as never)
      .mockResolvedValueOnce("script" as never)
      .mockResolvedValueOnce("output" as never)
      .mockResolvedValueOnce(makeServerConfig() as never);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.addServerProvider(
        "sess-1",
        "https://accounts.google.com",
        "client-123",
        "24h" as any,
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_add_provider_cmd", {
      entry: {
        issuer: "https://accounts.google.com",
        clientId: "client-123",
        expirationPolicy: "24h",
      },
    });
  });

  it("removeServerProvider builds command and refreshes config", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("rm-provider-cmd" as never)
      .mockResolvedValueOnce("ok" as never)
      .mockResolvedValueOnce("script" as never)
      .mockResolvedValueOnce("output" as never)
      .mockResolvedValueOnce(makeServerConfig() as never);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeServerProvider(
        "sess-1",
        {
          issuer: "https://accounts.google.com",
          clientId: "client-123",
          expirationPolicy: "24h",
        } as any,
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_remove_provider_cmd", {
      entry: {
        issuer: "https://accounts.google.com",
        clientId: "client-123",
        expirationPolicy: "24h",
      },
    });
  });

  // ── Server install ───────────────────────────────────

  it("installOnServer builds install command and refreshes config", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("install-cmd" as never)
      .mockResolvedValueOnce("installed" as never)
      .mockResolvedValueOnce("script" as never)
      .mockResolvedValueOnce("output" as never)
      .mockResolvedValueOnce(makeServerConfig() as never);

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.installOnServer({
        sessionId: "sess-1",
      } as any);
    });

    expect(success).toBe(true);
    expect(result.current.isLoadingServer).toBe(false);
  });

  it("installOnServer returns false for unknown session", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.installOnServer({
        sessionId: "nonexistent",
      } as any);
    });

    expect(success).toBe(false);
  });

  // ── Audit ────────────────────────────────────────────

  it("runAudit builds audit command, executes it, and stores result", async () => {
    const auditResult = { entries: [], totalCount: 0 };
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("audit-cmd" as never) // opkssh_build_audit_cmd
      .mockResolvedValueOnce("audit output" as never) // execute_command
      .mockResolvedValueOnce(auditResult as never); // opkssh_parse_audit_output

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.runAudit("sess-1", "root", 50);
    });

    expect(success).toBe(true);
    expect(result.current.auditResults["sess-1"]).toEqual(auditResult);
    expect(result.current.isLoadingAudit).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_audit_cmd", {
      principal: "root",
      limit: 50,
    });
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_parse_audit_output", {
      sessionId: "sess-1",
      rawOutput: "audit output",
    });
  });

  it("runAudit handles error and returns false", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce("audit-cmd" as never)
      .mockRejectedValueOnce(new Error("timeout"));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.runAudit("sess-1");
    });

    expect(success).toBe(false);
    expect(result.current.error).toContain("Audit failed");
    expect(result.current.isLoadingAudit).toBe(false);
  });

  it("runAudit returns false for unknown session", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.runAudit("nonexistent");
    });

    expect(success).toBe(false);
  });

  // ── Lifecycle effects ────────────────────────────────

  it("calls refreshStatus and refreshWellKnownProviders when opened", async () => {
    const status = makeOverallStatus();
    const providers = [{ alias: "google", label: "Google", issuer: "https://accounts.google.com" }];

    mockInvoke
      .mockResolvedValueOnce(status as never) // opkssh_get_status
      .mockResolvedValueOnce(providers as never); // opkssh_well_known_providers

    await act(async () => {
      renderHook(() => useOpkssh(true));
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_status");
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_well_known_providers");
  });

  it("clears error and lastLoginResult when closed", async () => {
    const { result, rerender } = renderHook(
      ({ isOpen }) => useOpkssh(isOpen),
      { initialProps: { isOpen: false } },
    );

    // Manually set some error state
    await act(async () => {
      result.current.setError("some error");
    });
    expect(result.current.error).toBe("some error");

    // Opening and closing should clear the error
    await act(async () => {
      rerender({ isOpen: true });
    });
    await act(async () => {
      rerender({ isOpen: false });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.lastLoginResult).toBeNull();
  });

  it("keeps a running login operation visible when the panel closes", async () => {
    const started = makeLoginOperation({
      status: "running",
      result: null,
      canCancel: true,
      finishedAt: null,
      message: "Waiting for browser callback",
    });
    const { result, rerender } = renderHook(
      ({ isOpen }) => useOpkssh(isOpen, { loginWaitTimeoutMs: 0 }),
      { initialProps: { isOpen: true } },
    );

    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "opkssh_status":
          return makeOverallStatus();
        case "opkssh_list_keys":
          return [];
        case "opkssh_get_client_config":
          return makeClientConfig();
        case "opkssh_well_known_providers":
          return [];
        case "opkssh_start_login":
          return started;
        case "opkssh_get_login_operation":
          return started;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    await act(async () => {
      await result.current.login({ provider: "google" } as any);
    });

    await act(async () => {
      rerender({ isOpen: false });
    });

    expect(result.current.loginOperation?.status).toBe("running");
    expect(result.current.loginNotice).toContain("running in the background");
    expect(result.current.isLoggingIn).toBe(true);
  });
});
