import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentScope } from "../../src/types/documents/document";
import {
  APP_DOCUMENTS_OWNER_ID,
  APP_DOCUMENTS_STORE_KEY,
  appDocumentsStore,
  createAppDocumentsStore,
} from "../../src/utils/documents/appDocumentsStore";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { fixture } from "./fixtures";

const native = vi.hoisted(() => ({ available: true, invoke: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => (native.available ? native.invoke : null),
}));

let disk: Map<string, string>;
const writes = () =>
  native.invoke.mock.calls.filter(
    ([command]) => command === "compare_and_swap_app_data",
  );
const backend = async (
  command: string,
  args: Record<string, string | null>,
) => {
  if (command === "read_app_data") return disk.get(args.key!) ?? null;
  if (command === "compare_and_swap_app_data") {
    if ((disk.get(args.key!) ?? null) !== args.expected) return false;
    disk.set(args.key!, args.replacement!);
    return true;
  }
  throw new Error(`Unexpected command: ${command}`);
};
function setup() {
  const controller = new AbortController();
  let accessible = true;
  const store = createAppDocumentsStore({
    generation: 17,
    signal: controller.signal,
    assertCurrent() {
      if (!accessible) throw new Error("Access changed");
    },
  });
  return {
    store,
    scope: store.scope!,
    controller,
    revoke: () => {
      accessible = false;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  native.available = true;
  disk = new Map();
  native.invoke.mockReset().mockImplementation(backend);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("app-wide document storage", () => {
  it("publishes explicit app ownership and reads an absent library without writes or database copying", async () => {
    disk.set("database.documents", JSON.stringify(fixture()));
    const before = new Map(disk);
    const { store, scope } = setup();
    expect(scope).toEqual({
      kind: "app",
      databaseId: APP_DOCUMENTS_OWNER_ID,
      generation: 17,
    });
    expect(appDocumentsStore.key).toBe(APP_DOCUMENTS_STORE_KEY);
    expect(await store.read(scope)).toEqual(emptyDatabaseDocuments());
    expect(disk).toEqual(before);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("read_app_data", {
      key: APP_DOCUMENTS_STORE_KEY,
    });
  });

  it("normalizes legacy records in memory without adding a ledger or auto-writing", async () => {
    const legacy = fixture();
    legacy.people = [
      {
        id: "person",
        name: "Person",
        email: "",
        phone: "",
        organization: "",
        notes: "",
        references: [],
      },
    ];
    const raw = JSON.stringify(legacy, null, 2);
    disk.set(APP_DOCUMENTS_STORE_KEY, raw);
    const { store, scope } = setup();
    const data = await store.read(scope);
    expect(data.people[0].tags).toEqual([]);
    expect(data).not.toHaveProperty("recordMetadata");
    expect(writes()).toHaveLength(0);
    expect(disk.get(APP_DOCUMENTS_STORE_KEY)).toBe(raw);
  });

  it("preserves attachment bytes, domain metadata and record history across verified CAS", async () => {
    const original = fixture();
    const attachment = await createDocumentAttachment(
      new TextEncoder().encode("private attachment"),
      "notes.txt",
      "text/plain",
    );
    original.attachments.push(attachment);
    original.documents[0].blocks.push({
      id: "file",
      type: "attachment",
      attachmentId: attachment.id,
      caption: "Keep caption",
    });
    const recordMetadata = await reconcileRecordLedger(original, undefined, {
      mode: "migrate",
    });
    disk.set(
      APP_DOCUMENTS_STORE_KEY,
      JSON.stringify({ ...original, recordMetadata }),
    );
    const { store, scope } = setup();
    const reviewed = await store.read(scope);
    expect(reviewed).toEqual(original);
    expect(writes()).toHaveLength(0);
    const next = structuredClone(reviewed);
    next.revision += 1;
    next.documents[0].name = "Edited title";
    await store.compareAndSwap(scope, reviewed, next);
    const saved = JSON.parse(disk.get(APP_DOCUMENTS_STORE_KEY)!);
    expect(saved.attachments).toEqual(original.attachments);
    expect(saved.documents[0]).toEqual({
      ...original.documents[0],
      name: "Edited title",
    });
    expect(
      saved.recordMetadata.journal.slice(0, recordMetadata.journal.length),
    ).toEqual(recordMetadata.journal);
    expect(saved.recordMetadata.records["$/attachments"]).toEqual(
      recordMetadata.records["$/attachments"],
    );
    expect(await store.read(scope)).toEqual(next);
    expect(store.changeRevision).toBe(1);
    expect(writes()).toHaveLength(1);
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "read_app_data",
      ).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("creates only the app library on an explicit edit and introduces its ledger in that same CAS", async () => {
    disk.set("database.documents", JSON.stringify(fixture()));
    const databaseRaw = disk.get("database.documents");
    const { store, scope } = setup();
    const empty = await store.read(scope);
    await store.compareAndSwap(scope, empty, { ...fixture(), revision: 1 });
    expect(JSON.parse(disk.get(APP_DOCUMENTS_STORE_KEY)!)).toHaveProperty(
      "recordMetadata.version",
      1,
    );
    expect(disk.get("database.documents")).toBe(databaseRaw);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1].expected).toBeNull();
  });

  it.each([undefined, "database"] as const)(
    "rejects %s database scopes even with the same owner ID and generation",
    async (kind) => {
      const { store, scope } = setup();
      const wrong: DocumentScope = { ...scope, kind };
      await expect(store.read(wrong)).rejects.toThrow(/access changed/);
      await expect(
        store.compareAndSwap(wrong, emptyDatabaseDocuments(), {
          ...fixture(),
          revision: 1,
        }),
      ).rejects.toThrow(/access changed/);
      expect(native.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects stale generations and caller mutation cannot rewrite the store's owner", async () => {
    const { store, scope } = setup();
    scope.generation += 1;
    await expect(store.read(scope)).rejects.toThrow(/access changed/);
    expect(store.scope?.generation).toBe(17);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("rejects changed contents even if another writer kept the same revision", async () => {
    const { store, scope } = setup();
    disk.set(APP_DOCUMENTS_STORE_KEY, JSON.stringify(fixture()));
    const reviewed = await store.read(scope);
    const concurrent = fixture();
    concurrent.documents[0].name = "Concurrent title";
    disk.set(APP_DOCUMENTS_STORE_KEY, JSON.stringify(concurrent));
    await expect(
      store.compareAndSwap(scope, reviewed, { ...reviewed, revision: 1 }),
    ).rejects.toThrow(/changed since/);
    expect(writes()).toHaveLength(0);
    expect(JSON.parse(disk.get(APP_DOCUMENTS_STORE_KEY)!)).toEqual(concurrent);
  });

  it("serializes app writers and refuses the second stale baseline", async () => {
    const first = setup(),
      second = setup();
    const empty = emptyDatabaseDocuments();
    const outcomes = await Promise.allSettled([
      first.store.compareAndSwap(first.scope, empty, {
        ...fixture(),
        revision: 1,
      }),
      second.store.compareAndSwap(second.scope, empty, {
        ...fixture(),
        revision: 1,
      }),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(writes()).toHaveLength(1);
  });

  it("never retries a refused native CAS even if the next read is unchanged", async () => {
    native.invoke.mockImplementation(async (command, args) =>
      command === "compare_and_swap_app_data" ? false : backend(command, args),
    );
    const { store, scope } = setup();
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toThrow(/changed since/);
    expect(writes()).toHaveLength(1);
    expect(disk.size).toBe(0);
  });

  it("reports committed but unverifiable writes without replay or rollback", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      const result = await backend(command, args);
      if (command === "compare_and_swap_app_data")
        disk.set(APP_DOCUMENTS_STORE_KEY, "concurrent state");
      return result;
    });
    const { store, scope } = setup();
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toMatchObject({ kind: "partial" });
    expect(disk.get(APP_DOCUMENTS_STORE_KEY)).toBe("concurrent state");
    expect(writes()).toHaveLength(1);
    expect(store.changeRevision).toBe(0);
  });

  it.each([
    "{private-broken-json",
    "null",
    '{"version":2}',
    JSON.stringify({ ...fixture(), unknown: true }),
    JSON.stringify({ ...fixture(), recordMetadata: { version: 2 } }),
  ])(
    "retains malformed storage without resetting or writing it (%#)",
    async (raw) => {
      disk.set(APP_DOCUMENTS_STORE_KEY, raw);
      const { store, scope } = setup();
      await expect(store.read(scope)).rejects.toThrow(/Invalid/);
      await expect(
        store.compareAndSwap(scope, fixture(), { ...fixture(), revision: 1 }),
      ).rejects.toThrow();
      expect(writes()).toHaveLength(0);
      expect(disk.get(APP_DOCUMENTS_STORE_KEY)).toBe(raw);
    },
  );

  it("retains the standard limits and forbids inherited connection folders on reads and writes", async () => {
    const { store, scope } = setup();
    const invalid = fixture();
    invalid.documents[0].name = "x".repeat(257);
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...invalid,
        revision: 1,
      }),
    ).rejects.toThrow(/Invalid/);
    const inFolder = fixture();
    inFolder.documents[0].parentFolderId = "connection-folder";
    const raw = JSON.stringify(inFolder);
    disk.set(APP_DOCUMENTS_STORE_KEY, raw);
    await expect(store.read(scope)).rejects.toThrow(/connection folders/);
    await expect(
      store.compareAndSwap(scope, fixture(), { ...inFolder, revision: 1 }),
    ).rejects.toThrow(/connection folders/);
    expect(disk.get(APP_DOCUMENTS_STORE_KEY)).toBe(raw);
    expect(writes()).toHaveLength(0);
  });

  it("verifies attachment hashes on reads and writes", async () => {
    const data = fixture();
    data.attachments.push({
      ...(await createDocumentAttachment(
        new TextEncoder().encode("attachment"),
        "notes.txt",
        "text/plain",
      )),
      sha256: "0".repeat(64),
    });
    const raw = JSON.stringify(data);
    disk.set(APP_DOCUMENTS_STORE_KEY, raw);
    const { store, scope } = setup();
    await expect(store.read(scope)).rejects.toThrow(/attachment/);
    await expect(
      store.compareAndSwap(scope, fixture(), { ...data, revision: 1 }),
    ).rejects.toThrow(/attachment/);
    expect(writes()).toHaveLength(0);
    expect(disk.get(APP_DOCUMENTS_STORE_KEY)).toBe(raw);
  });

  it.each(["read", "write"])(
    "discards a pending %s when its lease is revoked",
    async (operation) => {
      let finish!: (raw: string | null) => void;
      native.invoke.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { store, scope, controller } = setup();
      const pending =
        operation === "read"
          ? store.read(scope)
          : store.compareAndSwap(scope, emptyDatabaseDocuments(), {
              ...fixture(),
              revision: 1,
            });
      const rejected = expect(pending).rejects.toThrow(/access changed/i);
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      controller.abort();
      finish(null);
      await rejected;
      expect(store.scope).toBeNull();
      expect(writes()).toHaveLength(0);
    },
  );

  it("checks live access before I/O even if the abort signal was not yet delivered", async () => {
    const { store, scope, revoke } = setup();
    revoke();
    await expect(store.read(scope)).rejects.toThrow(/Access changed/);
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toThrow(/Access changed/);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("reports a lock after commit as partial and never retries", async () => {
    const { store, scope, controller } = setup();
    native.invoke.mockImplementation(async (command, args) => {
      const result = await backend(command, args);
      if (command === "compare_and_swap_app_data") controller.abort();
      return result;
    });
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toMatchObject({ kind: "partial" });
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(disk.get(APP_DOCUMENTS_STORE_KEY)!)).toHaveProperty(
      "revision",
      1,
    );
  });

  it("never uses browser persistence when native storage is absent", async () => {
    native.available = false;
    const readBrowser = vi.spyOn(IndexedDbService, "getItemStrict");
    const writeBrowser = vi.spyOn(IndexedDbService, "transactItemsStrict");
    const localRead = vi.spyOn(Storage.prototype, "getItem");
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    const { store, scope } = setup();
    await expect(store.read(scope)).rejects.toThrow(/desktop app/);
    await expect(
      store.compareAndSwap(scope, emptyDatabaseDocuments(), {
        ...fixture(),
        revision: 1,
      }),
    ).rejects.toThrow(/desktop app/);
    expect(readBrowser).not.toHaveBeenCalled();
    expect(writeBrowser).not.toHaveBeenCalled();
    expect(localRead).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
