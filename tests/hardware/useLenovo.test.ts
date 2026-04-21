import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useLenovo } from "../../src/hooks/hardware/useLenovo";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

describe("useLenovo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────

  it("returns disconnected initial state", () => {
    const { result } = renderHook(() => useLenovo());
    expect(result.current.connected).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.config).toBeNull();
  });

  // ── Connection ────────────────────────────────────────────────────

  it("connect sets connected and loads config", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "lenovo_connect") return undefined;
      if (cmd === "lenovo_get_config")
        return { host: "10.0.0.5", generation: "xcc2" };
      return undefined;
    });

    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      await result.current.connect({
        host: "10.0.0.5",
        username: "USERID",
        password: "PASSW0RD",
      });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.config).toEqual({
      host: "10.0.0.5",
      generation: "xcc2",
    });
    expect(invoke).toHaveBeenCalledWith(
      "lenovo_connect",
      expect.objectContaining({
        config: expect.objectContaining({
          host: "10.0.0.5",
          username: "USERID",
          password: "PASSW0RD",
        }),
      }),
    );
  });

  it("connect failure sets error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Timeout"));

    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      try {
        await result.current.connect({
          host: "10.0.0.5",
          username: "u",
          password: "p",
        });
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe("Timeout");
  });

  it("disconnect clears connected and config", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "lenovo_connect") return undefined;
      if (cmd === "lenovo_get_config") return { host: "h" };
      return undefined;
    });

    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      await result.current.connect({ host: "h", username: "u", password: "p" });
    });

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.config).toBeNull();
    expect(invoke).toHaveBeenCalledWith("lenovo_disconnect");
  });

  // ── Power ─────────────────────────────────────────────────────────

  it("powerAction calls lenovo_power_action", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      await result.current.powerAction("GracefulShutdown" as any);
    });

    expect(invoke).toHaveBeenCalledWith("lenovo_power_action", {
      action: "GracefulShutdown",
    });
  });

  it("getPowerState returns state string", async () => {
    vi.mocked(invoke).mockResolvedValue("Off");
    const { result } = renderHook(() => useLenovo());

    let state: string | undefined;
    await act(async () => {
      state = await result.current.getPowerState();
    });

    expect(state).toBe("Off");
  });

  // ── Thermal ───────────────────────────────────────────────────────

  it("getThermalData returns thermal info", async () => {
    const thermal = { fans: [{ name: "Fan1", rpm: 3000 }] };
    vi.mocked(invoke).mockResolvedValue(thermal);
    const { result } = renderHook(() => useLenovo());

    let data: any;
    await act(async () => {
      data = await result.current.getThermalData();
    });

    expect(data).toEqual(thermal);
    expect(invoke).toHaveBeenCalledWith("lenovo_get_thermal_data");
  });

  // ── Users ─────────────────────────────────────────────────────────

  it("createUser calls lenovo_create_user", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      await result.current.createUser("admin2", "pass123", "Supervisor");
    });

    expect(invoke).toHaveBeenCalledWith("lenovo_create_user", {
      username: "admin2",
      password: "pass123",
      role: "Supervisor",
    });
  });

  // ── OneCLI ────────────────────────────────────────────────────────

  it("onecliExecute calls lenovo_onecli_execute", async () => {
    const onecliResult = { output: "OK", exitCode: 0 };
    vi.mocked(invoke).mockResolvedValue(onecliResult);
    const { result } = renderHook(() => useLenovo());

    let res: any;
    await act(async () => {
      res = await result.current.onecliExecute("show all");
    });

    expect(res).toEqual(onecliResult);
    expect(invoke).toHaveBeenCalledWith("lenovo_onecli_execute", {
      command: "show all",
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  it("wrap pattern captures error message from Error objects", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("server unreachable"));
    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      try {
        await result.current.getSystemInfo();
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.error).toBe("server unreachable");
    expect(result.current.loading).toBe(false);
  });

  it("wrap pattern captures string errors", async () => {
    vi.mocked(invoke).mockRejectedValue("raw string error");
    const { result } = renderHook(() => useLenovo());

    await act(async () => {
      try {
        await result.current.getPowerMetrics();
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.error).toBe("raw string error");
  });

  // ── Auto-refresh ──────────────────────────────────────────────────

  it("startAutoRefresh polls session and stopAutoRefresh cancels", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(true);

    const { result } = renderHook(() => useLenovo());

    act(() => {
      result.current.startAutoRefresh(2000);
    });

    vi.advanceTimersByTime(6000);
    expect(invoke).toHaveBeenCalledWith("lenovo_check_session");

    act(() => {
      result.current.stopAutoRefresh();
    });

    vi.useRealTimers();
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  it("cleans up interval on unmount", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(true);

    const { result, unmount } = renderHook(() => useLenovo());

    act(() => {
      result.current.startAutoRefresh(1000);
    });

    unmount();
    vi.useRealTimers();
  });
});
