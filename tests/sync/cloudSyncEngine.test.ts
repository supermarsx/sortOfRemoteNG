import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  capture: vi.fn(),
  apply: vi.fn(),
  store: new Map<string, unknown>(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: {
    getItemStrict: async (key: string) =>
      structuredClone(mocks.store.get(key) ?? null),
    setItemStrict: async (key: string, value: unknown) => {
      mocks.store.set(key, structuredClone(value));
    },
  },
}));
vi.mock("../../src/utils/services/cloudSyncPayload", () => ({
  captureCloudSyncPayload: mocks.capture,
  applyCloudSyncPayload: mocks.apply,
  validateCloudSyncPayload: (value: unknown) => value,
  upgradeCloudSyncPayload: async (value: unknown) => value,
}));
import {
  CloudSyncConflict,
  cloudSyncTransportOptions,
  runCloudSync,
} from "../../src/utils/services/cloudSyncEngine";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
  type CloudSyncSnapshot,
} from "../../src/utils/services/cloudSyncCodec";
import { invalidateCloudSyncTarget } from "../../src/utils/services/cloudSyncActivity";
import * as passwordCrypto from "../../src/utils/crypto/webCryptoAes";

const config = (): CloudSyncConfig => ({
  ...defaultCloudSyncConfig,
  selectedItems: ["app:settings"],
  encryptBeforeSync: false,
  compressionEnabled: false,
});
const target = (
  provider: CloudSyncTarget["provider"] = "nextcloud",
): CloudSyncTarget => ({ id: "work", label: "Work", enabled: true, provider });
const payload = (theme: string) => ({
  version: 1 as const,
  sections: { "app:settings": { theme } },
});
const snapshot = (theme: string): CloudSyncSnapshot => ({
  format: "sortofremoteng-cloud-sync",
  version: 1,
  modifiedAt: Date.now(),
  payload: payload(theme),
});

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  mocks.store.clear();
  mocks.invoke.mockReset();
  mocks.capture.mockReset();
  mocks.apply.mockReset();
  mocks.capture.mockResolvedValue(payload("dark"));
  mocks.apply.mockImplementation(async (next) => {
    mocks.capture.mockResolvedValue(next);
  });
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "cloud_sync_read"
      ? { data: null, revision: null }
      : { revision: "v2" },
  );
});

describe("application cloud sync engine", () => {
  it.each([false, true])(
    "syncs a 264 KiB payload with a 100 MiB limit (encrypted: %s)",
    async (encrypted) => {
      const settings = {
        ...config(),
        maxFileSizeMB: 100,
        encryptBeforeSync: encrypted,
        syncEncryptionPassword: "test-cloud-sync-password",
      };
      const original = payload("x".repeat(264 * 1024));
      mocks.capture.mockResolvedValue(original);
      await runCloudSync(target(), settings);
      const read = mocks.invoke.mock.calls.find(
        ([command]) => command === "cloud_sync_read",
      );
      const write = mocks.invoke.mock.calls.find(
        ([command]) => command === "cloud_sync_write",
      );
      expect(read?.[1].options.maxBytes).toBe(100 * 1024 * 1024);
      expect(write?.[1].options.maxBytes).toBe(100 * 1024 * 1024);
      const decrypt = vi.spyOn(passwordCrypto, "decryptWithPassword");
      expect(
        (await decodeCloudSnapshot(write![1].data, settings)).payload,
      ).toEqual(original);
      if (encrypted) {
        expect(decrypt).toHaveBeenCalledWith(
          expect.any(String),
          settings.syncEncryptionPassword,
          { maxCiphertextBytes: 100 * 1024 * 1024 },
        );
      }
      decrypt.mockRestore();
    },
  );

  it("accepts exactly 100 MiB and identifies invalid limits as configuration errors", () => {
    expect(
      cloudSyncTransportOptions({ ...config(), maxFileSizeMB: 100 }).maxBytes,
    ).toBe(104857600);
    for (const invalid of [
      0,
      -1,
      1e-10,
      NaN,
      Infinity,
      100 + 1 / (1024 * 1024),
    ]) {
      expect(() =>
        cloudSyncTransportOptions({ ...config(), maxFileSizeMB: invalid }),
      ).toThrow(
        /Invalid cloud sync size-limit setting.*1–100 MiB.*not a measurement/,
      );
    }
  });

  it("never resolves divergent offline edits using upload or observation clocks", async () => {
    await runCloudSync(target(), config());
    mocks.invoke.mockClear();
    mocks.capture.mockResolvedValue(payload("local-offline-edit"));
    const remote = await encodeCloudSnapshot(
      snapshot("remote-offline-edit"),
      config(),
    );
    mocks.invoke.mockResolvedValue({ data: remote, revision: "remote-edited" });
    await expect(
      runCloudSync(target(), { ...config(), conflictResolution: "keepNewer" }),
    ).rejects.toThrow(/Timestamps cannot safely choose/);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
    ]);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it.each(["nextcloud", "webdav", "sftp", "googleDrive", "oneDrive"] as const)(
    "uploads selected data for %s through native transport",
    async (provider) => {
      await expect(runCloudSync(target(provider), config())).resolves.toMatch(
        /uploaded/,
      );
      const [, args] = mocks.invoke.mock.calls.find(
        ([command]) => command === "cloud_sync_write",
      )!;
      expect(args.target.provider).toBe(provider);
      expect(args.expectedRevision).toBeNull();
      const decoded = await decodeCloudSnapshot(args.data, config());
      expect(decoded.payload).toEqual(payload("dark"));
      expect(JSON.stringify([...mocks.store.values()])).not.toContain(
        '"theme"',
      );
    },
  );

  it("requires an explicit real-item selection before reading remote data", async () => {
    await expect(
      runCloudSync(target(), { ...config(), selectedItems: [] }),
    ).rejects.toThrow(/Choose.*items/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not publish plaintext when encryption has no password", async () => {
    await expect(
      runCloudSync(target(), { ...config(), encryptBeforeSync: true }),
    ).rejects.toThrow(/password/);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not create empty snapshots when exclusions remove every selected item", async () => {
    mocks.capture.mockResolvedValue({ version: 1, sections: {} });
    await expect(runCloudSync(target(), config())).rejects.toThrow(
      /Nothing was transferred/,
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reports a late local edit after upload without recording a synchronized baseline", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "cloud_sync_read") return { data: null, revision: null };
      mocks.capture.mockResolvedValue(payload("new-local-edit"));
      return { revision: "v2" };
    });
    await expect(runCloudSync(target(), config())).rejects.toMatchObject({
      kind: "partial",
    });
    expect([...mocks.store.values()][0]).toMatchObject({ baseline: {} });
  });

  it("reports first-sync divergence as a conflict without changing either side", async () => {
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(snapshot("light"), config()),
      revision: "v1",
    });
    await expect(runCloudSync(target(), config())).rejects.toBeInstanceOf(
      CloudSyncConflict,
    );
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("reports a completed upload followed by failed local restore as partial", async () => {
    const local = payload("dark");
    local.sections = {
      ...local.sections,
      "app:extra": { value: "local-only" },
    } as typeof local.sections;
    mocks.capture.mockResolvedValue(local);
    mocks.invoke.mockImplementation(async (command) =>
      command === "cloud_sync_read"
        ? {
            data: await encodeCloudSnapshot(snapshot("light"), config()),
            revision: "v1",
          }
        : { revision: "v2" },
    );
    mocks.apply.mockRejectedValue(new Error("Store became unavailable"));
    await expect(
      runCloudSync(target(), { ...config(), conflictResolution: "keepRemote" }),
    ).rejects.toMatchObject({ kind: "partial" });
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "cloud_sync_write",
      ),
    ).toBe(true);
    expect([...mocks.store.values()][0]).toMatchObject({ baseline: {} });
  });

  it("downloads a changed remote item after establishing a common baseline", async () => {
    await runCloudSync(target(), config());
    mocks.invoke.mockClear();
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(snapshot("light"), config()),
      revision: "v2",
    });
    await expect(runCloudSync(target(), config())).resolves.toMatch(/restored/);
    expect(mocks.apply).toHaveBeenCalledWith(
      payload("light"),
      config(),
      payload("dark"),
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves unselected remote items when publishing a local item", async () => {
    const remote = snapshot("light");
    remote.payload.sections = {
      ...remote.payload.sections,
      "app:recording.terminal-macros": [{ id: "remote-only" }],
    } as typeof remote.payload.sections;
    mocks.invoke.mockImplementation(async (command) =>
      command === "cloud_sync_read"
        ? { data: await encodeCloudSnapshot(remote, config()), revision: "v1" }
        : { revision: "v2" },
    );
    await runCloudSync(target(), {
      ...config(),
      conflictResolution: "keepLocal",
    });
    const [, args] = mocks.invoke.mock.calls.find(
      ([command]) => command === "cloud_sync_write",
    )!;
    expect(args.expectedRevision).toBe("v1");
    const decoded = await decodeCloudSnapshot(args.data, config());
    expect(decoded.payload.sections["app:recording.terminal-macros"]).toEqual([
      { id: "remote-only" },
    ]);
  });

  it("does not write a destination that changed during its read", async () => {
    mocks.invoke.mockImplementation(async () => {
      invalidateCloudSyncTarget("work");
      return { data: null, revision: null };
    });
    await expect(runCloudSync(target(), config())).rejects.toThrow(
      /target changed/,
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves edits made while a remote request was in flight", async () => {
    mocks.capture
      .mockResolvedValueOnce(payload("dark"))
      .mockResolvedValue(payload("new-edit"));
    await expect(runCloudSync(target(), config())).rejects.toThrow(
      /Local data changed/,
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not mark a failed upload as synchronized", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "cloud_sync_write")
        throw { kind: "conflict", message: "revision changed" };
      return { data: null, revision: null };
    });
    await expect(runCloudSync(target(), config())).rejects.toMatchObject({
      kind: "conflict",
    });
    expect([...mocks.store.values()][0]).toMatchObject({ baseline: {} });
  });
});

describe("cloud sync envelope", () => {
  it("roundtrips authenticated encrypted snapshots without exposing records", async () => {
    const settings = {
      ...config(),
      encryptBeforeSync: true,
      syncEncryptionPassword: "long test password",
    };
    const original = snapshot("private-theme");
    const data = await encodeCloudSnapshot(original, settings);
    expect(Buffer.from(data, "base64").toString()).not.toContain(
      "private-theme",
    );
    expect(await decodeCloudSnapshot(data, settings)).toEqual(original);
    await expect(
      decodeCloudSnapshot(data, {
        ...settings,
        syncEncryptionPassword: "wrong password",
      }),
    ).rejects.toThrow(/Cannot decrypt/);
    await expect(
      decodeCloudSnapshot(data, { ...settings, encryptBeforeSync: false }),
    ).rejects.toThrow(/cannot be downgraded/);
  });

  it("rejects oversized data before native upload", async () => {
    await expect(
      encodeCloudSnapshot(snapshot("x".repeat(2048)), {
        ...config(),
        maxFileSizeMB: 0.001,
      }),
    ).rejects.toThrow(/size limit/);
  });

  it("rejects unknown envelope versions and future snapshot timestamps", async () => {
    await expect(
      decodeCloudSnapshot(
        Buffer.from('{"version":99}').toString("base64"),
        config(),
      ),
    ).rejects.toThrow(/supported/);
    const future = {
      ...snapshot("dark"),
      modifiedAt: Date.now() + 60 * 60 * 1000,
    };
    await expect(
      decodeCloudSnapshot(
        await encodeCloudSnapshot(future, config()),
        config(),
      ),
    ).rejects.toThrow(/metadata/);
  });
});
