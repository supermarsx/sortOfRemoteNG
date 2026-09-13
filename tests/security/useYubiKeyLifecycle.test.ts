import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useYubiKey } from "../../src/hooks/ssh/useYubiKey";
import { describeYubiKeyError } from "../../src/utils/security/yubiKeyErrors";
import type {
  OathAccount,
  OathCode,
  YubiKeyDevice,
} from "../../src/types/security/yubikey";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const device = (serial: number) =>
  ({ serial, device_name: `Key ${serial}` }) as YubiKeyDevice;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockResolvedValue([]);
});

describe("YubiKey initialization and scoped results", () => {
  it.each([
    [
      "ykman_unavailable: private/path/secret",
      "unavailable",
      "Install the external",
    ],
    ["ykman_permission_denied: secret", "error", "access was denied"],
    ["ykman_device_missing: secret", "error", "not connected"],
    ["unexpected secret", "error", "operation failed"],
  ])(
    "ends detection on %s and retries explicitly",
    async (failure, readiness, guidance) => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error(failure));
      const { result } = renderHook(() => useYubiKey());
      await waitFor(() => expect(result.current.readiness).toBe(readiness));
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toContain(guidance);
      expect(result.current.error).not.toContain("secret");
      expect(invoke).toHaveBeenCalledTimes(1);
      await act(async () => {
        await result.current.listDevices();
      });
      expect(result.current.readiness).toBe("ready");
      expect(result.current.error).toBeNull();
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );

  it("coalesces repeated detection without auto retry or writes", async () => {
    const response = deferred<YubiKeyDevice[]>();
    vi.mocked(invoke).mockReturnValue(response.promise);
    const { result } = renderHook(() => useYubiKey());
    act(() => {
      void result.current.listDevices();
      void result.current.listDevices();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      response.resolve([]);
    });
    expect(result.current.readiness).toBe("ready");
    expect(result.current.loading).toBe(false);
  });

  it("ignores old selected-device data and errors while retaining concurrent busy state", async () => {
    const oldSlots = deferred<unknown>();
    const oldOath = deferred<unknown>();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "yk_get_device_info")
        return device((args as { serial: number }).serial);
      if (command === "yk_piv_list_certs") return oldSlots.promise;
      if (command === "yk_oath_list") return oldOath.promise;
      return [device(1), device(2)];
    });
    const { result } = renderHook(() => useYubiKey());
    await act(async () => {
      await result.current.getDeviceInfo(1);
    });
    act(() => {
      void result.current.fetchPivCerts(1);
      void result.current.fetchOathAccounts(1);
    });
    await act(async () => {
      await result.current.getDeviceInfo(2);
    });
    expect(result.current.selectedDevice?.serial).toBe(2);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      oldSlots.resolve([{ slot: "Authentication" }]);
    });
    expect(result.current.pivSlots).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      oldOath.reject(new Error("secret stale failure"));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("latest device selection wins and unmounted results are discarded", async () => {
    const first = deferred<YubiKeyDevice>();
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "yk_get_device_info"
        ? (args as { serial: number }).serial === 1
          ? first.promise
          : device(2)
        : [],
    );
    const { result, unmount } = renderHook(() => useYubiKey());
    act(() => {
      void result.current.getDeviceInfo(1);
    });
    await act(async () => {
      await result.current.getDeviceInfo(2);
    });
    await act(async () => {
      first.resolve(device(1));
    });
    expect(result.current.selectedDevice?.serial).toBe(2);
    const late = deferred<unknown>();
    vi.mocked(invoke).mockReturnValue(late.promise);
    let operation: Promise<unknown> | undefined;
    act(() => {
      operation = result.current.fetchOathAccounts(2);
    });
    unmount();
    late.resolve([{ credential_id: "secret" }]);
    expect(await operation).toBeUndefined();
  });
});

describe("native YubiKey IPC argument and response contract", () => {
  const cases: [
    string,
    (manager: ReturnType<typeof useYubiKey>) => Promise<unknown>,
    object,
  ][] = [
    [
      "yk_wait_for_device",
      (manager) => manager.waitForDevice(30_000),
      { timeoutMs: 30_000 },
    ],
    [
      "yk_piv_generate_key",
      (manager) =>
        manager.pivGenerateKey(7, "9a", "Rsa2048", "Default", "Never"),
      {
        serial: 7,
        slot: "9a",
        algo: "Rsa2048",
        pinPolicy: "Default",
        touchPolicy: "Never",
      },
    ],
    [
      "yk_piv_sign",
      (manager) => manager.pivSign(7, "9a", "YWJj", "Rsa2048"),
      { serial: 7, slot: "9a", data: "YWJj", algo: "Rsa2048" },
    ],
    [
      "yk_fido2_delete_credential",
      (manager) => manager.fido2DeleteCredential(7, "credential", "pin"),
      { serial: 7, credentialId: "credential", pin: "pin" },
    ],
    [
      "yk_oath_delete",
      (manager) => manager.oathDeleteAccount(7, "credential"),
      { serial: 7, credentialId: "credential" },
    ],
    [
      "yk_oath_calculate",
      (manager) => manager.oathCalculate(7, "credential"),
      { serial: 7, credentialId: "credential" },
    ],
    [
      "yk_oath_add",
      (manager) =>
        manager.oathAddAccount(
          7,
          "issuer",
          "name",
          "secret",
          "Totp",
          "Sha256",
          6,
          30,
          true,
        ),
      {
        serial: 7,
        issuer: "issuer",
        name: "name",
        secret: "secret",
        oathType: "Totp",
        algo: "Sha256",
        digits: 6,
        period: 30,
        touch: true,
      },
    ],
  ];
  it.each(cases)(
    "%s uses the native camelCase argument names exactly once",
    async (command, run, args) => {
      const { result } = renderHook(() => useYubiKey());
      await waitFor(() => expect(result.current.loading).toBe(false));
      vi.mocked(invoke).mockResolvedValue(null);
      await act(async () => {
        await run(result.current);
      });
      expect(invoke).toHaveBeenCalledWith(command, args);
      expect(
        vi.mocked(invoke).mock.calls.filter(([name]) => name === command),
      ).toHaveLength(1);
    },
  );

  it("maps native OATH tuples by credential identity and preserves map/slot return values", async () => {
    const account = { credential_id: "issuer:name" } as OathAccount;
    const code: OathCode = {
      code: "123456",
      valid_from: 0,
      valid_to: 30,
      touch_required: false,
    };
    const diagnostics = { model: "synthetic" };
    const slot = { slot: "Authentication", has_key: true };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "yk_oath_calculate_all") return [[account, code]];
      if (command === "yk_get_diagnostics") return diagnostics;
      if (command === "yk_piv_generate_key") return slot;
      return [];
    });
    const { result } = renderHook(() => useYubiKey());
    await act(async () => {
      expect(await result.current.oathCalculateAll(7)).toEqual({
        "issuer:name": code,
      });
      expect(await result.current.getDiagnostics(7)).toEqual(diagnostics);
      expect(
        await result.current.pivGenerateKey(
          7,
          "9a",
          "Rsa2048",
          "Default",
          "Never",
        ),
      ).toEqual(slot);
    });
    expect(result.current.oathCodes).toEqual({ "issuer:name": code });
  });

  it("sanitizes unknown native payloads without logging or echoing them", () => {
    expect(describeYubiKeyError({ secret: "pin" }).message).not.toContain(
      "pin",
    );
    expect(
      describeYubiKeyError("ykman not detected. Call detect_ykman() first.")
        .kind,
    ).toBe("unavailable");
  });
});
