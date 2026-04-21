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

const makeBinaryStatus = (overrides: Record<string, unknown> = {}) => ({
  installed: true,
  path: "/usr/local/bin/opkssh",
  version: "0.4.0",
  platform: "linux",
  arch: "x86_64",
  downloadUrl: null,
  ...overrides,
});

const makeOverallStatus = (overrides: Record<string, unknown> = {}) => ({
  binary: makeBinaryStatus(),
  activeKeys: [makeKey()],
  clientConfig: makeClientConfig(),
  ...overrides,
});

const makeKey = (overrides: Record<string, unknown> = {}) => ({
  id: "key-1",
  identity: "user@example.com",
  issuer: "https://accounts.google.com",
  keyPath: "/home/user/.ssh/id_ecdsa",
  expiresAt: "2026-04-01T00:00:00Z",
  ...overrides,
});

const makeClientConfig = (overrides: Record<string, unknown> = {}) => ({
  providers: [],
  defaultProvider: null,
  keyDirectory: "/home/user/.opk",
  ...overrides,
});

const makeServerConfig = (overrides: Record<string, unknown> = {}) => ({
  installed: true,
  version: "0.4.0",
  authIdEntries: [],
  providerEntries: [],
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
    expect(result.current.overallStatus).toBeNull();
    expect(result.current.activeKeys).toEqual([]);
    expect(result.current.clientConfig).toBeNull();
    expect(result.current.serverConfigs).toEqual({});
    expect(result.current.auditResults).toEqual({});
    expect(result.current.wellKnownProviders).toEqual([]);
    expect(result.current.lastLoginResult).toBeNull();
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
    // First two calls are from the useEffect auto-refresh when isOpen
    mockInvoke.mockResolvedValue(undefined as never);

    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke.mockResolvedValueOnce(status as never);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_get_status");
    expect(result.current.overallStatus).toEqual(status);
    expect(result.current.binaryStatus).toEqual(status.binary);
    expect(result.current.activeKeys).toEqual(status.activeKeys);
    expect(result.current.clientConfig).toEqual(status.clientConfig);
    expect(result.current.isLoading).toBe(false);
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

  it("login invokes opkssh_login with provided options and refreshes keys on success", async () => {
    const loginResult = makeLoginResult();
    const keys = [makeKey()];

    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce(loginResult as never) // opkssh_login
      .mockResolvedValueOnce(keys as never); // opkssh_list_keys (refreshKeys)

    const opts = { provider: "google" };
    let ret: any;
    await act(async () => {
      ret = await result.current.login(opts as any);
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_login", { options: opts });
    expect(ret).toEqual(loginResult);
    expect(result.current.lastLoginResult).toEqual(loginResult);
    expect(result.current.activeKeys).toEqual(keys);
    expect(result.current.isLoggingIn).toBe(false);
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
    const { result } = renderHook(() => useOpkssh(false));

    act(() => {
      result.current.setLoginOptions({ provider: "microsoft" } as any);
    });

    mockInvoke
      .mockResolvedValueOnce(loginResult as never)
      .mockResolvedValueOnce([] as never);

    await act(async () => {
      await result.current.login();
    });

    expect(mockInvoke).toHaveBeenCalledWith("opkssh_login", {
      options: { provider: "microsoft" },
    });
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

  it("removeKey invokes opkssh_remove_key and refreshes keys", async () => {
    const { result } = renderHook(() => useOpkssh(false));

    mockInvoke
      .mockResolvedValueOnce(undefined as never) // opkssh_remove_key
      .mockResolvedValueOnce([] as never); // opkssh_list_keys

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.removeKey("key-1");
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_remove_key", {
      keyId: "key-1",
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

    expect(mockInvoke).toHaveBeenCalledWith(
      "opkssh_server_read_config_script",
      { sessionId: "backend-1" },
    );
    expect(mockInvoke).toHaveBeenCalledWith("execute_command", {
      sessionId: "backend-1",
      command: "read-script",
      timeout: 15000,
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
      principal: "root",
      identity: "user@example.com",
      issuer: "https://accounts.google.com",
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
        { maxLifetime: 86400 } as any,
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_add_provider_cmd", {
      issuer: "https://accounts.google.com",
      clientId: "client-123",
      expirationPolicy: { maxLifetime: 86400 },
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
        "https://accounts.google.com",
      );
    });

    expect(success).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("opkssh_build_remove_provider_cmd", {
      issuer: "https://accounts.google.com",
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
});
