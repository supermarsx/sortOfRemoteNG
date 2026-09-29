import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IDBPDatabase, openDB } from "idb";

const mocks = vi.hoisted(() => ({ openDB: vi.fn(), unwrap: vi.fn() }));
vi.mock("idb", () => mocks);

type Lifecycle = NonNullable<Parameters<typeof openDB>[2]>;
let IndexedDbService: typeof import("../../src/utils/storage/indexedDbService").IndexedDbService;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function connection() {
  return {
    get: vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValue('{"ok":true}'),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

function lifecycle(index = 0): Lifecycle {
  return mocks.openDB.mock.calls[index][2] as Lifecycle;
}

function blocking(index = 0) {
  lifecycle(index).blocking!(1, 2, {} as IDBVersionChangeEvent);
}

const closed = () =>
  new DOMException("Connection is closing", "InvalidStateError");

beforeEach(async () => {
  vi.resetModules();
  mocks.openDB.mockReset();
  mocks.unwrap.mockReset();
  localStorage.clear();
  ({ IndexedDbService } =
    await import("../../src/utils/storage/indexedDbService"));
});

describe("IndexedDB connection recovery", () => {
  it("shares one pending open across concurrent initializers and reads", async () => {
    const pending = deferred<ReturnType<typeof connection>>();
    const db = connection();
    mocks.openDB.mockReturnValue(pending.promise);
    const calls = [
      IndexedDbService.init(),
      IndexedDbService.init(),
      IndexedDbService.getItemStrict("macro"),
    ];
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
    expect(mocks.openDB).toHaveBeenCalledWith(
      "mremote-keyval",
      1,
      expect.any(Object),
    );
    pending.resolve(db);
    await expect(Promise.all(calls)).resolves.toEqual([
      undefined,
      undefined,
      { ok: true },
    ]);
    await IndexedDbService.init();
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
  });

  it("propagates a shared open failure and permits a later single-flight attempt", async () => {
    const pending = deferred<ReturnType<typeof connection>>();
    const error = new Error("storage unavailable");
    mocks.openDB
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(connection());
    const first = IndexedDbService.init();
    const second = IndexedDbService.getItemStrict("macro");
    const results = Promise.allSettled([first, second]);
    pending.reject(error);
    expect(await results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
    await Promise.all([IndexedDbService.init(), IndexedDbService.init()]);
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it("also permits recovery after a synchronous open failure", async () => {
    const error = new Error("open threw");
    mocks.openDB
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockResolvedValue(connection());
    await expect(IndexedDbService.getItemStrict("macro")).rejects.toBe(error);
    await expect(IndexedDbService.getItemStrict("macro")).resolves.toEqual({
      ok: true,
    });
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it("invalidates terminated connections without letting stale events evict replacements", async () => {
    const old = connection();
    const fresh = connection();
    mocks.openDB.mockResolvedValueOnce(old).mockResolvedValue(fresh);
    await IndexedDbService.init();
    lifecycle().terminated!();
    await IndexedDbService.init();
    lifecycle().terminated!();
    blocking();
    await IndexedDbService.init();
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(fresh.close).not.toHaveBeenCalled();
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it("closes a blocking connection to release an upgrade and opens afresh next time", async () => {
    const old = connection();
    mocks.openDB.mockResolvedValueOnce(old).mockResolvedValue(connection());
    await IndexedDbService.init();
    blocking();
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
    await IndexedDbService.init();
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it("releases a blocking handle even before the service observes open resolution", async () => {
    const pending = deferred<ReturnType<typeof connection>>();
    const old = connection();
    mocks.openDB
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(connection());
    const first = IndexedDbService.init();
    blocking();
    await IndexedDbService.init();
    pending.resolve(old);
    await first;
    expect(old.close).toHaveBeenCalledTimes(1);
    await IndexedDbService.init();
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it("does not clear a newer cached open when an obsolete open rejects", async () => {
    const pending = deferred<ReturnType<typeof connection>>();
    mocks.openDB
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(connection());
    const first = IndexedDbService.init();
    const failure = expect(first).rejects.toThrow("old failure");
    lifecycle().terminated!();
    await IndexedDbService.init();
    pending.reject(new Error("old failure"));
    await failure;
    await IndexedDbService.init();
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it.each(["throw", "reject"])(
    "reopens a read once after an InvalidStateError (%s)",
    async (mode) => {
      const old = connection();
      const fresh = connection();
      old.get.mockImplementationOnce(() => {
        if (mode === "throw") throw closed();
        return Promise.reject(closed());
      });
      mocks.openDB.mockResolvedValueOnce(old).mockResolvedValue(fresh);
      await expect(IndexedDbService.getItemStrict("macro")).resolves.toEqual({
        ok: true,
      });
      expect(old.get).toHaveBeenCalledExactlyOnceWith("keyval", "macro");
      expect(fresh.get).toHaveBeenCalledExactlyOnceWith("keyval", "macro");
      expect(old.close).toHaveBeenCalledTimes(1);
      expect(mocks.openDB).toHaveBeenCalledTimes(2);
    },
  );

  it("shares the replacement for overlapping failed reads, including a late old rejection", async () => {
    const old = connection();
    const fresh = connection();
    const late = deferred<string | undefined>();
    old.get.mockRejectedValueOnce(closed()).mockReturnValueOnce(late.promise);
    mocks.openDB.mockResolvedValueOnce(old).mockResolvedValue(fresh);
    const first = IndexedDbService.getItemStrict("first");
    const second = IndexedDbService.getItemStrict("second");
    await first;
    late.reject(closed());
    await second;
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
    expect(fresh.get).toHaveBeenCalledTimes(2);
  });

  it("bounds each read to two attempts and invalidates the failed replacement", async () => {
    const old = connection();
    const fresh = connection();
    const error = closed();
    old.get.mockRejectedValue(closed());
    fresh.get.mockRejectedValue(error);
    mocks.openDB
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValue(connection());
    await expect(IndexedDbService.getItemStrict("macro")).rejects.toBe(error);
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
    expect(old.get).toHaveBeenCalledTimes(1);
    expect(fresh.get).toHaveBeenCalledTimes(1);
    expect(fresh.close).toHaveBeenCalledTimes(1);
    await IndexedDbService.getItemStrict("later");
    expect(mocks.openDB).toHaveBeenCalledTimes(3);
  });

  it("propagates failure to open the replacement without another retry", async () => {
    const old = connection();
    const error = closed();
    old.get.mockRejectedValue(closed());
    mocks.openDB.mockResolvedValueOnce(old).mockRejectedValue(error);
    await expect(IndexedDbService.getItemStrict("macro")).rejects.toBe(error);
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });

  it.each([
    "AbortError",
    "NotFoundError",
    "UnknownError",
    "TransactionInactiveError",
    "Error",
  ])("preserves %s without recovery", async (name) => {
    const db = connection();
    const error = new DOMException("database closed", name);
    db.get.mockRejectedValue(error);
    mocks.openDB.mockResolvedValue(db);
    await expect(IndexedDbService.getItemStrict("macro")).rejects.toBe(error);
    expect(db.get).toHaveBeenCalledTimes(1);
    expect(db.close).not.toHaveBeenCalled();
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
  });

  it("preserves corrupt JSON errors and missing-record semantics", async () => {
    const db = connection();
    db.get.mockResolvedValueOnce("not json").mockResolvedValueOnce(undefined);
    mocks.openDB.mockResolvedValue(db);
    await expect(
      IndexedDbService.getItemStrict("corrupt"),
    ).rejects.toBeInstanceOf(SyntaxError);
    await expect(IndexedDbService.getItemStrict("missing")).resolves.toBeNull();
    expect(db.get).toHaveBeenCalledTimes(2);
    expect(db.close).not.toHaveBeenCalled();
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
  });

  it.each(["put", "delete"] as const)(
    "never replays a failed %s",
    async (method) => {
      const db = connection();
      const error = closed();
      db[method].mockRejectedValue(error);
      mocks.openDB.mockResolvedValue(db);
      const operation =
        method === "put"
          ? IndexedDbService.setItemStrict("macro", { a: 1 })
          : IndexedDbService.removeItemStrict("macro");
      await expect(operation).rejects.toBe(error);
      expect(db[method]).toHaveBeenCalledTimes(1);
      expect(mocks.openDB).toHaveBeenCalledTimes(1);
    },
  );

  it("never replays a transaction whose creation fails", async () => {
    const error = closed();
    const transaction = vi.fn(() => {
      throw error;
    });
    mocks.openDB.mockResolvedValue(connection());
    mocks.unwrap.mockReturnValue({ transaction });
    const transform = vi.fn(() => ({ set: {}, result: 1 }));
    await expect(
      IndexedDbService.transactItemsStrict([], transform),
    ).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledExactlyOnceWith("keyval", "readwrite");
    expect(transform).not.toHaveBeenCalled();
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
  });

  it("never replays a transform or writes when an in-flight transaction aborts", async () => {
    const error = closed();
    const store = { put: vi.fn(), delete: vi.fn() };
    const tx = {
      objectStore: vi.fn(() => store),
      error,
      onabort: null as (() => void) | null,
    };
    const transaction = vi.fn(() => tx);
    mocks.openDB.mockResolvedValue(connection());
    mocks.unwrap.mockReturnValue({ transaction });
    const started = deferred<void>();
    const transform = vi.fn(() => {
      started.resolve();
      return { set: { macro: { a: 1 } }, remove: ["old"], result: 1 };
    });
    const operation = IndexedDbService.transactItemsStrict([], transform);
    const rejection = expect(operation).rejects.toBe(error);
    await started.promise;
    tx.onabort!();
    await rejection;
    expect(transform).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledExactlyOnceWith('{"a":1}', "macro");
    expect(store.delete).toHaveBeenCalledExactlyOnceWith("old");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mocks.openDB).toHaveBeenCalledTimes(1);
  });

  it("keeps schema creation conditional during upgrades", async () => {
    mocks.openDB.mockResolvedValue(connection());
    await IndexedDbService.init();
    const db = {
      objectStoreNames: {
        contains: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      },
      createObjectStore: vi.fn(),
    };
    const upgrade = lifecycle().upgrade!;
    upgrade(
      db as unknown as IDBPDatabase,
      0,
      1,
      {} as never,
      {} as IDBVersionChangeEvent,
    );
    upgrade(
      db as unknown as IDBPDatabase,
      0,
      1,
      {} as never,
      {} as IDBVersionChangeEvent,
    );
    expect(db.createObjectStore).toHaveBeenCalledExactlyOnceWith("keyval");
  });
});
