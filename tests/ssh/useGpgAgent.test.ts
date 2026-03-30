import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useGpgAgent } from "../../src/hooks/ssh/useGpgAgent";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => f || k }),
}));

// The hook calls fetchStatus + fetchKeys on mount
function setupDefaultMocks() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "gpg_get_status")
      return { running: true, version: "2.4.0", homedir: "/home/.gnupg" };
    if (cmd === "gpg_list_keys") return [];
    return undefined;
  });
}

describe("useGpgAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__TAURI_INTERNALS__ = true;
    setupDefaultMocks();
  });

  // ── Initial state ─────────────────────────────────────────────────

  it("loads status and keys on mount", async () => {
    const { result } = renderHook(() => useGpgAgent());

    await waitFor(() => {
      expect(result.current.status).toEqual({
        running: true,
        version: "2.4.0",
        homedir: "/home/.gnupg",
      });
    });

    expect(result.current.keys).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── Agent lifecycle ───────────────────────────────────────────────

  it("startAgent invokes gpg_start_agent then refreshes status", async () => {
    const { result } = renderHook(() => useGpgAgent());

    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.startAgent();
    });

    expect(invoke).toHaveBeenCalledWith("gpg_start_agent");
    // fetchStatus is called after start
    expect(invoke).toHaveBeenCalledWith("gpg_get_status");
  });

  it("stopAgent invokes gpg_stop_agent", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.stopAgent();
    });

    expect(invoke).toHaveBeenCalledWith("gpg_stop_agent");
  });

  it("restartAgent invokes gpg_restart_agent", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.restartAgent();
    });

    expect(invoke).toHaveBeenCalledWith("gpg_restart_agent");
  });

  it("startAgent failure sets error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_start_agent") throw "daemon launch failed";
      if (cmd === "gpg_get_status") return { running: false };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.startAgent();
    });

    expect(result.current.error).toBe("daemon launch failed");
  });

  // ── Key management ────────────────────────────────────────────────

  it("fetchKeys loads key list", async () => {
    const keys = [
      { keyId: "ABCD1234", uid: "user@example.com", algorithm: "RSA4096" },
    ];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_list_keys") return keys;
      if (cmd === "gpg_get_status") return { running: true };
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());

    await waitFor(() => {
      expect(result.current.keys).toEqual(keys);
    });
  });

  it("generateKey invokes gpg_generate_key and refreshes", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    const params = { algorithm: "RSA4096", name: "Test", email: "t@t.com" };
    await act(async () => {
      await result.current.generateKey(params as any);
    });

    expect(invoke).toHaveBeenCalledWith("gpg_generate_key", { params });
    // refreshes key list after generation
    expect(invoke).toHaveBeenCalledWith("gpg_list_keys", expect.anything());
  });

  it("deleteKey invokes gpg_delete_key and refreshes", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.deleteKey("ABCD1234", true);
    });

    expect(invoke).toHaveBeenCalledWith("gpg_delete_key", {
      keyId: "ABCD1234",
      secretToo: true,
    });
  });

  it("importKey returns import result", async () => {
    const importResult = { imported: 1, unchanged: 0 };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_import_key") return importResult;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let res: any;
    await act(async () => {
      res = await result.current.importKey([1, 2, 3], true);
    });

    expect(res).toEqual(importResult);
    expect(invoke).toHaveBeenCalledWith("gpg_import_key", {
      data: [1, 2, 3],
      armor: true,
    });
  });

  it("exportKey returns key bytes", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_export_key") return [65, 66, 67];
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let res: any;
    await act(async () => {
      res = await result.current.exportKey("KEY1", { armor: true } as any);
    });

    expect(res).toEqual([65, 66, 67]);
  });

  // ── Signing / Encryption ──────────────────────────────────────────

  it("signData invokes gpg_sign_data", async () => {
    const sigResult = { signature: [1, 2] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_sign_data") return sigResult;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let res: any;
    await act(async () => {
      res = await result.current.signData("KEY1", [72, 105], true, true);
    });

    expect(res).toEqual(sigResult);
    expect(invoke).toHaveBeenCalledWith("gpg_sign_data", {
      keyId: "KEY1",
      data: [72, 105],
      detached: true,
      armor: true,
    });
  });

  it("encryptData invokes gpg_encrypt", async () => {
    const encResult = { data: [99] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_encrypt") return encResult;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let res: any;
    await act(async () => {
      res = await result.current.encryptData(["REC1"], [72], true, false, null);
    });

    expect(res).toEqual(encResult);
    expect(invoke).toHaveBeenCalledWith("gpg_encrypt", {
      recipients: ["REC1"],
      data: [72],
      armor: true,
      sign: false,
      signer: null,
    });
  });

  it("decryptData invokes gpg_decrypt", async () => {
    const decResult = { data: [72, 105] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_decrypt") return decResult;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    let res: any;
    await act(async () => {
      res = await result.current.decryptData([99]);
    });

    expect(res).toEqual(decResult);
  });

  // ── Trust ─────────────────────────────────────────────────────────

  it("setTrust invokes gpg_set_trust", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.setTrust("KEY1", "full" as any);
    });

    expect(invoke).toHaveBeenCalledWith("gpg_set_trust", {
      keyId: "KEY1",
      trust: "full",
    });
  });

  // ── Keyserver ─────────────────────────────────────────────────────

  it("searchKeyserver stores results", async () => {
    const results = [{ keyId: "ABCD", uid: "user@test.com" }];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_search_keyserver") return results;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.searchKeyserver("user@test.com");
    });

    expect(result.current.keyserverResults).toEqual(results);
    expect(invoke).toHaveBeenCalledWith("gpg_search_keyserver", {
      query: "user@test.com",
    });
  });

  // ── Smart card ────────────────────────────────────────────────────

  it("getCardStatus stores card info", async () => {
    const cardInfo = { serial: "001", appVersion: "3.4" };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_card_status") return cardInfo;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.getCardStatus();
    });

    expect(result.current.cardInfo).toEqual(cardInfo);
  });

  // ── Error handling ────────────────────────────────────────────────

  it("generateKey failure sets error", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_generate_key") throw "key generation failed";
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.generateKey({} as any);
    });

    expect(result.current.error).toBe("key generation failed");
  });

  it("setError clears error manually", async () => {
    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    act(() => {
      result.current.setError("manual error");
    });

    expect(result.current.error).toBe("manual error");

    act(() => {
      result.current.setError(null);
    });

    expect(result.current.error).toBeNull();
  });

  // ── Audit ─────────────────────────────────────────────────────────

  it("clearAudit empties audit entries", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "gpg_audit_log")
        return [{ id: "1", action: "sign", timestamp: "2024-01-01" }];
      if (cmd === "gpg_audit_clear") return undefined;
      if (cmd === "gpg_get_status") return { running: true };
      if (cmd === "gpg_list_keys") return [];
      return undefined;
    });

    const { result } = renderHook(() => useGpgAgent());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => {
      await result.current.fetchAuditLog(100);
    });

    expect(result.current.auditEntries).toHaveLength(1);

    await act(async () => {
      await result.current.clearAudit();
    });

    expect(result.current.auditEntries).toEqual([]);
  });
});
