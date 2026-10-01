import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDatabaseSizes,
  formatDatabaseBytes,
} from "../../src/utils/connection/databaseSize";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getInvoke: vi.fn(),
  bytes: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: mocks.getInvoke }));
vi.mock("../../src/utils/storage/indexedDbService", () => ({
  IndexedDbService: { getItemByteLengthStrict: mocks.bytes },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getInvoke.mockResolvedValue(mocks.invoke);
  mocks.bytes.mockResolvedValue(null);
  mocks.invoke.mockImplementation(async (_command, args) =>
    args.databaseIds.map((databaseId: string) => ({
      databaseId,
      bytes: 4096,
      status: "measured",
    })),
  );
});

describe("readDatabaseSizes", () => {
  it("batches deduplicated IDs, maps replies by ID, and accepts native Unicode IDs", async () => {
    mocks.invoke.mockResolvedValue([
      { databaseId: "数据库 Test", status: "measured", bytes: 8192 },
      { databaseId: "db1", status: "measured", bytes: 0 },
    ]);
    expect(await readDatabaseSizes(["db1", "数据库 Test", "db1"])).toEqual({
      db1: { status: "measured", bytes: 0, source: "stored-file" },
      "数据库 Test": { status: "measured", bytes: 8192, source: "stored-file" },
    });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "get_database_file_sizes",
      {
        databaseIds: ["db1", "数据库 Test"],
      },
    );
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it("splits large lists at the native limit, while retaining every row", async () => {
    const ids = Array.from({ length: 513 }, (_, index) => `db-${index}`);
    const sizes = await readDatabaseSizes(ids);
    expect(
      mocks.invoke.mock.calls.map(([, args]) => args.databaseIds.length),
    ).toEqual([256, 256, 1]);
    expect(Object.keys(sizes)).toHaveLength(513);
    expect(Object.values(sizes).every((size) => size.bytes === 4096)).toBe(
      true,
    );
  });

  it("does not call the backend for an empty inventory", async () => {
    expect(await readDatabaseSizes([])).toEqual({});
    expect(mocks.getInvoke).not.toHaveBeenCalled();
  });

  it.each([
    "../escape",
    "a/b",
    "a\\b",
    "",
    "INDEX",
    "NUL",
    "COM1",
    "LPT9",
    "a".repeat(129),
    "界".repeat(43),
    " padded ",
  ])(
    "rejects unsafe/reserved database IDs without reading a path: %s",
    async (id) => {
      expect((await readDatabaseSizes([id]))[id]).toMatchObject({
        status: "unavailable",
      });
      expect(mocks.invoke).not.toHaveBeenCalled();
      expect(mocks.bytes).not.toHaveBeenCalled();
    },
  );

  it("handles prototype-named IDs as data, never object properties", async () => {
    const sizes = await readDatabaseSizes(["__proto__", "constructor"]);
    expect(Object.keys(sizes)).toEqual(["__proto__", "constructor"]);
    expect(sizes["__proto__"].bytes).toBe(4096);
  });

  it.each([
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "123",
    null,
    undefined,
  ])("does not display malformed byte counts: %s", async (bytes) => {
    mocks.invoke.mockResolvedValue([
      { databaseId: "db1", status: "measured", bytes },
    ]);
    expect((await readDatabaseSizes(["db1"])).db1).toMatchObject({
      status: "unavailable",
    });
    expect((await readDatabaseSizes(["db1"])).db1.bytes).toBeUndefined();
  });

  it("distinguishes a missing file from an unavailable size, with no raw errors", async () => {
    mocks.invoke.mockResolvedValue([
      { databaseId: "db1", status: "missing", bytes: null },
      {
        databaseId: "db2",
        status: "unavailable",
        bytes: null,
        error: "SECRET_PRIVATE_PATH",
      },
    ]);
    const sizes = await readDatabaseSizes(["db1", "db2", "db3"]);
    expect(sizes.db1.status).toBe("missing");
    expect(sizes.db1.reason).toMatch(/missing/);
    expect(sizes.db2.status).toBe("unavailable");
    expect(sizes.db3.status).toBe("unavailable");
    expect(Object.values(sizes).every((row) => row.bytes === undefined)).toBe(
      true,
    );
    expect(JSON.stringify(sizes)).not.toContain("SECRET_PRIVATE_PATH");
  });

  it("ignores extraneous results and rejects duplicate results for a requested ID", async () => {
    mocks.invoke.mockResolvedValue([
      { databaseId: "db1", bytes: 1, status: "measured" },
      { databaseId: "other", bytes: 7, status: "measured" },
      { databaseId: "db1", bytes: 2, status: "measured" },
    ]);
    const sizes = await readDatabaseSizes(["db1"]);
    expect(Object.keys(sizes)).toEqual(["db1"]);
    expect(sizes.db1.status).toBe("unavailable");
  });

  it("never falls back to stale browser data after a native failure", async () => {
    mocks.invoke.mockRejectedValue(new Error("SECRET_PRIVATE_PATH"));
    mocks.bytes.mockResolvedValue(44);
    const sizes = await readDatabaseSizes(["db1"]);
    expect(sizes.db1.bytes).toBeUndefined();
    expect(JSON.stringify(sizes)).not.toContain("SECRET_PRIVATE_PATH");
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it("explains when the running desktop binary needs updating", async () => {
    mocks.invoke.mockRejectedValue("Command get_database_file_sizes not found");
    const sizes = await readDatabaseSizes(["db1"]);
    expect(sizes.db1.reason).toContain("updated desktop backend");
    expect(mocks.bytes).not.toHaveBeenCalled();
  });

  it("refreshes actual metadata rather than keeping old cached sizes", async () => {
    expect((await readDatabaseSizes(["db1"])).db1.bytes).toBe(4096);
    mocks.invoke.mockResolvedValue([
      { databaseId: "db1", status: "measured", bytes: 8192 },
    ]);
    expect((await readDatabaseSizes(["db1"])).db1.bytes).toBe(8192);
  });

  it("measures browser-only JSON without migration, preserving canonical-over-legacy precedence", async () => {
    mocks.getInvoke.mockResolvedValue(null);
    mocks.bytes.mockImplementation(
      async (key) =>
        ({
          "mremote-database-current": 100,
          "mremote-collection-current": 200,
          "mremote-collection-legacy": 300,
          "mremote-database-empty": 0,
        })[key as string] ?? null,
    );
    const sizes = await readDatabaseSizes([
      "current",
      "legacy",
      "missing",
      "empty",
    ]);
    expect(sizes.current).toEqual({
      status: "measured",
      bytes: 100,
      source: "browser-json",
    });
    expect(sizes.legacy).toEqual({
      status: "measured",
      bytes: 300,
      source: "browser-json",
    });
    expect(sizes.empty.bytes).toBe(0);
    expect(sizes.missing.status).toBe("missing");
    expect(mocks.bytes).not.toHaveBeenCalledWith("mremote-collection-current");
    expect(mocks.bytes).not.toHaveBeenCalledWith("mremote-collection-empty");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not label a browser read failure as missing or retry a legacy copy", async () => {
    mocks.getInvoke.mockResolvedValue(null);
    mocks.bytes.mockRejectedValue(new Error("SECRET_IDB_ERROR"));
    expect((await readDatabaseSizes(["db1"])).db1.status).toBe("unavailable");
    expect(mocks.bytes).toHaveBeenCalledExactlyOnceWith("mremote-database-db1");
  });
});

describe("formatDatabaseBytes", () => {
  it.each([
    [0, "0 B"],
    [17, "17 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536, "1.5 KiB"],
    [1024 ** 2, "1.0 MiB"],
    [1024 ** 3, "1.0 GiB"],
    [1024 ** 4, "1.0 TiB"],
    [1024 ** 5, "1.0 PiB"],
    [NaN, "Size unavailable"],
  ])("formats %s bytes", (bytes, label) =>
    expect(formatDatabaseBytes(bytes)).toBe(label),
  );
});
