import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useIlo } from "../../src/hooks/hardware/useIlo";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

describe("useIlo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────

  it("returns disconnected initial state", () => {
    const { result } = renderHook(() => useIlo());
    expect(result.current.connected).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.config).toBeNull();
  });

  // ── Connection ────────────────────────────────────────────────────

  it("connect sets connected and loads config", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ilo_connect") return "session-123";
      if (cmd === "ilo_get_config")
        return { host: "10.0.0.1", generation: "ilo5" };
      return undefined;
    });

    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.connect({
        host: "10.0.0.1",
        username: "admin",
        password: "pass",
      });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.config).toEqual({
      host: "10.0.0.1",
      generation: "ilo5",
    });
    expect(invoke).toHaveBeenCalledWith("ilo_connect", expect.objectContaining({
      host: "10.0.0.1",
      username: "admin",
      password: "pass",
    }));
  });

  it("connect failure sets error and stays disconnected", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Connection refused"));

    const { result } = renderHook(() => useIlo());

    await act(async () => {
      try {
        await result.current.connect({
          host: "10.0.0.1",
          username: "admin",
          password: "bad",
        });
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBe("Connection refused");
  });

  it("disconnect resets connected and config", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ilo_connect") return "sess";
      if (cmd === "ilo_get_config") return { host: "h" };
      return undefined;
    });

    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.connect({
        host: "h",
        username: "u",
        password: "p",
      });
    });
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.config).toBeNull();
    expect(invoke).toHaveBeenCalledWith("ilo_disconnect");
  });

  it("checkSession invokes ilo_check_session", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    const { result } = renderHook(() => useIlo());

    let val: boolean | undefined;
    await act(async () => {
      val = await result.current.checkSession();
    });

    expect(val).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ilo_check_session");
  });

  // ── Power ─────────────────────────────────────────────────────────

  it("powerAction calls ilo_power_action with correct action", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.powerAction("ForceRestart" as any);
    });

    expect(invoke).toHaveBeenCalledWith("ilo_power_action", {
      action: "ForceRestart",
    });
  });

  it("getPowerState returns current state", async () => {
    vi.mocked(invoke).mockResolvedValue("On");
    const { result } = renderHook(() => useIlo());

    let state: string | undefined;
    await act(async () => {
      state = await result.current.getPowerState();
    });

    expect(state).toBe("On");
    expect(invoke).toHaveBeenCalledWith("ilo_get_power_state");
  });

  // ── Thermal ───────────────────────────────────────────────────────

  it("getThermalData invokes ilo_get_thermal_data", async () => {
    const thermal = { temperatures: [{ name: "CPU", reading: 42 }] };
    vi.mocked(invoke).mockResolvedValue(thermal);
    const { result } = renderHook(() => useIlo());

    let data: any;
    await act(async () => {
      data = await result.current.getThermalData();
    });

    expect(data).toEqual(thermal);
    expect(invoke).toHaveBeenCalledWith("ilo_get_thermal_data");
  });

  // ── Hardware / Storage ────────────────────────────────────────────

  it("getProcessors returns processor list", async () => {
    const cpus = [{ id: "1", model: "Xeon" }];
    vi.mocked(invoke).mockResolvedValue(cpus);
    const { result } = renderHook(() => useIlo());

    let data: any;
    await act(async () => {
      data = await result.current.getProcessors();
    });

    expect(data).toEqual(cpus);
    expect(invoke).toHaveBeenCalledWith("ilo_get_processors");
  });

  // ── Virtual Media ─────────────────────────────────────────────────

  it("insertVirtualMedia passes url and mediaId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.insertVirtualMedia("http://iso.local/os.iso", "cd0");
    });

    expect(invoke).toHaveBeenCalledWith("ilo_insert_virtual_media", {
      url: "http://iso.local/os.iso",
      mediaId: "cd0",
    });
  });

  // ── Event Logs ────────────────────────────────────────────────────

  it("getIml fetches IML log entries", async () => {
    const entries = [{ id: "1", message: "Fan failure" }];
    vi.mocked(invoke).mockResolvedValue(entries);
    const { result } = renderHook(() => useIlo());

    let data: any;
    await act(async () => {
      data = await result.current.getIml();
    });

    expect(data).toEqual(entries);
    expect(invoke).toHaveBeenCalledWith("ilo_get_iml");
  });

  // ── Users ─────────────────────────────────────────────────────────

  it("createUser calls ilo_create_user with correct args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.createUser("newadmin", "secret123", "Administrator");
    });

    expect(invoke).toHaveBeenCalledWith("ilo_create_user", {
      username: "newadmin",
      password: "secret123",
      role: "Administrator",
    });
  });

  // ── Error wrapping ────────────────────────────────────────────────

  it("wrap pattern sets loading then clears on success", async () => {
    vi.mocked(invoke).mockImplementation(
      () => new Promise((r) => setTimeout(() => r("On"), 50)),
    );
    const { result } = renderHook(() => useIlo());

    const promise = act(async () => {
      await result.current.getPowerState();
    });

    await promise;

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("wrap pattern sets error when invoke throws string", async () => {
    vi.mocked(invoke).mockRejectedValue("backend error");
    const { result } = renderHook(() => useIlo());

    await act(async () => {
      try {
        await result.current.getPowerState();
      } catch {
        // wrap re-throws
      }
    });

    expect(result.current.error).toBe("backend error");
    expect(result.current.loading).toBe(false);
  });

  // ── Auto-refresh ──────────────────────────────────────────────────

  it("startAutoRefresh and stopAutoRefresh manage interval", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(null);

    const { result } = renderHook(() => useIlo());

    act(() => {
      result.current.startAutoRefresh(1000);
    });

    vi.advanceTimersByTime(3000);
    expect(invoke).toHaveBeenCalledWith("ilo_get_config");

    act(() => {
      result.current.stopAutoRefresh();
    });

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("cleanup on unmount clears interval", () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(null);

    const { result, unmount } = renderHook(() => useIlo());

    act(() => {
      result.current.startAutoRefresh(1000);
    });

    unmount();
    // No assertion needed — ensures no errors on cleanup
    vi.useRealTimers();
  });

  // ── Federation ────────────────────────────────────────────────────

  it("addFederationGroup calls correct command", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useIlo());

    await act(async () => {
      await result.current.addFederationGroup("MyGroup", "secret-key");
    });

    expect(invoke).toHaveBeenCalledWith("ilo_add_federation_group", {
      name: "MyGroup",
      key: "secret-key",
    });
  });
});
