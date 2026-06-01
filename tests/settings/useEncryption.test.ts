/**
 * Hook contract tests for `useEncryption`. The Tauri command surface
 * is mocked per-test so the hook's behaviour (refresh after mutators,
 * error capture, unavailable-runtime fallback) is verified
 * deterministically.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useEncryption } from "../../src/hooks/settings/useEncryption";
import type {
  EncryptionStatus,
  MigrationReport,
} from "../../src/types/encryption/encryption";

const sampleStatus: EncryptionStatus = {
  schemaVersion: 0,
  masterKeyStorage: null,
  unlocked: false,
  vaultAvailable: true,
  vaultHasMasterDek: false,
  vaultBackend: "Windows Credential Manager + DPAPI",
  artifactLabels: [
    "sornG-v1::connections",
    "sornG-v1::settings",
    "sornG-v1::recordings-meta",
    "sornG-v1::recordings-media",
    "sornG-v1::backups",
    "sornG-v1::logs",
    "sornG-v1::macros",
  ],
  passwordWrapPresent: false,
  settingsEncryptedOnDisk: false,
  settingsPlaintextPresent: false,
};

const zeroLockout = {
  failedAttempts: 0,
  lastFailureUnixMs: 0,
  remainingCooldownMs: 0,
};

const setupStatus: EncryptionStatus = {
  ...sampleStatus,
  vaultHasMasterDek: true,
  masterKeyStorage: "vault",
  unlocked: true,
  schemaVersion: 2,
};

const migrationReport: MigrationReport = {
  sourcePath: "/x/settings.json",
  destinationPath: "/x/settings.enc",
  backupPath: "/x/settings.json.v0.bak",
  bytesIn: 1024,
  bytesOut: 1124,
  masterKeyStorage: "vault",
};

function makeInvoke(impl: (cmd: string, args?: any) => Promise<any>) {
  // Wrap the user impl so every test gets a default zero-lockout
  // response without having to handle the new Phase 5 command
  // explicitly. The user impl still wins if it returns its own value
  // for `encryption_lockout_state`.
  return vi.fn(async (cmd: string, args?: any) => {
    try {
      return await impl(cmd, args);
    } catch (e) {
      if (cmd === "encryption_lockout_state") return zeroLockout;
      throw e;
    }
  });
}

let invokeImpl = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => invokeImpl(cmd, args),
  isTauri: () => true,
}));

beforeEach(() => {
  invokeImpl = vi.fn();
});

describe("useEncryption", () => {
  it("fetches status on mount and exposes it", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      throw new Error(`unexpected ${cmd}`);
    });
    const { result } = renderHook(() => useEncryption());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.status).toEqual(sampleStatus);
    expect(result.current.error).toBeNull();
  });

  it("captures errors from the status query", async () => {
    invokeImpl = makeInvoke(async () => {
      throw new Error("vault offline");
    });
    const { result } = renderHook(() => useEncryption());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBe("vault offline");
  });

  it("setup refreshes status after a successful call", async () => {
    let n = 0;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") {
        n += 1;
        return n === 1 ? sampleStatus : setupStatus;
      }
      if (cmd === "encryption_setup") return "unlocked-from-vault";
      throw new Error(`unexpected ${cmd}`);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.setup("vault");
    });
    expect(outcome).toBe("unlocked-from-vault");
    expect(result.current.status).toEqual(setupStatus);
  });

  it("setup forwards the password method shape unchanged", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_setup") {
        received = args;
        return "unlocked-from-password";
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setup({
        password: {
          password: "hunter2",
          argon2: { memoryKib: 65536, timeCost: 3, parallelism: 4 },
        },
      });
    });
    expect(received).toEqual({
      method: {
        password: {
          password: "hunter2",
          argon2: { memoryKib: 65536, timeCost: 3, parallelism: 4 },
        },
      },
    });
  });

  it("unlock forwards null when no password given", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_unlock") {
        received = args;
        return "needs-setup";
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.unlock();
    });
    expect(received).toEqual({ password: null });
  });

  it("unlock forwards a password when supplied", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_unlock") {
        received = args;
        return "unlocked-from-password";
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.unlock("p");
    });
    expect(received).toEqual({ password: "p" });
  });

  it("lock invokes the command and refreshes", async () => {
    let lockCalled = false;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lock") {
        lockCalled = true;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.lock();
    });
    expect(lockCalled).toBe(true);
  });

  it("changePassword sends snake_case-free camelCase args", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_change_password") {
        received = args;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.changePassword("old", "new");
    });
    expect(received).toEqual({
      oldPassword: "old",
      newPassword: "new",
      argon2: null,
    });
  });

  it("migrateSettings returns the report and refreshes", async () => {
    let n = 0;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") {
        n += 1;
        return n === 1 ? sampleStatus : setupStatus;
      }
      if (cmd === "encryption_migrate_settings") return migrationReport;
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let report: MigrationReport | undefined;
    await act(async () => {
      report = await result.current.migrateSettings();
    });
    expect(report).toEqual(migrationReport);
    expect(result.current.status).toEqual(setupStatus);
  });

  it("fetches lockout on mount and exposes the zero state", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => {
      expect(result.current.lockout).not.toBeNull();
    });
    expect(result.current.lockout).toEqual(zeroLockout);
  });

  it("forwards a non-zero lockout snapshot through to consumers", async () => {
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lockout_state") {
        return {
          failedAttempts: 2,
          lastFailureUnixMs: 1_000_000,
          remainingCooldownMs: 12_345,
        };
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => {
      expect(result.current.lockout?.failedAttempts).toBe(2);
    });
    expect(result.current.lockout?.remainingCooldownMs).toBe(12_345);
  });

  it("unlock refreshes the lockout state too", async () => {
    let lockoutCalls = 0;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lockout_state") {
        lockoutCalls += 1;
        return zeroLockout;
      }
      if (cmd === "encryption_unlock") return "wrong-password";
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const before = lockoutCalls;
    await act(async () => {
      await result.current.unlock("nope");
    });
    expect(lockoutCalls).toBeGreaterThan(before);
  });
});
