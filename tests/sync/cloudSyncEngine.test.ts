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
  upgrade: vi.fn(),
  discover: vi.fn(),
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
  upgradeCloudSyncPayload: mocks.upgrade,
  discoverCloudSyncItems: mocks.discover,
}));
import {
  CloudSyncConflict,
  cloudSyncTransportOptions,
  runCloudSync,
  reviewCloudSync,
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
  mocks.upgrade.mockReset().mockImplementation(async (value) => value);
  mocks.discover
    .mockReset()
    .mockResolvedValue([
      { id: "app:settings", label: "Appearance preferences" },
    ]);
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
  it("uploads encrypted display names only for selected databases and retains remote-only labels", async () => {
    const settings = {
      ...config(),
      selectedItems: ["database:local"],
      encryptBeforeSync: true,
      syncEncryptionPassword: "PRIVATE_SYNC_PASSWORD",
    };
    mocks.capture.mockResolvedValue({
      version: 1,
      sections: { "database:local": { record: "local" } },
    });
    mocks.discover.mockResolvedValue([
      { id: "database:local", label: "Private local database" },
      { id: "database:remote", label: "Not selected locally" },
      { id: "database:excluded", label: "Never publish this label" },
    ]);
    const remote: CloudSyncSnapshot = {
      ...snapshot("unused"),
      payload: {
        version: 1,
        sections: { "database:remote": { record: "remote" } },
      },
      databaseNames: { remote: "Existing remote database" },
    };
    mocks.invoke.mockImplementation(async (command) =>
      command === "cloud_sync_read"
        ? { data: await encodeCloudSnapshot(remote, settings), revision: "v1" }
        : { revision: "v2" },
    );
    await runCloudSync(target(), settings);
    const write = mocks.invoke.mock.calls.find(
      ([command]) => command === "cloud_sync_write",
    )!;
    const uploaded = await decodeCloudSnapshot(write[1].data, settings);
    expect(uploaded.databaseNames).toEqual({
      local: "Private local database",
      remote: "Existing remote database",
    });
    expect(Buffer.from(write[1].data, "base64").toString()).not.toMatch(
      /Private local|Existing remote|Never publish/,
    );
    expect(uploaded.payload.sections["database:remote"]).toEqual(
      remote.payload.sections["database:remote"],
    );
  });

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

  it("recaptures an edit made during the read and uploads the newer copy once", async () => {
    mocks.capture
      .mockResolvedValueOnce(payload("dark"))
      .mockResolvedValue(payload("new-edit"));
    await expect(runCloudSync(target(), config())).resolves.toMatch(/uploaded/);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "cloud_sync_read",
      ),
    ).toHaveLength(2);
    const writes = mocks.invoke.mock.calls.filter(
      ([command]) => command === "cloud_sync_write",
    );
    expect(writes).toHaveLength(1);
    expect(
      (await decodeCloudSnapshot(writes[0][1].data, config())).payload,
    ).toEqual(payload("new-edit"));
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("bounds recapture when local edits continue and directs the user to review", async () => {
    let capture = 0;
    mocks.capture.mockImplementation(async () => payload(`edit-${++capture}`));
    await expect(runCloudSync(target(), config())).rejects.toThrow(
      /Local data changed.*Conflict Resolution/,
    );
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
      "cloud_sync_read",
    ]);
    expect(mocks.apply).not.toHaveBeenCalled();
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

  it("previews all conflicts without writes, private values or a persisted review", async () => {
    mocks.capture.mockResolvedValue(payload("private-local-value"));
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(
        snapshot("private-remote-value"),
        config(),
      ),
      revision: "v1",
    });
    const review = await reviewCloudSync(target(), config());
    expect(review.items).toEqual([
      expect.objectContaining({
        id: "app:settings",
        label: "Appearance preferences",
        state: "conflict",
        smartMergeAvailable: false,
      }),
    ]);
    expect(review.items[0].localBytes).toBeGreaterThan(0);
    expect(review.items[0].details).toMatchObject({
      hasBaseline: false,
      records: [expect.objectContaining({ kind: "preferences", different: 1 })],
      localRecordedAt: undefined,
      remoteSnapshotAt: expect.any(String),
    });
    expect(review.items[0].conflicts).toEqual([
      { code: "missing-baseline", kind: "other", count: 1 },
    ]);
    expect(JSON.stringify(review)).not.toMatch(
      /private-local-value|private-remote-value/,
    );
    expect(mocks.store.size).toBe(0);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
    ]);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it.each(["local", "remote", "selection", "identity"])(
    "rejects a reviewed choice when %s changes",
    async (change) => {
      let remote = {
        data: await encodeCloudSnapshot(snapshot("light"), config()),
        revision: "v1",
      };
      mocks.invoke.mockImplementation(async () => remote);
      const review = await reviewCloudSync(target(), config());
      const settings = config();
      if (change === "local")
        mocks.capture.mockResolvedValue(payload("new-local"));
      if (change === "remote")
        remote = {
          data: await encodeCloudSnapshot(snapshot("new-remote"), config()),
          revision: "v2",
        };
      if (change === "selection") settings.excludePatterns = ["private*"];
      if (change === "identity") invalidateCloudSyncTarget(target().id);
      mocks.invoke.mockClear();
      await expect(
        runCloudSync(target(), settings, {
          review,
          choices: { "app:settings": "keepRemote" },
        }),
      ).rejects.toThrow(/Refresh the conflict review/);
      expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
        "cloud_sync_read",
      ]);
      expect(mocks.apply).not.toHaveBeenCalled();
    },
  );

  it("requires a choice for every conflict, even with a global keep-remote policy", async () => {
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(snapshot("light"), config()),
      revision: "v1",
    });
    const settings = { ...config(), conflictResolution: "keepRemote" as const };
    const review = await reviewCloudSync(target(), settings);
    await expect(
      runCloudSync(target(), settings, { review, choices: {} }),
    ).rejects.toBeInstanceOf(CloudSyncConflict);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.every(
        ([command]) => command === "cloud_sync_read",
      ),
    ).toBe(true);
  });

  it("applies different reviewed choices per item without changing the configured strategy", async () => {
    const local = {
      version: 1 as const,
      sections: {
        "app:settings": { theme: "local" },
        "app:recording.terminal-macros": {
          version: 1,
          macros: [],
          label: "local",
        },
      },
    };
    const remote = {
      ...snapshot("remote"),
      payload: {
        version: 1 as const,
        sections: {
          "app:settings": { theme: "remote" },
          "app:recording.terminal-macros": {
            version: 1,
            macros: [],
            label: "remote",
          },
        },
      },
    };
    const settings = {
      ...config(),
      selectedItems: Object.keys(local.sections),
    };
    mocks.capture.mockResolvedValue(local);
    mocks.apply.mockImplementation(async (next) => {
      mocks.capture.mockResolvedValue({
        version: 1,
        sections: { ...local.sections, ...next.sections },
      });
    });
    mocks.invoke.mockImplementation(async (command) =>
      command === "cloud_sync_read"
        ? { data: await encodeCloudSnapshot(remote, settings), revision: "v1" }
        : { revision: "v2" },
    );
    const review = await reviewCloudSync(target(), settings);
    expect(
      review.items.filter((item) => item.state === "conflict"),
    ).toHaveLength(2);
    await runCloudSync(target(), settings, {
      review,
      choices: {
        "app:settings": "keepLocal",
        "app:recording.terminal-macros": "keepRemote",
      },
    });
    expect(settings.conflictResolution).toBe("askEveryTime");
    expect(mocks.apply.mock.calls[0][0].sections).toEqual({
      "app:recording.terminal-macros":
        remote.payload.sections["app:recording.terminal-macros"],
    });
    const write = mocks.invoke.mock.calls.find(
      ([command]) => command === "cloud_sync_write",
    )!;
    expect(write[1].expectedRevision).toBe("v1");
    const uploaded = (await decodeCloudSnapshot(write[1].data, settings))
      .payload;
    expect(uploaded.sections["app:settings"]).toEqual(
      local.sections["app:settings"],
    );
    expect(uploaded.sections["app:recording.terminal-macros"]).toEqual(
      remote.payload.sections["app:recording.terminal-macros"],
    );
  });

  it("smart-merges independent preference changes against the shared baseline", async () => {
    const base = {
      version: 1 as const,
      sections: { "app:settings": { theme: "dark", language: "en" } },
    };
    mocks.capture.mockResolvedValue(base);
    await runCloudSync(target(), config());
    mocks.capture.mockResolvedValue({
      version: 1,
      sections: { "app:settings": { theme: "light", language: "en" } },
    });
    const remote = {
      ...snapshot("dark"),
      payload: {
        version: 1 as const,
        sections: { "app:settings": { theme: "dark", language: "pt" } },
      },
    };
    mocks.invoke.mockImplementation(async (command) =>
      command === "cloud_sync_read"
        ? { data: await encodeCloudSnapshot(remote, config()), revision: "v2" }
        : { revision: "v3" },
    );
    const review = await reviewCloudSync(target(), config());
    expect(review.items[0].smartMergeAvailable).toBe(true);
    await runCloudSync(target(), {
      ...config(),
      conflictResolution: "smartMerge",
    });
    expect(mocks.apply.mock.calls[0][0]).toEqual({
      version: 1,
      sections: { "app:settings": { theme: "light", language: "pt" } },
    });
    expect(JSON.stringify([...mocks.store.values()])).not.toMatch(
      /"theme"|"language"|"light"/,
    );
  });

  it("smart merge never guesses for divergent edits without a shared baseline", async () => {
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(snapshot("light"), config()),
      revision: "v1",
    });
    await expect(
      runCloudSync(target(), { ...config(), conflictResolution: "smartMerge" }),
    ).rejects.toBeInstanceOf(CloudSyncConflict);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
    ]);
  });

  it("leaves both copies intact if a smart merge fails dependency validation", async () => {
    const base = {
      version: 1 as const,
      sections: { "app:settings": { theme: "dark", language: "en" } },
    };
    mocks.capture.mockResolvedValue(base);
    await runCloudSync(target(), config());
    mocks.invoke.mockClear();
    mocks.capture.mockResolvedValue({
      version: 1,
      sections: { "app:settings": { theme: "light", language: "en" } },
    });
    const remote = {
      ...snapshot("dark"),
      payload: {
        version: 1 as const,
        sections: { "app:settings": { theme: "dark", language: "pt" } },
      },
    };
    mocks.invoke.mockResolvedValue({
      data: await encodeCloudSnapshot(remote, config()),
      revision: "v2",
    });
    mocks.upgrade.mockImplementation(async (value) => {
      if (
        value.sections["app:settings"].theme === "light" &&
        value.sections["app:settings"].language === "pt"
      )
        throw new Error("PRIVATE_INVALID_REFERENCE");
      return value;
    });
    await expect(
      runCloudSync(target(), { ...config(), conflictResolution: "smartMerge" }),
    ).rejects.toThrow(/incompatible dependencies/);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "cloud_sync_read",
    ]);
    const review = await reviewCloudSync(target(), config());
    expect(review.items[0].smartMergeAvailable).toBe(false);
    expect(JSON.stringify(review)).not.toContain("PRIVATE_INVALID_REFERENCE");
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
