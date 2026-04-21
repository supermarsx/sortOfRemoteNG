import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, f?: string) => f || k,
  }),
}));

import { useWinmgmtSession } from "../../src/hooks/windows/useWinmgmtSession";

// ── Helpers ────────────────────────────────────────────────────────

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const baseConfig: Record<string, unknown> = {
  hostname: "10.0.0.50",
  port: 5985,
  username: "admin",
  password: "pass",
  useSsl: false,
  authMethod: "basic",
  namespace: "root/cimv2",
};

function setTauriRuntime(enabled: boolean) {
  if (enabled) {
    (window as any).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI__;
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useWinmgmtSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTauriRuntime(true);
    mockInvoke.mockResolvedValue(undefined);
  });

  // ── connect ─────────────────────────────────────────────────

  it("connects and sets sessionId on success", async () => {
    mockInvoke.mockResolvedValueOnce("session-abc");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    // Auto-connect fires via useEffect
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
    expect(result.current.sessionId).toBe("session-abc");
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("winmgmt_connect", {
      config: baseConfig,
    });
  });

  it("sets error when connect fails", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("auth failed"));
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => {
      expect(result.current.error).toBe("Error: auth failed");
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("sets error when Tauri runtime is not available", async () => {
    setTauriRuntime(false);
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => {
      expect(result.current.error).toBe(
        "Windows management requires the Tauri runtime.",
      );
    });
    expect(result.current.isConnected).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "winmgmt_connect",
      expect.anything(),
    );
  });

  // ── disconnect ──────────────────────────────────────────────

  it("disconnect clears sessionId and error", async () => {
    mockInvoke.mockResolvedValueOnce("session-xyz");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    mockInvoke.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("winmgmt_disconnect", {
      sessionId: "session-xyz",
    });
  });

  it("disconnect is a no-op when not connected", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("fail connect"));
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.error).toBeTruthy());

    await act(async () => {
      await result.current.disconnect();
    });

    // Should not have called winmgmt_disconnect
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "winmgmt_disconnect",
      expect.anything(),
    );
  });

  it("disconnect logs warning and still clears state when invoke rejects", async () => {
    mockInvoke.mockResolvedValueOnce("session-disc-err");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("network error during disconnect"));

    await act(async () => {
      await result.current.disconnect();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "winmgmt_disconnect failed:",
      expect.any(Error),
    );
    // State should still be cleared even on failure
    expect(result.current.isConnected).toBe(false);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();

    warnSpy.mockRestore();
  });

  // ── cmd ─────────────────────────────────────────────────────

  it("cmd invokes a command with sessionId auto-injected", async () => {
    mockInvoke.mockResolvedValueOnce("session-cmd");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    const payload = { query: "SELECT * FROM Win32_Process" };
    mockInvoke.mockResolvedValueOnce([{ name: "explorer.exe" }]);

    let cmdResult: unknown;
    await act(async () => {
      cmdResult = await result.current.cmd("winmgmt_query_wmi", payload);
    });

    expect(cmdResult).toEqual([{ name: "explorer.exe" }]);
    expect(mockInvoke).toHaveBeenCalledWith("winmgmt_query_wmi", {
      sessionId: "session-cmd",
      ...payload,
    });
  });

  it("cmd throws when no session is connected", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("connect fail"));
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.error).toBeTruthy());

    await expect(
      act(async () => {
        await result.current.cmd("winmgmt_query_wmi", {});
      }),
    ).rejects.toThrow("No WMI session connected");
  });

  it("cmd throws when Tauri runtime is missing", async () => {
    setTauriRuntime(false);
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.error).toBeTruthy());

    await expect(
      act(async () => {
        await result.current.cmd("winmgmt_anything", {});
      }),
    ).rejects.toThrow("Tauri runtime required");
  });

  // ── Fatal error handling ────────────────────────────────────

  it("cmd tears down session on fatal error (access denied)", async () => {
    mockInvoke.mockResolvedValueOnce("session-fatal");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    mockInvoke.mockRejectedValueOnce("Access Denied - permission error");

    let cmdError: unknown;
    await act(async () => {
      try {
        await result.current.cmd("winmgmt_query_wmi", {});
      } catch (e) {
        cmdError = e;
      }
    });

    expect(cmdError).toBeTruthy();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toContain("Access Denied");
  });

  it("cmd tears down session on fatal error (HTTP 401)", async () => {
    mockInvoke.mockResolvedValueOnce("session-401");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    mockInvoke.mockRejectedValueOnce("HTTP 401 Unauthorized");

    let cmdError: unknown;
    await act(async () => {
      try {
        await result.current.cmd("winmgmt_get_system", {});
      } catch (e) {
        cmdError = e;
      }
    });

    expect(cmdError).toBeTruthy();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toContain("HTTP 401");
  });

  it("cmd does NOT tear down session on non-fatal error", async () => {
    mockInvoke.mockResolvedValueOnce("session-nonfatal");
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.isConnected).toBe(true));

    mockInvoke.mockRejectedValueOnce("WQL syntax error near 'SELCT'");

    await expect(
      act(async () => {
        await result.current.cmd("winmgmt_query_wmi", {});
      }),
    ).rejects.toBeTruthy();

    // Session should remain alive
    expect(result.current.isConnected).toBe(true);
    expect(result.current.sessionId).toBe("session-nonfatal");
    expect(result.current.error).toBeNull();
  });

  // ── clearError ──────────────────────────────────────────────

  it("clearError resets error to null", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useWinmgmtSession(baseConfig));

    await waitFor(() => expect(result.current.error).toBeTruthy());

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
