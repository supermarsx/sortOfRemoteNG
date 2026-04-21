import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useSSHAgentManager } from "../../src/hooks/ssh/useSSHAgentManager";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

// Default mocks for the auto-load effects (isOpen triggers loadStatus, loadConfig, discoverSystemAgent)
function setupDefaultMocks() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "ssh_agent_get_status")
      return {
        running: true,
        locked: false,
        loaded_keys: 2,
        system_agent_connected: false,
        socket_path: "/tmp/agent.sock",
        forwarding_sessions: 0,
        started_at: "2024-01-01T00:00:00Z",
      };
    if (cmd === "ssh_agent_get_config")
      return {
        socket_path: "/tmp/agent.sock",
        listen_tcp: false,
        auto_connect_system_agent: false,
      };
    if (cmd === "ssh_agent_discover_system") return "/tmp/ssh-agent.sock";
    if (cmd === "ssh_agent_list_keys") return [];
    return undefined;
  });
}

describe("useSSHAgentManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__TAURI_INTERNALS__ = true;
    setupDefaultMocks();
  });

  // ── Initial state (closed) ────────────────────────────────────────

  it("does not load data when isOpen is false", () => {
    const { result } = renderHook(() => useSSHAgentManager(false));

    expect(result.current.status).toBeNull();
    expect(result.current.config).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.keys).toEqual([]);
    expect(result.current.activeTab).toBe("overview");
  });

  // ── Auto-load when open ───────────────────────────────────────────

  it("loads status, config, and discovers system agent when isOpen=true", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));

    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });

    expect(result.current.status?.running).toBe(true);
    expect(result.current.config).not.toBeNull();
    expect(result.current.discoveredPath).toBe("/tmp/ssh-agent.sock");
    expect(invoke).toHaveBeenCalledWith("ssh_agent_get_status");
    expect(invoke).toHaveBeenCalledWith("ssh_agent_get_config");
    expect(invoke).toHaveBeenCalledWith("ssh_agent_discover_system");
  });

  // ── Agent lifecycle ───────────────────────────────────────────────

  it("startAgent invokes ssh_agent_start and refreshes status", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.startAgent();
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_start");
  });

  it("stopAgent invokes ssh_agent_stop", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.stopAgent();
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_stop");
  });

  it("restartAgent invokes ssh_agent_restart", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.restartAgent();
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_restart");
  });

  it("startAgent failure sets error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_agent_start") throw "permission denied";
      if (cmd === "ssh_agent_get_status") return { running: false, locked: false, loaded_keys: 0, system_agent_connected: false, socket_path: "", forwarding_sessions: 0, started_at: null };
      if (cmd === "ssh_agent_get_config") return { socket_path: "" };
      if (cmd === "ssh_agent_discover_system") return null;
      return undefined;
    });

    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.startAgent();
    });

    expect(result.current.error).toBe("permission denied");
  });

  // ── Key management ────────────────────────────────────────────────

  it("loads keys when tab changes to keys", async () => {
    const keys = [
      { id: "k1", comment: "test@host", algorithm: "ed25519", bits: 256 },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_agent_list_keys") return keys;
      if (cmd === "ssh_agent_get_status") return { running: true, locked: false, loaded_keys: 1, system_agent_connected: false, socket_path: "/tmp/a.sock", forwarding_sessions: 0, started_at: null };
      if (cmd === "ssh_agent_get_config") return { socket_path: "/tmp/a.sock" };
      if (cmd === "ssh_agent_discover_system") return null;
      return undefined;
    });

    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => {
      result.current.setActiveTab("keys");
    });

    await waitFor(() => {
      expect(result.current.keys).toEqual(keys);
    });
  });

  it("removeKey calls ssh_agent_remove_key and refreshes", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.removeKey("key-fingerprint-1");
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_remove_key", {
      keyId: "key-fingerprint-1",
    });
  });

  it("removeAllKeys calls ssh_agent_remove_all_keys", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.removeAllKeys();
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_remove_all_keys");
  });

  // ── Lock / Unlock ─────────────────────────────────────────────────

  it("lockAgent calls ssh_agent_lock with passphrase", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.lockAgent("my-passphrase");
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_lock", {
      passphrase: "my-passphrase",
    });
  });

  it("unlockAgent calls ssh_agent_unlock", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.unlockAgent("my-passphrase");
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_unlock", {
      passphrase: "my-passphrase",
    });
  });

  // ── System agent ──────────────────────────────────────────────────

  it("connectSystemAgent calls ssh_agent_connect_system", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.connectSystemAgent();
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_connect_system");
  });

  // ── Forwarding ────────────────────────────────────────────────────

  it("stopForwarding calls ssh_agent_stop_forwarding", async () => {
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.stopForwarding("session-42");
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_stop_forwarding", {
      sessionId: "session-42",
    });
  });

  // ── Config ────────────────────────────────────────────────────────

  it("updateConfig calls ssh_agent_update_config", async () => {
    const newConfig = { socket_path: "/new/path" } as any;
    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.updateConfig(newConfig);
    });

    expect(invoke).toHaveBeenCalledWith("ssh_agent_update_config", {
      config: newConfig,
    });
    expect(result.current.config).toEqual(newConfig);
  });

  // ── Audit ─────────────────────────────────────────────────────────

  it("clearAudit empties audit log", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_agent_audit_log")
        return [{ id: "1", action: "sign", timestamp: "2024-01-01" }];
      if (cmd === "ssh_agent_clear_audit") return undefined;
      if (cmd === "ssh_agent_get_status") return { running: true, locked: false, loaded_keys: 0, system_agent_connected: false, socket_path: "", forwarding_sessions: 0, started_at: null };
      if (cmd === "ssh_agent_get_config") return { socket_path: "" };
      if (cmd === "ssh_agent_discover_system") return null;
      return undefined;
    });

    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => {
      result.current.setActiveTab("audit");
    });

    await waitFor(() => {
      expect(result.current.auditLog).toHaveLength(1);
    });

    await act(async () => {
      await result.current.clearAudit();
    });

    expect(result.current.auditLog).toEqual([]);
  });

  // ── Error management ──────────────────────────────────────────────

  it("removeKey failure sets error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_agent_remove_key") throw "key not found";
      if (cmd === "ssh_agent_get_status") return { running: true, locked: false, loaded_keys: 0, system_agent_connected: false, socket_path: "", forwarding_sessions: 0, started_at: null };
      if (cmd === "ssh_agent_get_config") return { socket_path: "" };
      if (cmd === "ssh_agent_discover_system") return null;
      return undefined;
    });

    const { result } = renderHook(() => useSSHAgentManager(true));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.removeKey("nonexistent");
    });

    expect(result.current.error).toBe("key not found");
  });
});
