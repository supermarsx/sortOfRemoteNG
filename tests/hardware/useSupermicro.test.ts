import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useSupermicro } from "../../src/hooks/hardware/useSupermicro";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

describe("useSupermicro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────

  it("returns disconnected initial state", () => {
    const { result } = renderHook(() => useSupermicro());
    expect(result.current.connected).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.config).toBeNull();
  });

  // ── Connection ────────────────────────────────────────────────────

  it("connect sets connected and loads config", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "smc_connect") return undefined;
      if (cmd === "smc_get_config")
        return { host: "10.0.0.10", platform: "x12" };
      return undefined;
    });

    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      await result.current.connect({
        host: "10.0.0.10",
        username: "ADMIN",
        password: "ADMIN",
      });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.config).toEqual({
      host: "10.0.0.10",
      platform: "x12",
    });
    expect(invoke).toHaveBeenCalledWith(
      "smc_connect",
      expect.objectContaining({
        config: expect.objectContaining({
          host: "10.0.0.10",
          username: "ADMIN",
          password: "ADMIN",
        }),
      }),
    );
  });

  it("connect failure sets error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Auth failed"));

    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      try {
        await result.current.connect({
          host: "10.0.0.10",
          username: "admin",
          password: "wrong",
        });
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe("Auth failed");
  });

  it("disconnect resets state", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "smc_connect") return undefined;
      if (cmd === "smc_get_config") return { host: "h" };
      return undefined;
    });

    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      await result.current.connect({ host: "h", username: "u", password: "p" });
    });

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.config).toBeNull();
    expect(invoke).toHaveBeenCalledWith("smc_disconnect");
  });

  // ── Power ─────────────────────────────────────────────────────────

  it("powerAction calls smc_power_action", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      await result.current.powerAction("PowerCycle" as any);
    });

    expect(invoke).toHaveBeenCalledWith("smc_power_action", {
      action: "PowerCycle",
    });
  });

  it("getPowerState returns state string", async () => {
    vi.mocked(invoke).mockResolvedValue("On");
    const { result } = renderHook(() => useSupermicro());

    let state: string | undefined;
    await act(async () => {
      state = await result.current.getPowerState();
    });

    expect(state).toBe("On");
  });

  // ── Thermal ───────────────────────────────────────────────────────

  it("getThermalData invokes smc_get_thermal_data", async () => {
    const thermal = { sensors: [{ name: "Inlet", value: 25 }] };
    vi.mocked(invoke).mockResolvedValue(thermal);
    const { result } = renderHook(() => useSupermicro());

    let data: any;
    await act(async () => {
      data = await result.current.getThermalData();
    });

    expect(data).toEqual(thermal);
    expect(invoke).toHaveBeenCalledWith("smc_get_thermal_data");
  });

  // ── Node Manager ──────────────────────────────────────────────────

  it("getNodeManagerPolicies calls correct command", async () => {
    const policies = [{ id: 1, domain: "platform", policyType: "power" }];
    vi.mocked(invoke).mockResolvedValue(policies);
    const { result } = renderHook(() => useSupermicro());

    let data: any;
    await act(async () => {
      data = await result.current.getNodeManagerPolicies();
    });

    expect(data).toEqual(policies);
    expect(invoke).toHaveBeenCalledWith("smc_get_node_manager_policies");
  });

  it("getNodeManagerStats passes domain parameter", async () => {
    const stats = { power: 200, thermal: 35 };
    vi.mocked(invoke).mockResolvedValue(stats);
    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      await result.current.getNodeManagerStats("platform");
    });

    expect(invoke).toHaveBeenCalledWith("smc_get_node_manager_stats", {
      domain: "platform",
    });
  });

  // ── Users ─────────────────────────────────────────────────────────

  it("createUser calls smc_create_user", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      await result.current.createUser("admin2", "secret", "Operator");
    });

    expect(invoke).toHaveBeenCalledWith("smc_create_user", {
      username: "admin2",
      password: "secret",
      role: "Operator",
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  it("wrap captures error and clears loading", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("unavailable"));
    const { result } = renderHook(() => useSupermicro());

    await act(async () => {
      try {
        await result.current.getSystemInfo();
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.error).toBe("unavailable");
    expect(result.current.loading).toBe(false);
  });

  // ── Auto-refresh ──────────────────────────────────────────────────

  it("startAutoRefresh polls session, stopAutoRefresh cancels", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(true);

    const { result } = renderHook(() => useSupermicro());

    act(() => {
      result.current.startAutoRefresh(1000);
    });

    vi.advanceTimersByTime(3000);
    expect(invoke).toHaveBeenCalledWith("smc_check_session");

    act(() => {
      result.current.stopAutoRefresh();
    });

    vi.useRealTimers();
  });

  it("cleans up interval on unmount", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(true);

    const { result, unmount } = renderHook(() => useSupermicro());

    act(() => {
      result.current.startAutoRefresh(1000);
    });

    unmount();
    vi.useRealTimers();
  });
});
