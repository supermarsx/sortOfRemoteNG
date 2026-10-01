import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  APP_DATA_STORE_CHANGED_EVENT,
  AppDataJsonStore,
  sanitizeWithRecordMetadata,
} from "../../src/utils/storage/appDataJsonStore";
import {
  normalizeRecordLedger,
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import {
  managedScriptsStore,
  nativeManagedScriptsStore,
} from "../../src/utils/recording/managedScriptPersistence";
import { terminalMacrosStore } from "../../src/utils/recording/terminalMacroPersistence";
import {
  normalizeWebAutomationLibrary,
  webAutomationStore,
} from "../../src/utils/recording/webAutomationLibrary";
import { bulkScriptsStore } from "../../src/hooks/ssh/bulkScriptLibrary";

const bridge = vi.hoisted(() => ({ native: true, invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (bridge.native ? bridge.invoke : null),
}));

const CREATED = "2024-01-02T03:04:05.000Z";
const MODIFIED = "2024-02-03T04:05:06.000Z";
const NOW = "2026-10-01T12:00:00.000Z";
const KEY = "test.global-record-ledger";
const LEGACY = "test.global-record-ledger.legacy";
interface Snapshot {
  version: 1;
  items: { id: string; body: string; createdAt?: string; updatedAt?: string }[];
  timestamp?: number;
  recordMetadata?: RecordLedger;
}
const snapshot = (): Snapshot => ({
  version: 1,
  items: [
    {
      id: "a",
      body: "private payload",
      createdAt: CREATED,
      updatedAt: MODIFIED,
    },
  ],
});
const store = (backend: "app-data" | "macro-library" = "app-data") =>
  new AppDataJsonStore<Snapshot>({
    key: KEY,
    legacyLocalStorageKey: LEGACY,
    backend,
    trackRecords: true,
    sanitize(value) {
      const raw = value as Snapshot;
      if (
        !raw ||
        Object.keys(raw).some(
          (key) => !["version", "items", "timestamp"].includes(key),
        ) ||
        raw.version !== 1 ||
        !Array.isArray(raw.items)
      )
        throw new Error("Invalid domain snapshot");
      return { value: structuredClone(raw), changed: false };
    },
  });

let disk: Map<string, string>;
const writes = () =>
  bridge.invoke.mock.calls.filter(([command]) =>
    command.startsWith("compare_and_swap"),
  );
const current = () => JSON.parse(disk.get(KEY)!) as Snapshot;
const seed = async (value = snapshot()) => {
  const recordMetadata = await reconcileRecordLedger(value, undefined, {
    mode: "migrate",
  });
  disk.set(KEY, JSON.stringify({ ...value, recordMetadata }));
  return recordMetadata;
};

beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  bridge.native = true;
  disk = new Map();
  localStorage.removeItem(LEGACY);
  await IndexedDbService.removeItemStrict(KEY);
  bridge.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "read_app_data" || command === "read_macro_library")
      return disk.get(args.key) ?? null;
    if (
      command === "compare_and_swap_app_data" ||
      command === "compare_and_swap_macro_library"
    ) {
      if ((disk.get(args.key) ?? null) !== args.expected) return false;
      disk.set(args.key, args.replacement);
      return true;
    }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(LEGACY);
});

describe("global object snapshot record ledgers", () => {
  it.each(["app-data", "macro-library"] as const)(
    "migrates %s once inside the data CAS, preserving legacy dates",
    async (backend) => {
      const legacy = JSON.stringify(snapshot());
      disk.set(KEY, legacy);
      const migrated = await store(backend).load();
      expect(migrated.sanitized).toBe(true);
      expect(writes()).toHaveLength(1);
      expect(writes()[0][1].expected).toBe(legacy);
      expect(current()).toEqual(migrated.value);
      expect(
        migrated.value?.recordMetadata?.records["$/items/@a"],
      ).toMatchObject({
        createdAt: CREATED,
        updatedAt: MODIFIED,
        createdAtSource: "record",
        updatedAtSource: "record",
      });
      expect(migrated.value?.recordMetadata?.records.$.createdAt).toBe(
        "1970-01-01T00:00:00.000Z",
      );
      expect(JSON.stringify(migrated.value?.recordMetadata)).not.toContain(
        "private payload",
      );
      const durable = disk.get(KEY);
      vi.setSystemTime("2028-01-01T00:00:00.000Z");
      expect(await store(backend).load()).toEqual({
        value: migrated.value,
        sanitized: false,
      });
      expect(disk.get(KEY)).toBe(durable);
      expect(writes()).toHaveLength(1);
    },
  );

  it("migrates a browser legacy source before cleaning it up, without creating a sidecar", async () => {
    bridge.native = false;
    localStorage.setItem(LEGACY, JSON.stringify(snapshot()));
    const loaded = await store().load();
    expect(loaded.value?.recordMetadata?.version).toBe(1);
    expect(
      JSON.parse((await IndexedDbService.getItemStrict<string>(KEY))!),
    ).toEqual(loaded.value);
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(await store().load()).toEqual({
      value: loaded.value,
      sanitized: false,
    });
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("does not write or emit changes for a no-op load, save, or update", async () => {
    const ledger = await seed();
    const changed = vi.spyOn(window, "dispatchEvent");
    const loaded = await store().load();
    await store().save(snapshot());
    await store().update((value) => value!);
    expect(current().recordMetadata).toEqual(ledger);
    expect(loaded.sanitized).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(
      changed.mock.calls.filter(
        ([event]) => event.type === APP_DATA_STORE_CHANGED_EVENT,
      ),
    ).toHaveLength(0);
  });

  it("retains durable creation and history across updates, new records, deletion, and restore", async () => {
    const prior = await seed();
    await store().save({
      version: 1,
      items: [
        {
          ...snapshot().items[0],
          body: "edited",
          createdAt: NOW,
          updatedAt: NOW,
        },
        { id: "b", body: "new private value" },
      ],
    });
    const edited = current().recordMetadata!;
    expect(edited.records["$/items/@a"]).toMatchObject({
      createdAt: CREATED,
      updatedAt: NOW,
    });
    expect(edited.records["$/items/@b"]).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
      createdAtSource: "observed",
    });
    expect(edited.journal).toEqual(expect.arrayContaining(prior.journal));
    await store().update((value) => ({
      ...value!,
      items: value!.items.filter((item) => item.id !== "a"),
    }));
    const removed = current().recordMetadata!;
    expect(removed.records["$/items/@a"].deletedAt).toBeDefined();
    expect(removed.journal).toContainEqual(
      expect.objectContaining({
        record: "$/items/@a",
        kind: "delete",
        parentRevision: edited.records["$/items/@a"].revision,
      }),
    );
    await store().update((value) => ({
      ...value!,
      items: [...value!.items, snapshot().items[0]],
    }));
    const restored = current().recordMetadata!;
    expect(restored.records["$/items/@a"].createdAt).toBe(CREATED);
    expect(restored.records["$/items/@a"].deletedAt).toBeUndefined();
    expect(restored.journal).toContainEqual(
      expect.objectContaining({ record: "$/items/@a", kind: "restore" }),
    );
    expect(JSON.stringify(restored)).not.toMatch(
      /private value|private payload|edited/,
    );
  });

  it("uses the durable ledger even if the caller provides a different valid ledger or mutates the transform input", async () => {
    const prior = await seed();
    const forged = await reconcileRecordLedger(snapshot(), undefined, {
      mode: "write",
      now: MODIFIED,
    });
    await store().update((value) => {
      value!.recordMetadata = forged;
      value!.items[0].body = "locally edited";
      return value!;
    });
    expect(current().recordMetadata!.records["$/items/@a"].createdAt).toBe(
      CREATED,
    );
    expect(current().recordMetadata!.journal).toEqual(
      expect.arrayContaining(prior.journal),
    );
    expect(current().recordMetadata!.journal).not.toEqual(
      expect.arrayContaining(forged.journal),
    );
  });

  it("migrates the previous durable snapshot in memory when saving before its first load", async () => {
    disk.set(KEY, JSON.stringify(snapshot()));
    await store().save({ version: 1, items: [] });
    expect(writes()).toHaveLength(1);
    expect(current().recordMetadata!.records["$/items/@a"]).toMatchObject({
      createdAt: CREATED,
      deletedAt: NOW,
    });
  });

  it("ignores root timestamps for all ledger hashes and revisions", async () => {
    const prior = await seed({ ...snapshot(), timestamp: 1 });
    await store().update((value) => ({ ...value!, timestamp: 2 }));
    expect(current().recordMetadata).toEqual(prior);
  });

  it("rejects a stale snapshot CAS without retrying or replacing the winner", async () => {
    await seed();
    const winner = JSON.stringify({ ...snapshot(), items: [] });
    const implementation = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command.startsWith("compare_and_swap")) {
        disk.set(KEY, winner);
        return false;
      }
      return implementation(command, args);
    });
    await expect(
      store().save({ version: 1, items: [{ id: "lost", body: "stale" }] }),
    ).rejects.toThrow(/changed.*Reload/);
    expect(writes()).toHaveLength(1);
    expect(disk.get(KEY)).toBe(winner);
  });

  it("rebases local transforms onto a valid concurrent ledger without retaining failed-attempt history", async () => {
    const initial = await seed();
    const concurrent = {
      ...snapshot(),
      items: [...snapshot().items, { id: "b", body: "another window" }],
    };
    const concurrentLedger = await reconcileRecordLedger(concurrent, initial, {
      mode: "write",
      now: MODIFIED,
    });
    const implementation = bridge.invoke.getMockImplementation()!;
    let conflict = true;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command.startsWith("compare_and_swap") && conflict) {
        conflict = false;
        disk.set(
          KEY,
          JSON.stringify({ ...concurrent, recordMetadata: concurrentLedger }),
        );
        return false;
      }
      return implementation(command, args);
    });
    const transform = vi.fn((value: Snapshot | null): Snapshot => ({
      ...value!,
      items: [...value!.items, { id: "c", body: "this window" }],
    }));
    await store().update(transform);
    expect(transform).toHaveBeenCalledTimes(2);
    expect(current().items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(current().recordMetadata!.journal).toEqual(
      expect.arrayContaining(concurrentLedger.journal),
    );
    expect(
      current().recordMetadata!.journal.filter(
        (entry) => entry.record === "$/items/@c",
      ),
    ).toHaveLength(1);
  });

  it("adopts matching remote history exactly, including its deletes", async () => {
    await seed();
    const remoteInitial = await reconcileRecordLedger(snapshot(), undefined, {
      mode: "write",
      now: CREATED,
    });
    const remote = { version: 1 as const, items: [] };
    const recordMetadata = await reconcileRecordLedger(remote, remoteInitial, {
      mode: "write",
      now: MODIFIED,
    });
    await store().update(() => ({ ...remote, recordMetadata }), undefined, {
      adoptRecordMetadata: true,
    });
    expect(current().recordMetadata).toEqual(recordMetadata);
    expect(current().recordMetadata!.records["$/items/@a"].deletedAt).toBe(
      MODIFIED,
    );
  });

  it("deterministically migrates remote data with no ledger, independently of local history and the clock", async () => {
    await seed();
    const remote: Snapshot = {
      version: 1,
      items: [{ id: "remote", body: "remote private data" }],
    };
    const applied = await store().update(() => remote, undefined, {
      adoptRecordMetadata: true,
    });
    const first = applied.value.recordMetadata;
    expect(first!.records["$/items/@remote"].createdAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(first!.records["$/items/@a"]).toBeUndefined();
    vi.setSystemTime("2030-10-01T12:00:00.000Z");
    await store().update(() => remote, undefined, {
      adoptRecordMetadata: true,
    });
    expect(current().recordMetadata).toEqual(first);
    expect(writes()).toHaveLength(1);
  });

  it("rejects malformed, mismatching, or sanitized-away remote metadata before writing", async () => {
    const recordMetadata = await seed();
    const before = disk.get(KEY);
    await expect(
      store().update(
        () => ({
          ...snapshot(),
          recordMetadata: {
            ...recordMetadata,
            version: 2,
          } as unknown as RecordLedger,
        }),
        undefined,
        { adoptRecordMetadata: true },
      ),
    ).rejects.toThrow(/ledger/);
    await expect(
      store().update(
        () => ({ version: 1, items: [], recordMetadata }),
        undefined,
        { adoptRecordMetadata: true },
      ),
    ).rejects.toThrow(/match/);
    const library = {
      customScripts: [
        {
          id: "unsafe",
          name: "Fixture",
          description: "",
          category: "Custom",
          language: "bash" as const,
          osTags: [],
          createdAt: CREATED,
          updatedAt: MODIFIED,
          script: "curl --token=private-token",
        },
      ],
      modifiedDefaults: [],
      deletedDefaultIds: [],
    };
    const unsafeMetadata = await reconcileRecordLedger(library);
    await expect(
      managedScriptsStore.update(
        () => ({ ...library, recordMetadata: unsafeMetadata }),
        undefined,
        { adoptRecordMetadata: true },
      ),
    ).rejects.toThrow(/match/);
    expect(disk.get(KEY)).toBe(before);
    expect(writes()).toHaveLength(0);
  });

  it("rejects a remote apply CAS conflict without a second transform or write", async () => {
    await seed();
    const implementation = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) =>
      command.startsWith("compare_and_swap")
        ? false
        : implementation(command, args),
    );
    const transform = vi.fn((): Snapshot => ({ version: 1, items: [] }));
    await expect(
      store().update(transform, undefined, { adoptRecordMetadata: true }),
    ).rejects.toThrow(/Reload and review/);
    expect(transform).toHaveBeenCalledOnce();
    expect(writes()).toHaveLength(1);
    expect(current().items).toEqual(snapshot().items);
  });

  it.each(["load", "save", "update"] as const)(
    "retains durable and legacy bytes when %s encounters a locked read",
    async (operation) => {
      const before = JSON.stringify(snapshot());
      disk.set(KEY, before);
      localStorage.setItem(LEGACY, before);
      bridge.invoke.mockRejectedValue(
        new Error("Encryption required: store locked"),
      );
      const value = store("macro-library");
      await expect(
        operation === "load"
          ? value.load()
          : operation === "save"
            ? value.save(snapshot())
            : value.update((current) => current!),
      ).rejects.toThrow(/locked/);
      expect(disk.get(KEY)).toBe(before);
      expect(localStorage.getItem(LEGACY)).toBe(before);
      expect(bridge.invoke).toHaveBeenCalledOnce();
      expect(writes()).toHaveLength(0);
      expect(await IndexedDbService.getItemStrict(KEY)).toBeNull();
    },
  );

  it("does not retry locked migration writes or verification failures", async () => {
    const before = JSON.stringify(snapshot());
    disk.set(KEY, before);
    localStorage.setItem(LEGACY, before);
    const implementation = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (command.startsWith("compare_and_swap"))
        throw new Error("Store locked");
      return implementation(command, args);
    });
    await expect(store().load()).rejects.toThrow(/locked/);
    expect(writes()).toHaveLength(1);
    expect(disk.get(KEY)).toBe(before);
    expect(localStorage.getItem(LEGACY)).toBe(before);
    bridge.invoke.mockReset().mockImplementation(implementation);
    await seed();
    let committed = false;
    bridge.invoke.mockImplementation(async (command, args) => {
      if (committed && command.startsWith("read_"))
        throw new Error("Store locked during verification");
      const result = await implementation(command, args);
      if (command.startsWith("compare_and_swap")) committed = true;
      return result;
    });
    const transform = vi.fn((): Snapshot => ({ version: 1, items: [] }));
    await expect(
      store().update(transform, undefined, { adoptRecordMetadata: true }),
    ).rejects.toThrow(/verification/);
    expect(transform).toHaveBeenCalledOnce();
    expect(writes()).toHaveLength(1);
    expect(current().items).toEqual([]);
    expect(localStorage.getItem(LEGACY)).toBe(before);
  });

  it("rechecks the access lease after asynchronous hashing and before CAS", async () => {
    await seed();
    const controller = new AbortController();
    await expect(
      store().update(
        (value) => {
          controller.abort();
          return { ...value!, items: [] };
        },
        { signal: controller.signal, assertCurrent: () => {} },
      ),
    ).rejects.toThrow(/access changed/);
    expect(writes()).toHaveLength(0);
  });

  it("keeps pure normalization read-only and passes only domain data to strict sanitizers", async () => {
    const recordMetadata = await reconcileRecordLedger(snapshot());
    const sanitize = vi.fn((value: unknown) => ({ value, changed: false }));
    const normalized = sanitizeWithRecordMetadata(
      { ...snapshot(), recordMetadata },
      sanitize,
    );
    expect(sanitize).toHaveBeenCalledWith(snapshot());
    expect(normalized.value).toEqual({ ...snapshot(), recordMetadata });
    expect(normalizeRecordLedger(recordMetadata)).toEqual(recordMetadata);
    const website = { version: 1 as const, scripts: [], macros: [] };
    const websiteMetadata = await reconcileRecordLedger(website);
    expect(
      normalizeWebAutomationLibrary({
        ...website,
        recordMetadata: websiteMetadata,
      }),
    ).toEqual({ ...website, recordMetadata: websiteMetadata });
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("leaves array stores unchanged and rejects tracking an array without an envelope", async () => {
    const arrays = new AppDataJsonStore<string[]>({
      key: KEY,
      sanitize: (value) => ({ value: value as string[], changed: false }),
    });
    await arrays.save(["one"]);
    expect(JSON.parse(disk.get(KEY)!)).toEqual(["one"]);
    const tracked = new AppDataJsonStore<string[]>({
      key: KEY,
      trackRecords: true,
      sanitize: (value) => ({ value: value as string[], changed: false }),
    });
    await expect(tracked.load()).rejects.toThrow(/object snapshot/);
    expect(JSON.parse(disk.get(KEY)!)).toEqual(["one"]);
  });
});

describe("object library tracking opt-ins", () => {
  const managed = {
    customScripts: [],
    modifiedDefaults: [],
    deletedDefaultIds: [],
  };
  const terminal = { version: 1 as const, macros: [], legacyDigest: null };
  const website = { version: 1 as const, scripts: [], macros: [] };
  const bulk = {
    version: 2 as const,
    active: [],
    trash: [],
    config: {
      runConfirmation: "destructive-only" as const,
      deleteConfirmation: "permanent-only" as const,
    },
  };
  it.each([
    { store: managedScriptsStore, value: managed },
    { store: nativeManagedScriptsStore, value: managed },
    { store: terminalMacrosStore, value: terminal },
    { store: webAutomationStore, value: website },
    { store: bulkScriptsStore, value: bulk },
  ])(
    "migrates and reloads $store.key without ledger loss or churn",
    async ({ store, value }) => {
      disk.set(store.key, JSON.stringify(value));
      const first = await store.load();
      expect(first.value?.recordMetadata?.version).toBe(1);
      expect(await store.load()).toEqual({
        value: first.value,
        sanitized: false,
      });
      expect(writes()).toHaveLength(1);
      expect(JSON.parse(disk.get(store.key)!).recordMetadata).toEqual(
        first.value?.recordMetadata,
      );
    },
  );
});
