import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  migrateCloudSyncConfig,
  type CloudSyncConfig,
} from "../../src/types/settings/cloudSyncSettings";
import type { DatabaseAccessState } from "../../src/types/encryption/databaseProtection";
import {
  captureCloudSyncPayload,
  discoverCloudSyncItems,
} from "../../src/utils/services/cloudSyncPayload";
import {
  reviewCloudSync,
  runCloudSync,
} from "../../src/utils/services/cloudSyncEngine";
import { invalidateCloudSyncTarget } from "../../src/utils/services/cloudSyncActivity";

const fixture = vi.hoisted(() => ({
  owner: "owner" as string | undefined,
  generation: 0,
  states: new Map<string, DatabaseAccessState>(),
  listeners: new Set<(state: DatabaseAccessState) => void>(),
  inventory: vi.fn(),
  status: vi.fn(),
  unlock: vi.fn(),
  read: vi.fn(),
  barrier: vi.fn(),
  release: vi.fn(),
  invoke: vi.fn(),
  normalize: vi.fn(),
  select: vi.fn(),
  trust: vi.fn(),
  passwordUnlock: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => (fixture.owner ? { id: fixture.owner } : null),
      getDatabaseAccessState: (id: string) => fixture.states.get(id) ?? null,
      captureStartupRestoreGuard: () => {
        const generation = fixture.generation;
        return () => generation === fixture.generation;
      },
      onDatabaseAccessChange: (
        listener: (state: DatabaseAccessState) => void,
      ) => {
        fixture.listeners.add(listener);
        return () => fixture.listeners.delete(listener);
      },
      getExportableDatabases: fixture.inventory,
      getDatabaseProtectionStatus: fixture.status,
      unlockManagedDatabase: fixture.unlock,
      readFullDatabaseArchive: fixture.read,
      selectDatabase: fixture.select,
      activateTrust: fixture.trust,
      unlockDatabase: fixture.passwordUnlock,
    }),
  },
}));
vi.mock("../../src/utils/services/cloudSyncDatabaseBarrier", () => ({
  acquireCloudSyncDatabaseBarrier: fixture.barrier,
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => fixture.invoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));
vi.mock("../../src/utils/connection/fullDatabaseArchive", () => ({
  normalizeFullDatabaseArchive: fixture.normalize,
  fullDatabaseArchiveErrorDetail: () => "",
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: async () => null,
    setItemStrict: async () => {},
  },
}));
vi.mock("../../src/utils/services/cloudSyncSmartMerge", () => ({
  buildSmartSyncBaseline: async () => ({ disabled: true }),
}));

const row = (id: string, available = false, format = "sorng-db") => ({
  id,
  name: `Database ${id}`,
  isEncrypted: true,
  isExportable: available,
  protectionFormat: format,
});
const target = {
  id: "auto-unlock-target",
  label: "Fixture",
  enabled: true,
  provider: "webdav" as const,
};
const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  autoUnlockOsVaultDatabases: true,
  selectedItems: ["database:side"],
  syncEncryptionPassword: "synthetic-cloud-password",
  compressionEnabled: false,
});
function access(
  id: string,
  status: DatabaseAccessState["status"],
  reason: DatabaseAccessState["reason"] = status === "ready"
    ? "unlocked"
    : "locked",
) {
  const state: DatabaseAccessState = {
    databaseId: id,
    securityRevision: "fixture-revision",
    accessEpoch: String(Number(fixture.states.get(id)?.accessEpoch ?? 0) + 1),
    status,
    reason,
  };
  fixture.states.set(id, state);
  fixture.listeners.forEach((listener) => listener(state));
}
function remoteWrites() {
  return fixture.invoke.mock.calls.filter(
    ([command]) => command === "cloud_sync_write",
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  fixture.owner = "owner";
  fixture.generation = 0;
  fixture.states.clear();
  fixture.listeners.clear();
  fixture.inventory.mockImplementation(async () => [
    row("side", fixture.states.get("side")?.status === "ready"),
  ]);
  fixture.status.mockResolvedValue({
    kind: "managed",
    slots: [{ id: "vault-slot", type: "os-vault" }],
  });
  fixture.unlock.mockImplementation(async (id, _slot, password, options) => {
    expect(password).toBeUndefined();
    expect(options.isCurrent()).toBe(true);
    access(id, "ready");
  });
  fixture.read.mockImplementation(async (id) => ({
    format: "sorng-full-database",
    version: 1,
    collection: { id },
    connections: [],
  }));
  fixture.normalize.mockImplementation(async (value) => value);
  fixture.barrier.mockResolvedValue(fixture.release);
  fixture.release.mockResolvedValue(undefined);
  fixture.invoke.mockImplementation(async (command) =>
    command === "cloud_sync_read"
      ? { data: null, revision: null }
      : command === "encryption_status"
        ? { schemaVersion: 2, unlocked: true }
        : null,
  );
});
afterEach(() => {
  expect(fixture.listeners.size).toBe(0);
  expect(fixture.select).not.toHaveBeenCalled();
  expect(fixture.trust).not.toHaveBeenCalled();
  expect(fixture.passwordUnlock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("explicit OS-vault cloud capture consent", () => {
  it.each([undefined, false, null, "true", 1, true])(
    "normalizes %s using strict opt-in, default OFF",
    (value) => {
      expect(defaultCloudSyncConfig.autoUnlockOsVaultDatabases).toBe(false);
      expect(
        migrateCloudSyncConfig({
          ...config(),
          autoUnlockOsVaultDatabases: value as boolean,
        }).autoUnlockOsVaultDatabases,
      ).toBe(value === true);
    },
  );

  it("only annotates unavailable native inventory rows and never inspects slots or unlocks", async () => {
    fixture.inventory.mockResolvedValue([
      row("locked"),
      row("ready", true),
      row("legacy", false, "legacy"),
    ]);
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "read_macro_library")
        throw new Error("private store error");
      return null;
    });
    const items = await discoverCloudSyncItems({ includeSizes: false });
    expect(items.filter((item) => item.unlockDatabaseId)).toEqual([
      expect.objectContaining({
        id: "database:locked",
        unlockDatabaseId: "locked",
      }),
    ]);
    expect(
      items.find((item) => item.id === "database:missing"),
    ).toBeUndefined();
    expect(fixture.status).not.toHaveBeenCalled();
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it.each([undefined, false, "true", 1])(
    "does not unlock without boolean true (%s)",
    async (flag) => {
      await expect(
        captureCloudSyncPayload({
          ...config(),
          autoUnlockOsVaultDatabases: flag as boolean,
        }),
      ).rejects.toThrow("unavailable");
      expect(fixture.status).not.toHaveBeenCalled();
      expect(fixture.unlock).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", undefined])(
    "unlocks a side database without activating it (owner %s)",
    async (owner) => {
      fixture.owner = owner;
      const payload = await captureCloudSyncPayload(config());
      expect(payload.sections["database:side"]).toBeDefined();
      expect(fixture.owner).toBe(owner);
      expect(fixture.unlock).toHaveBeenCalledExactlyOnceWith(
        "side",
        "vault-slot",
        undefined,
        { isCurrent: expect.any(Function) },
      );
      expect(fixture.unlock.mock.invocationCallOrder[0]).toBeLessThan(
        fixture.barrier.mock.invocationCallOrder[0],
      );
      expect(fixture.release).toHaveBeenCalledOnce();
    },
  );

  it("unlocks the current database before the flush barrier", async () => {
    fixture.owner = "side";
    fixture.barrier.mockImplementation(async () => {
      expect(fixture.states.get("side")?.status).toBe("ready");
      return fixture.release;
    });
    await captureCloudSyncPayload(config());
    expect(fixture.read).toHaveBeenCalledExactlyOnceWith("side", {
      materializeDefaults: true,
      browserSessionsPassword: config().syncEncryptionPassword,
    });
  });

  it.each(["database:side", "Database side", "database/*.json"])(
    "honors exclusion %s before slot inspection",
    async (pattern) => {
      expect(
        await captureCloudSyncPayload({
          ...config(),
          excludePatterns: [pattern],
        }),
      ).toEqual({ version: 1, sections: {} });
      expect(fixture.status).not.toHaveBeenCalled();
      expect(fixture.unlock).not.toHaveBeenCalled();
      expect(
        fixture.invoke.mock.calls.some(
          ([command]) => command === "encryption_status",
        ),
      ).toBe(false);
    },
  );

  it("does not touch unselected, available, legacy or missing sources", async () => {
    fixture.inventory.mockResolvedValue([
      row("other"),
      row("ready", true),
      row("legacy", false, "legacy"),
    ]);
    for (const selectedItems of [
      [],
      ["database:ready"],
      ["database:legacy"],
      ["database:missing"],
    ]) {
      await captureCloudSyncPayload({ ...config(), selectedItems }).catch(
        () => undefined,
      );
    }
    expect(fixture.status).not.toHaveBeenCalled();
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it.each([
    { slots: [] },
    { slots: [{ type: "password" }] },
    { slots: [{ type: "os-vault" }, { type: "os-vault" }] },
  ])("requires exactly one OS vault slot (%j)", async ({ slots }) => {
    fixture.status.mockResolvedValue({ kind: "managed", slots });
    await expect(captureCloudSyncPayload(config())).rejects.toThrow(
      "exactly one OS-vault",
    );
    expect(fixture.status).toHaveBeenCalledOnce();
    expect(fixture.unlock).not.toHaveBeenCalled();
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("ignores password slots when exactly one OS vault slot exists", async () => {
    fixture.status.mockResolvedValue({
      kind: "managed",
      slots: [
        { id: "password-slot", type: "password" },
        { id: "vault-slot", type: "os-vault" },
      ],
    });
    await captureCloudSyncPayload(config());
    expect(fixture.unlock.mock.calls[0][1]).toBe("vault-slot");
  });

  it("rejects nonmanaged protection even if the inventory was native", async () => {
    fixture.status.mockResolvedValue({
      kind: "legacy-password",
      slots: [{ id: "vault-slot", type: "os-vault" }],
    });
    await expect(captureCloudSyncPayload(config())).rejects.toThrow(
      "Unlock it manually",
    );
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it.each(["status", "unlock"])(
    "sanitizes %s failure, never retries or writes remotely",
    async (step) => {
      fixture[step as "status" | "unlock"].mockRejectedValue(
        new Error("RAW_CREDENTIAL_NATIVE_SECRET"),
      );
      const error = await runCloudSync(target, config()).catch(
        (error: Error) => error,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("Unlock it manually");
      expect(String(error)).not.toContain("RAW_CREDENTIAL_NATIVE_SECRET");
      expect(error).not.toHaveProperty("cause");
      expect(fixture.status).toHaveBeenCalledOnce();
      expect(fixture.unlock).toHaveBeenCalledTimes(step === "unlock" ? 1 : 0);
      expect(fixture.read).not.toHaveBeenCalled();
      expect(remoteWrites()).toHaveLength(0);
    },
  );

  it("requires verified ready access and fresh inventory after a native response", async () => {
    fixture.unlock.mockResolvedValue(undefined);
    await expect(captureCloudSyncPayload(config())).rejects.toThrow(
      "Unlock it manually",
    );
    expect(fixture.read).not.toHaveBeenCalled();
    fixture.unlock.mockImplementation(async () => access("side", "ready"));
    fixture.inventory.mockResolvedValue([row("side")]);
    await expect(captureCloudSyncPayload(config())).rejects.toThrow(
      "unavailable",
    );
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it.each(["owner", "global-lock", "access", "lock-unlock", "silent-epoch"])(
    "cancels %s while inspecting protection before unlock",
    async (change) => {
      fixture.status.mockImplementation(async () => {
        if (change === "owner") fixture.owner = "other";
        else if (change === "global-lock") fixture.generation++;
        else if (change === "silent-epoch")
          fixture.states.set("side", {
            databaseId: "side",
            accessEpoch: "new",
            securityRevision: "new",
            status: "suspended",
            reason: "locked",
          });
        else {
          access("side", "suspended");
          if (change === "lock-unlock") access("side", "ready");
        }
        return {
          kind: "managed",
          slots: [{ id: "vault-slot", type: "os-vault" }],
        };
      });
      await expect(captureCloudSyncPayload(config())).rejects.toThrow(
        "changed",
      );
      expect(fixture.unlock).not.toHaveBeenCalled();
      expect(fixture.read).not.toHaveBeenCalled();
    },
  );

  it.each(["global-lock", "opt-out", "owner"])(
    "cancels native grant installation during %s",
    async (change) => {
      fixture.unlock.mockImplementation(
        async (_id, _slot, _password, options) => {
          if (change === "global-lock") fixture.generation++;
          else if (change === "owner") fixture.owner = "other";
          else invalidateCloudSyncTarget(target.id);
          expect(options.isCurrent()).toBe(false);
          throw new Error("PRIVATE_STALE_NATIVE_SESSION");
        },
      );
      await expect(runCloudSync(target, config())).rejects.toThrow("changed");
      expect(fixture.states.has("side")).toBe(false);
      expect(remoteWrites()).toHaveLength(0);
    },
  );

  it("checks identity after discovery, before any native status request", async () => {
    fixture.inventory.mockImplementation(async () => {
      invalidateCloudSyncTarget(target.id);
      return [row("side")];
    });
    await expect(runCloudSync(target, config())).rejects.toThrow("changed");
    expect(fixture.status).not.toHaveBeenCalled();
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("checks access cancellation after archive normalization and releases the barrier", async () => {
    fixture.normalize.mockImplementation(async (value) => {
      access("side", "suspended");
      return value;
    });
    await expect(captureCloudSyncPayload(config())).rejects.toThrow("changed");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("cleans up cancellation listeners when the barrier fails", async () => {
    fixture.barrier.mockRejectedValue(new Error("flush failed"));
    await expect(captureCloudSyncPayload(config())).rejects.toThrow(
      "flush failed",
    );
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("never unlocks during review or comparison capture", async () => {
    await expect(reviewCloudSync(target, config())).rejects.toThrow(
      "unavailable",
    );
    await expect(
      captureCloudSyncPayload(config(), { allowAutoUnlock: false }),
    ).rejects.toThrow("unavailable");
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("does not re-unlock after a user locks during the remote read", async () => {
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "cloud_sync_read") {
        access("side", "suspended");
        return { data: null, revision: null };
      }
      if (command === "encryption_status")
        return { schemaVersion: 2, unlocked: true };
      return null;
    });
    await expect(runCloudSync(target, config())).rejects.toThrow("unavailable");
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(remoteWrites()).toHaveLength(0);
  });

  it("unlocks only once through an entire successful engine operation", async () => {
    await expect(runCloudSync(target, config())).resolves.toContain(
      "uploaded and verified",
    );
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(fixture.status).toHaveBeenCalledOnce();
    expect(remoteWrites()).toHaveLength(1);
  });

  it("does not reacquire unlock authority on the engine's local-edit retry", async () => {
    let reads = 0;
    fixture.read.mockImplementation(async (id) => {
      reads++;
      return {
        format: "sorng-full-database",
        version: 1,
        collection: { id },
        connections: [],
        settings: { theme: reads === 1 ? "dark" : "light" },
      };
    });
    let releases = 0;
    fixture.release.mockImplementation(async () => {
      if (++releases === 2) access("side", "suspended");
    });
    await expect(runCloudSync(target, config())).rejects.toThrow("unavailable");
    expect(fixture.unlock).toHaveBeenCalledOnce();
    expect(remoteWrites()).toHaveLength(0);
  });

  it("binds conflict review receipts to auto-unlock consent", async () => {
    access("side", "ready");
    const disabled = await reviewCloudSync(target, {
      ...config(),
      autoUnlockOsVaultDatabases: false,
    });
    const enabled = await reviewCloudSync(target, config());
    expect(enabled.reviewKey).not.toBe(disabled.reviewKey);
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("attempts a selected database only once even with duplicate selection/inventory rows", async () => {
    fixture.inventory.mockImplementation(async () => {
      const entry = row("side", fixture.states.get("side")?.status === "ready");
      return [entry, entry];
    });
    await captureCloudSyncPayload({
      ...config(),
      selectedItems: ["database:side", "database:side"],
    });
    expect(fixture.unlock).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    { schemaVersion: 2, unlocked: false },
    { schemaVersion: 0, unlocked: false, recoveryRequired: true },
    { schemaVersion: 2, unlocked: true, criticalKeyFailure: true },
    { schemaVersion: 99, unlocked: true },
  ])(
    "rejects unverified or already locked global storage (%j), including never-seen databases",
    async (status) => {
      fixture.invoke.mockResolvedValue(status);
      await expect(captureCloudSyncPayload(config())).rejects.toThrow(
        "Unlock application storage",
      );
      expect(fixture.status).not.toHaveBeenCalled();
      expect(fixture.unlock).not.toHaveBeenCalled();
      expect(remoteWrites()).toHaveLength(0);
    },
  );

  it("sanitizes failed global status probes", async () => {
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "encryption_status")
        throw new Error("PRIVATE_GLOBAL_KEY_ERROR");
      return null;
    });
    const error = await captureCloudSyncPayload(config()).catch(
      (error: Error) => error,
    );
    expect(String(error)).toContain("Unlock application storage");
    expect(String(error)).not.toContain("PRIVATE_GLOBAL_KEY_ERROR");
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("allows fresh unconfigured storage and recovered global storage despite an old database lock reason", async () => {
    access("side", "suspended", "global-lock");
    await captureCloudSyncPayload(config());
    access("side", "suspended", "global-lock");
    fixture.invoke.mockImplementation(async (command) =>
      command === "encryption_status"
        ? { schemaVersion: 0, unlocked: false }
        : null,
    );
    await captureCloudSyncPayload(config());
    expect(fixture.unlock).toHaveBeenCalledTimes(2);
  });

  it("cancels global lock during the status probe", async () => {
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "encryption_status") {
        fixture.generation++;
        return { schemaVersion: 2, unlocked: true };
      }
      return null;
    });
    await expect(captureCloudSyncPayload(config())).rejects.toThrow("changed");
    expect(fixture.unlock).not.toHaveBeenCalled();
  });

  it("cancels during barrier release instead of returning a stale payload", async () => {
    fixture.release.mockImplementation(async () => {
      fixture.generation++;
    });
    await expect(captureCloudSyncPayload(config())).rejects.toThrow("changed");
  });
});
