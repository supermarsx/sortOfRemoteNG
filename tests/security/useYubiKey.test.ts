import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useYubiKey } from "../../src/hooks/ssh/useYubiKey";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

describe("useYubiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // listDevices is called on mount — provide default
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  // ── Initial state ─────────────────────────────────────────────────

  it("returns initial empty state", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const { result } = renderHook(() => useYubiKey());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.devices).toEqual([]);
    expect(result.current.selectedDevice).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.pivSlots).toEqual([]);
    expect(result.current.oathAccounts).toEqual([]);
    expect(result.current.activeTab).toBe("devices");
  });

  // ── Device enumeration ────────────────────────────────────────────

  it("listDevices on mount calls yk_list_devices", async () => {
    const devices = [
      { serial: 12345678, name: "YubiKey 5 NFC", firmware: "5.4.3" },
    ];
    vi.mocked(invoke).mockResolvedValue(devices);

    const { result } = renderHook(() => useYubiKey());

    await waitFor(() => {
      expect(result.current.devices).toEqual(devices);
    });

    expect(invoke).toHaveBeenCalledWith("yk_list_devices");
  });

  it("getDeviceInfo selects a device", async () => {
    const device = { serial: 99999, name: "YubiKey 5C", firmware: "5.2.4" };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_get_device_info") return device;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.getDeviceInfo(99999);
    });

    expect(result.current.selectedDevice).toEqual(device);
    expect(invoke).toHaveBeenCalledWith("yk_get_device_info", { serial: 99999 });
  });

  // ── PIV ───────────────────────────────────────────────────────────

  it("fetchPivCerts stores slot info", async () => {
    const slots = [{ slot: "9a", algorithm: "RSA2048", hasKey: true }];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_piv_list_certs") return slots;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.fetchPivCerts(12345);
    });

    expect(result.current.pivSlots).toEqual(slots);
    expect(invoke).toHaveBeenCalledWith("yk_piv_list_certs", { serial: 12345 });
  });

  it("pivGenerateKey calls correct invoke", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_piv_generate_key") return "PEM-PUBLIC-KEY";
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    let pubKey: any;
    await act(async () => {
      pubKey = await result.current.pivGenerateKey(
        12345,
        "9a" as any,
        "RSA2048" as any,
        "Default" as any,
        "Default" as any,
      );
    });

    expect(pubKey).toBe("PEM-PUBLIC-KEY");
    expect(invoke).toHaveBeenCalledWith("yk_piv_generate_key", {
      serial: 12345,
      slot: "9a",
      algorithm: "RSA2048",
      pinPolicy: "Default",
      touchPolicy: "Default",
    });
  });

  it("pivChangePin invokes yk_piv_change_pin", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.pivChangePin(12345, "123456", "654321");
    });

    expect(invoke).toHaveBeenCalledWith("yk_piv_change_pin", {
      serial: 12345,
      oldPin: "123456",
      newPin: "654321",
    });
  });

  it("pivReset calls yk_piv_reset", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.pivReset(12345);
    });

    expect(invoke).toHaveBeenCalledWith("yk_piv_reset", { serial: 12345 });
  });

  // ── FIDO2 ─────────────────────────────────────────────────────────

  it("fetchFido2Info stores device info", async () => {
    const info = { versions: ["FIDO_2_0"], aaguid: "abc" };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_fido2_info") return info;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.fetchFido2Info(12345);
    });

    expect(result.current.fido2Info).toEqual(info);
  });

  it("fido2SetPin calls yk_fido2_set_pin", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.fido2SetPin(12345, "newPin123");
    });

    expect(invoke).toHaveBeenCalledWith("yk_fido2_set_pin", {
      serial: 12345,
      newPin: "newPin123",
    });
  });

  // ── OATH ──────────────────────────────────────────────────────────

  it("fetchOathAccounts stores accounts", async () => {
    const accounts = [{ id: "github:user", issuer: "GitHub", name: "user" }];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_oath_list") return accounts;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.fetchOathAccounts(12345);
    });

    expect(result.current.oathAccounts).toEqual(accounts);
  });

  it("oathCalculateAll stores codes", async () => {
    const codes = { "github:user": { code: "123456", validFrom: 0, validTo: 30 } };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_oath_calculate_all") return codes;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.oathCalculateAll(12345);
    });

    expect(result.current.oathCodes).toEqual(codes);
  });

  // ── OTP ───────────────────────────────────────────────────────────

  it("otpConfigureChalResp invokes correctly", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.otpConfigureChalResp(12345, 1 as any, "hmac-key", true);
    });

    expect(invoke).toHaveBeenCalledWith("yk_otp_configure_chalresp", {
      serial: 12345,
      slot: 1,
      key: "hmac-key",
      touch: true,
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  it("wrap returns undefined and sets error on failure", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_list_devices") return [];
      if (cmd === "yk_get_device_info") throw new Error("Device not found");
      return undefined;
    });

    const { result } = renderHook(() => useYubiKey());

    let res: any;
    await act(async () => {
      res = await result.current.getDeviceInfo(99);
    });

    expect(res).toBeUndefined();
    expect(result.current.error).toBe("Device not found");
    expect(result.current.loading).toBe(false);
  });

  it("clearError resets error to null", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_list_devices") return [];
      throw new Error("fail");
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.getDeviceInfo(1);
    });

    expect(result.current.error).toBe("fail");

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  // ── Config / Audit ────────────────────────────────────────────────

  it("fetchConfig stores config", async () => {
    const cfg = { autoDetect: true, timeout: 10 };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "yk_get_config") return cfg;
      return [];
    });

    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.fetchConfig();
    });

    expect(result.current.config).toEqual(cfg);
  });

  it("factoryResetAll calls yk_factory_reset_all", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const { result } = renderHook(() => useYubiKey());

    await act(async () => {
      await result.current.factoryResetAll(12345);
    });

    expect(invoke).toHaveBeenCalledWith("yk_factory_reset_all", {
      serial: 12345,
    });
  });
});
