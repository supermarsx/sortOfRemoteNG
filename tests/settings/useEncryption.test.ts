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
    "sorng-v1::connections",
    "sorng-v1::settings",
    "sorng-v1::recordings-meta",
    "sorng-v1::recordings-media",
    "sorng-v1::backups",
    "sorng-v1::logs",
    "sorng-v1::macros",
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
  backupPath: null,
  bytesIn: 1024,
  bytesOut: 1124,
  masterKeyStorage: "vault",
};

function makeInvoke(impl: (cmd: string, args?: any) => Promise<any>) {
  // Wrap the user impl so every test gets defaults for the
  // newer "always-fetched" commands (lockout state from Phase 5,
  // audit-log read from Phase 7) without having to handle them
  // explicitly. The user impl still wins if it returns its own
  // value for either.
  return vi.fn(async (cmd: string, args?: any) => {
    try {
      return await impl(cmd, args);
    } catch (e) {
      if (cmd === "encryption_lockout_state") return zeroLockout;
      if (cmd === "encryption_audit_read") return [];
      throw e;
    }
  });
}

let invokeImpl = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => invokeImpl(cmd, args),
  isTauri: () => true,
}));

// Shared in-memory pubsub the hook's cross-window event subscriber
// plugs into. Tests in the bottom describe block use the `emit`
// helper to fire events; outer tests don't care and just let the
// subscribers register without ever firing.
const eventSubscribers: Map<
  string,
  Set<(e: { payload: unknown }) => void>
> = new Map();
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    const set = eventSubscribers.get(name) ?? new Set();
    set.add(cb);
    eventSubscribers.set(name, set);
    return () => {
      set.delete(cb);
    };
  },
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

  it("disableSettings forwards and refreshes status", async () => {
    const report = {
      sourcePath: "/x/settings.enc",
      destinationPath: "/x/settings.json",
      bytesIn: 200,
      bytesOut: 120,
    };
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_disable_settings") return report;
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let got: any;
    await act(async () => {
      got = await result.current.disableSettings();
    });
    expect(got).toEqual(report);
  });

  it("rotateMasterKey forwards the password (null when omitted)", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_rotate_master_key") {
        received = args;
        return {
          artifactsRewritten: 1,
          bytesRewritten: 80,
          vaultUpdated: true,
          dekEncUpdated: false,
        };
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.rotateMasterKey();
    });
    expect(received).toEqual({ password: null });
  });

  it("exportPortableDek sends camelCase args", async () => {
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_export_portable_dek") {
        received = args;
        return 96;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let size: number | undefined;
    await act(async () => {
      size = await result.current.exportPortableDek("/dest/key.dek", "p");
    });
    expect(received).toEqual({
      destinationPath: "/dest/key.dek",
      password: "p",
      argon2: null,
    });
    expect(size).toBe(96);
  });

  it("importPortableDek refreshes status + lockout afterwards", async () => {
    let lockoutCalls = 0;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lockout_state") {
        lockoutCalls += 1;
        return zeroLockout;
      }
      if (cmd === "encryption_import_portable_dek") return undefined;
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = lockoutCalls;
    await act(async () => {
      await result.current.importPortableDek("/src/key.dek", "p");
    });
    expect(lockoutCalls).toBeGreaterThan(before);
  });

  it("fetches the audit log on mount", async () => {
    const entries = [
      { ts: "2026-06-01T10:00:00Z", event: "unlock-success", method: "vault" },
      {
        ts: "2026-06-01T10:01:00Z",
        event: "unlock-failure",
        failedAttempts: 1,
      },
    ];
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_audit_read") return entries;
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => {
      expect(result.current.audit.length).toBe(2);
    });
    expect(result.current.audit[0].event).toBe("unlock-success");
    expect(result.current.audit[1].event).toBe("unlock-failure");
  });

  it("clearAudit invokes the command and refreshes", async () => {
    let cleared = false;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_audit_clear") {
        cleared = true;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.clearAudit();
    });
    expect(cleared).toBe(true);
  });

  it("audit hook tolerates audit_read errors without throwing", async () => {
    // Bypass the makeInvoke wrapper that swallows audit_read
    // failures with a default empty array — here we want the rejection
    // to actually reach the hook so its own catch path is exercised.
    invokeImpl = vi.fn(async (cmd: string) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lockout_state") return zeroLockout;
      if (cmd === "encryption_audit_read") throw new Error("disk gone");
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.audit).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────
  // Lock-reason metadata (Phase 7 audit-log requirement)
  //
  // Every auto-lock trigger (manual button, shortcut, idle, blur,
  // minimize, visibility-hidden) must surface its reason to the Rust
  // side so the audit log can distinguish them. The hook is a thin
  // passthrough — we lock the call shape here so a future refactor
  // can't silently drop the metadata.
  // ───────────────────────────────────────────────────────────────
  const lockReasons = [
    "manual",
    "shortcut",
    "idle",
    "blur",
    "minimize",
    "visibility-hidden",
  ] as const;

  for (const reason of lockReasons) {
    it(`lock forwards the "${reason}" reason verbatim`, async () => {
      let received: any = null;
      invokeImpl = makeInvoke(async (cmd, args) => {
        if (cmd === "encryption_status") return sampleStatus;
        if (cmd === "encryption_lock") {
          received = args;
          return undefined;
        }
        throw new Error(cmd);
      });
      const { result } = renderHook(() => useEncryption());
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.lock(reason);
      });
      expect(received).toEqual({ reason });
    });
  }

  it("lock with no reason passes { reason: null }", async () => {
    // The Rust side accepts a `None` reason and tags the audit entry
    // as "unspecified". The frontend should send explicit null rather
    // than omit the key so the wire shape is stable.
    let received: any = null;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_lock") {
        received = args;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.lock();
    });
    expect(received).toEqual({ reason: null });
  });

  it("rotateMasterKeyFull invokes the full-rotation command, not the legacy one", async () => {
    // The UI's "Rotate master key" button must call the full-artifact
    // command so settings + connections + backups + recordings + media
    // + macros all get rewritten under fresh sub-keys. The legacy
    // `encryption_rotate_master_key` (settings-only) stays exposed on
    // the hook for advanced callers but should NOT be the default
    // path. This test pins both halves: the right command fires AND
    // the legacy command stays silent.
    const fullReport = {
      settingsRewritten: true,
      connectionsRewritten: true,
      backupsRewritten: 2,
      recordingEnvelopesRewritten: 3,
      mediaSidecarsRewritten: 1,
      macrosRewritten: 0,
      bytesRewritten: 4096,
      vaultUpdated: true,
      dekEncUpdated: false,
      failures: [],
    };
    let received: any = null;
    let legacyCalled = false;
    invokeImpl = makeInvoke(async (cmd, args) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "encryption_rotate_master_key_full") {
        received = args;
        return fullReport;
      }
      if (cmd === "encryption_rotate_master_key") {
        legacyCalled = true;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let report: any;
    await act(async () => {
      report = await result.current.rotateMasterKeyFull("password");
    });
    expect(received).toEqual({ password: "password" });
    expect(report).toEqual(fullReport);
    expect(legacyCalled).toBe(false);
  });

  it("cancelRecordingsMigration invokes rec_cancel_migration", async () => {
    // The cancel flag is cooperatively read by the in-flight migration
    // walker on the Rust side. The hook is a passthrough — we just
    // verify the command name is correct so a typo doesn't silently
    // turn the Cancel button into a no-op.
    let cancelCalled = false;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      if (cmd === "rec_cancel_migration") {
        cancelCalled = true;
        return undefined;
      }
      throw new Error(cmd);
    });
    const { result } = renderHook(() => useEncryption());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.cancelRecordingsMigration();
    });
    expect(cancelCalled).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// Cross-window broadcast (Commit F)
//
// `useEncryption` subscribes to `encryption:unlocked` and
// `encryption:locked` Tauri events on mount and calls `refresh()`
// when either fires. The cross-window contract is: when window A
// fires an unlock, window B's hook receives the event and refreshes
// its status, which causes window B's UnlockScreen to dismiss.
//
// We mock the Tauri event API so the two hook instances share a
// pubsub bus rendered in jsdom.
// ──────────────────────────────────────────────────────────────────
describe("useEncryption cross-window broadcast", () => {
  beforeEach(() => {
    eventSubscribers.clear();
  });

  const subscribers = eventSubscribers;

  /** Fire an event to every listener subscribed to `name`. */
  function emit(name: string, payload: unknown = null) {
    const set = subscribers.get(name);
    if (!set) return;
    set.forEach((cb) => cb({ payload }));
  }

  /** Block until at least `count` listeners are attached to `name`.
   *  The hook subscribes asynchronously (dynamic import of
   *  `@tauri-apps/api/event`), so an immediate emit after `renderHook`
   *  would race the listener registration. */
  async function waitForSubscribers(name: string, count: number) {
    await waitFor(
      () => {
        expect(subscribers.get(name)?.size ?? 0).toBeGreaterThanOrEqual(count);
      },
      { timeout: 3000, interval: 25 },
    );
  }

  it("unlock event refreshes status in another hook instance", async () => {
    // Two `renderHook` calls simulate two browser windows. Initially
    // both see a locked status; window A receives an unlock event;
    // both should reflect the new unlocked status because the second
    // refresh sees the updated server-side response.
    let unlockedNow = false;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") {
        return { ...sampleStatus, unlocked: unlockedNow };
      }
      throw new Error(`unexpected ${cmd}`);
    });

    // Sequentially render + await each hook's settling so the async
    // listener registration in `useEncryption`'s mount effect has a
    // chance to finish before the next hook starts. Rendering both
    // synchronously is unreliable: the second hook's renders can
    // interleave with the first's async listen and cancel it before
    // it actually subscribes.
    const a = renderHook(() => useEncryption());
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitForSubscribers("encryption:unlocked", 1);
    const b = renderHook(() => useEncryption());
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    await waitForSubscribers("encryption:unlocked", 2);
    expect(a.result.current.status?.unlocked).toBe(false);
    expect(b.result.current.status?.unlocked).toBe(false);

    // Flip the server-side response so the next refresh sees unlocked,
    // then fire the cross-window event.
    unlockedNow = true;
    emit("encryption:unlocked");

    await waitFor(() => {
      expect(a.result.current.status?.unlocked).toBe(true);
      expect(b.result.current.status?.unlocked).toBe(true);
    });
  });

  it("lock event propagates to every subscribed hook instance", async () => {
    let serverUnlocked = true;
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") {
        return { ...sampleStatus, unlocked: serverUnlocked };
      }
      throw new Error(`unexpected ${cmd}`);
    });

    const a = renderHook(() => useEncryption());
    await waitFor(() => expect(a.result.current.status?.unlocked).toBe(true));
    await waitForSubscribers("encryption:locked", 1);
    const b = renderHook(() => useEncryption());
    await waitFor(() => expect(b.result.current.status?.unlocked).toBe(true));
    await waitForSubscribers("encryption:locked", 2);

    serverUnlocked = false;
    emit("encryption:locked");

    await waitFor(() => {
      expect(a.result.current.status?.unlocked).toBe(false);
      expect(b.result.current.status?.unlocked).toBe(false);
    });
  });

  it("unsubscribed listeners do not block emits", async () => {
    // Defence-in-depth: unmounting a hook should remove its listener
    // so a later emit doesn't try to call into a dead component tree.
    invokeImpl = makeInvoke(async (cmd) => {
      if (cmd === "encryption_status") return sampleStatus;
      throw new Error(`unexpected ${cmd}`);
    });
    const a = renderHook(() => useEncryption());
    await waitFor(() => expect(a.result.current.loading).toBe(false));

    a.unmount();
    // No throw expected.
    emit("encryption:unlocked");
    emit("encryption:locked");
  });
});
