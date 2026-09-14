import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSynologyFileConnection } from "../../src/hooks/synology/useSynologyFileConnection";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../src/hooks/synology/synologyApiCapabilities", () => ({
  verifySynologyApiTransportCapabilities: vi.fn().mockResolvedValue(undefined),
}));
const seed = {
  host: "nas.example.test",
  port: 5001,
  useHttps: true,
  username: "synthetic-user",
  password: "synthetic-password",
};
const connected = {
  status: "connected",
  lastVerifiedAt: "2026-09-10T10:00:00Z",
  consecutiveFailures: 0,
  message: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("native Synology session health", () => {
  it("polls only redacted health while backgrounded and stops on close", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? { status: "connected", sessionId: "receipt-a" }
        : command === "syn_fs_session_health"
          ? connected
          : undefined,
    );
    const { result, unmount } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: seed,
        instanceId: "tab-a",
      }),
    );
    await act(() => result.current.connect());
    expect(result.current.sessionHealth).toEqual(connected);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    const healthCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "syn_fs_session_health");
    expect(healthCalls).toHaveLength(3);
    expect(healthCalls[0][1]).toEqual({
      instanceId: "tab-a",
      expectedSessionId: "receipt-a",
    });
    expect(JSON.stringify(healthCalls)).not.toContain("synthetic-password");
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([name]) => name === "syn_fs_session_health"),
    ).toHaveLength(3);
    expect(invoke).toHaveBeenCalledWith("syn_fs_disconnect", {
      instanceId: "tab-a",
      expectedSessionId: "receipt-a",
    });
  });
  it("invalidated authentication stops polling without replaying login or file operations", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? { status: "connected", sessionId: "receipt-a" }
        : command === "syn_fs_session_health"
          ? {
              ...connected,
              status: "authentication-required",
              message:
                "SYNOLOGY_SESSION_EXPIRED: DSM code 119: invalid API session. Reconnect.",
            }
          : undefined,
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, { initialConfig: seed }),
    );
    await act(() => result.current.connect());
    expect(result.current.sessionId).toBeNull();
    expect(result.current.connectionStatus).toBe("disconnected");
    expect(result.current.connectionError).toContain("DSM code 119");
    await act(() => vi.advanceTimersByTimeAsync(90_000));
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([name]) => name === "syn_fs_connect"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([name]) => name === "syn_fs_session_health"),
    ).toHaveLength(1);
  });
  it("revokes the native lease when its owning database access disappears", async () => {
    let allowed = true;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "syn_fs_connect"
        ? { status: "connected", sessionId: "receipt-a" }
        : command === "syn_fs_session_health"
          ? connected
          : undefined,
    );
    const { result } = renderHook(() =>
      useSynologyFileConnection(true, {
        initialConfig: seed,
        assertCurrent: () => {
          if (!allowed) throw new Error("Database locked");
        },
      }),
    );
    await act(() => result.current.connect());
    allowed = false;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(result.current.sessionId).toBeNull();
    expect(invoke).toHaveBeenCalledWith(
      "syn_fs_disconnect",
      expect.objectContaining({ expectedSessionId: "receipt-a" }),
    );
  });
});
