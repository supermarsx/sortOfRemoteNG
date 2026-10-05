import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportableDatabaseInfo } from "../../src/utils/connection/databaseManager";
import { buildFullDatabaseArchive } from "../../src/utils/connection/fullDatabaseArchive";
import {
  captureCloudSyncPayload,
  discoverCloudSyncItems,
} from "../../src/utils/services/cloudSyncPayload";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { reconcileRecordLedger } from "../../src/utils/storage/recordLedger";
import { collection, fullData, trust } from "../fixtures/fullDatabaseArchive";
import { fixture as appDocumentsFixture } from "../documents/fixtures";

const mocks = vi.hoisted(() => ({
  databases: [] as ExportableDatabaseInfo[],
  archive: vi.fn(),
  selectDatabase: vi.fn(),
  loadDatabaseData: vi.fn(),
  unlockDatabase: vi.fn(),
  unlockManagedDatabase: vi.fn(),
  sizes: vi.fn(),
  getInvoke: vi.fn(),
  invoke: vi.fn(),
  settings: {} as Record<string, unknown>,
  raw: new Map<string, string>(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getExportableDatabases: async () => mocks.databases,
      readFullDatabaseArchive: mocks.archive,
      selectDatabase: mocks.selectDatabase,
      loadDatabaseData: mocks.loadDatabaseData,
      unlockDatabase: mocks.unlockDatabase,
      unlockManagedDatabase: mocks.unlockManagedDatabase,
      getCurrentDatabase: () => null,
    }),
  },
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: mocks.getInvoke,
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({ getSettings: () => mocks.settings }),
  },
}));

const database = (unlocked: boolean): ExportableDatabaseInfo => ({
  ...collection,
  isCurrent: unlocked,
  isUnlocked: unlocked,
  isExportable: unlocked,
});
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
const expectNoDatabaseContentAccess = () => {
  expect(mocks.archive).not.toHaveBeenCalled();
  expect(mocks.selectDatabase).not.toHaveBeenCalled();
  expect(mocks.loadDatabaseData).not.toHaveBeenCalled();
  expect(mocks.unlockDatabase).not.toHaveBeenCalled();
  expect(mocks.unlockManagedDatabase).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/(?:load_database|database_protection|decrypt)/),
    ]),
  );
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.databases = [];
  mocks.settings = { theme: "dark" };
  mocks.raw.clear();
  mocks.archive.mockRejectedValue(new Error("synthetic private archive error"));
  mocks.sizes.mockRejectedValue(
    new Error("synthetic private filesystem error"),
  );
  mocks.getInvoke.mockResolvedValue(mocks.invoke);
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "get_database_file_sizes") return mocks.sizes(args);
    if (command === "read_app_settings") return mocks.settings;
    if (command === "read_app_data" || command === "read_macro_library")
      return mocks.raw.get(args.key) ?? null;
    throw new Error(`Unexpected inventory command: ${command}`);
  });
});

describe("cloud inventory byte sizes", () => {
  it("keeps app-wide documents separate from the selected database archive and stored file size", async () => {
    const appDocuments = appDocumentsFixture();
    appDocuments.documents[0].name = "APP_WIDE_ONLY_DOCUMENT";
    mocks.raw.set("documents.app-wide.v1", JSON.stringify(appDocuments));
    const archive = await buildFullDatabaseArchive(
      collection,
      await fullData(),
      trust,
    );
    mocks.databases = [database(true)];
    mocks.archive.mockResolvedValue(archive);
    mocks.sizes.mockResolvedValue([
      { databaseId: collection.id, bytes: 8192, status: "measured" },
    ]);
    const items = await discoverCloudSyncItems();
    const id = `database:${collection.id}`;
    expect(items.find((item) => item.id === id)).toMatchObject({
      bytes: 8192,
      sizeKind: "stored-encrypted",
      sizeStatus: "measured",
    });
    expectNoDatabaseContentAccess();
    expect(
      items.find((item) => item.id === "app:documents.app-wide.v1"),
    ).toMatchObject({
      label: "Documents (App-wide)",
      bytes: bytes(appDocuments),
      sensitive: true,
    });
    const payload = await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: [id],
      encryptBeforeSync: true,
    });
    expect(Object.keys(payload.sections)).toEqual([id]);
    expect(mocks.archive).toHaveBeenCalledExactlyOnceWith(collection.id, {
      materializeDefaults: true,
    });
    expect(mocks.sizes).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).not.toContain("APP_WIDE_ONLY_DOCUMENT");
    expect(mocks.raw.get("documents.app-wide.v1")).toBe(
      JSON.stringify(appDocuments),
    );
  });

  it("uses native file bytes without reading, opening, unlocking or decrypting database content", async () => {
    const data = await fullData();
    data.connections[0].name = "東京 🗃️";
    data.automationLibrary!.terminalMacros.push({
      id: "database-macro",
      name: "Database macro",
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      steps: [{ command: "hostname", delayMs: 0, sendNewline: true }],
    });
    const archive = await buildFullDatabaseArchive(collection, data, trust);
    mocks.databases = [database(true)];
    mocks.archive.mockResolvedValue(archive);
    mocks.sizes.mockResolvedValue([
      { databaseId: collection.id, bytes: 12345, status: "measured" },
    ]);
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    let items;
    try {
      items = await discoverCloudSyncItems();
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      decrypt.mockRestore();
    }
    expect(items[0]).toMatchObject({
      available: true,
      bytes: 12345,
      sizeKind: "stored-encrypted",
      sizeStatus: "measured",
    });
    expect(items[0].bytes).not.toBe(bytes(archive));
    expect(mocks.sizes).toHaveBeenCalledExactlyOnceWith({
      databaseIds: [collection.id],
    });
    expectNoDatabaseContentAccess();
    // Database-owned scripts/macros must not become app-wide library rows.
    expect(items.map((item) => item.id)).toEqual([
      `database:${collection.id}`,
      "app:settings",
    ]);
    expect(JSON.stringify(items)).not.toMatch(/PRIVATE_|fixture\.test|東京/);
    expect(
      mocks.invoke.mock.calls.every(
        ([cmd]) => cmd === "get_database_file_sizes" || cmd.startsWith("read_"),
      ),
    ).toBe(true);
  });

  it("measures only persisted portable settings, excluding credentials and local settings", async () => {
    const portable = {
      language: "日本語",
      theme: "dark",
      colorScheme: "紫",
      animationsEnabled: true,
      sidebarWidth: 320,
    };
    mocks.settings = {
      ...portable,
      cloudSync: { password: "SYNTHETIC_SECRET".repeat(100) },
      sshPath: "synthetic/local/path",
    };
    const item = (await discoverCloudSyncItems()).find(
      (entry) => entry.id === "app:settings",
    )!;
    const payload = await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: ["app:settings"],
    });
    expect(item).toMatchObject({
      available: true,
      bytes: bytes(portable),
      sizeKind: "portable-settings",
    });
    expect(item.bytes).toBe(bytes(payload.sections["app:settings"]));
    expect(JSON.stringify(item)).not.toContain("SYNTHETIC_SECRET");
    mocks.settings = {
      theme: false,
      sidebarWidth: 5000,
      language: "x".repeat(65),
    };
    expect((await discoverCloudSyncItems())[0].bytes).toBe(2); // The actual empty JSON object.
  });

  it("retains UTF-8 sizes for all three existing library stores without loading or migrating them", async () => {
    for (const key of [
      "recording.managed-scripts",
      "recording.terminal-macros",
      "recording.web-automation.v1",
    ])
      mocks.raw.set(key, JSON.stringify({ name: "é東京🔑", fixture: key }));
    const items = await discoverCloudSyncItems();
    for (const [key, raw] of mocks.raw)
      expect(items.find((item) => item.id === `app:${key}`)).toMatchObject({
        available: true,
        bytes: Buffer.byteLength(raw, "utf8"),
        sizeKind: "stored-json",
      });
    expect(items.filter((item) => item.kind === "library")).toHaveLength(3);
    expect(
      items.find((item) => item.id === "app:recording.managed-scripts")?.label,
    ).toBe("Saved terminal scripts (App-wide)");
    expect(
      items.find((item) => item.id === "app:recording.terminal-macros")?.label,
    ).toBe("Terminal macros (App-wide)");
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual([
      "read_app_data",
      "read_macro_library",
      "read_macro_library",
      "read_app_data",
      "read_app_settings",
    ]);
  });

  it("maps a single metadata batch by ID for unlocked, locked, legacy and unencrypted databases", async () => {
    mocks.databases = [
      database(true),
      { ...database(false), id: "locked" },
      { ...database(true), id: "legacy", protectionFormat: undefined },
      {
        ...database(true),
        id: "plain",
        isEncrypted: false,
        protectionFormat: undefined,
      },
      { ...database(true), id: "managed-no-password", isEncrypted: false },
    ];
    // Deliberately return a different order: rows must never inherit a neighbor's size.
    mocks.sizes.mockResolvedValue([
      { databaseId: "plain", bytes: 0, status: "measured" },
      { databaseId: "legacy", bytes: 4096, status: "measured" },
      { databaseId: "managed-no-password", bytes: 512, status: "measured" },
      { databaseId: collection.id, bytes: 16384, status: "measured" },
      { databaseId: "locked", bytes: 8192, status: "measured" },
    ]);
    const rows = (await discoverCloudSyncItems()).filter(
      (item) => item.kind === "database",
    );
    expect(rows).toMatchObject([
      {
        id: `database:${collection.id}`,
        available: true,
        bytes: 16384,
        sizeKind: "stored-encrypted",
      },
      {
        id: "database:locked",
        available: false,
        bytes: 8192,
        sizeKind: "stored-encrypted",
      },
      {
        id: "database:legacy",
        available: false,
        bytes: 4096,
        sizeKind: "stored-encrypted",
      },
      {
        id: "database:plain",
        available: false,
        bytes: 0,
        sizeKind: "stored-file",
      },
      {
        id: "database:managed-no-password",
        available: true,
        bytes: 512,
        sizeKind: "stored-encrypted",
      },
    ]);
    for (const row of rows) {
      expect(row.sizeStatus).toBe("measured");
      expect(row.sizeUnavailableReason).toBeUndefined();
      expect(row.sensitive).toBe(true);
    }
    expect(rows[1].unavailableReason).toContain(
      "Unlock this database here before syncing",
    );
    expect(rows[2].unavailableReason).toContain(
      "older password-protected format",
    );
    expect(rows[3].unavailableReason).toContain(
      "does not use native database protection",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "get_database_file_sizes",
      ),
    ).toEqual([
      [
        "get_database_file_sizes",
        { databaseIds: mocks.databases.map((db) => db.id) },
      ],
    ]);
    expectNoDatabaseContentAccess();
  });

  it("refreshes actual stored bytes without caching or attempting an archive read", async () => {
    mocks.databases = [database(true)];
    mocks.sizes
      .mockResolvedValueOnce([
        { databaseId: collection.id, bytes: 4096, status: "measured" },
      ])
      .mockResolvedValueOnce([
        { databaseId: collection.id, bytes: 5120, status: "measured" },
      ]);
    expect((await discoverCloudSyncItems())[0]).toMatchObject({
      bytes: 4096,
      sizeKind: "stored-encrypted",
    });
    expect((await discoverCloudSyncItems())[0].bytes).toBe(5120);
    expect(mocks.sizes).toHaveBeenCalledTimes(2);
    expectNoDatabaseContentAccess();
  });

  it("distinguishes missing and inaccessible files without breaking other rows", async () => {
    mocks.databases = [
      database(false),
      { ...database(true), id: "other" },
      { ...database(true), id: "measured" },
    ];
    mocks.sizes.mockResolvedValue([
      { databaseId: "other", bytes: null, status: "unavailable" },
      { databaseId: "measured", bytes: 2048, status: "measured" },
      { databaseId: collection.id, bytes: null, status: "missing" },
    ]);
    const items = await discoverCloudSyncItems();
    expect(items[0]).toMatchObject({
      available: false,
      sizeStatus: "missing",
      sizeUnavailableReason: expect.stringContaining(
        "current database file is missing",
      ),
    });
    expect(items[1]).toMatchObject({
      available: true,
      sizeStatus: "unavailable",
      sizeUnavailableReason: expect.stringContaining(
        "Could not read the stored database size",
      ),
    });
    for (const item of items.slice(0, 2)) {
      expect(item.bytes).toBeUndefined();
      expect(item.sizeKind).toBeUndefined();
    }
    expect(items[2]).toMatchObject({ bytes: 2048, sizeStatus: "measured" });
    expect(items.find((item) => item.id === "app:settings")?.bytes).toBe(
      bytes(mocks.settings),
    );
    expect(JSON.stringify(items)).not.toContain("synthetic private");
    expectNoDatabaseContentAccess();
  });

  it.each([
    ["synthetic private filesystem error", "Refresh to retry"],
    ["Command get_database_file_sizes not found", "updated desktop backend"],
  ])(
    "reports failed metadata requests as unavailable: %s",
    async (error, reason) => {
      mocks.databases = [database(true), { ...database(false), id: "locked" }];
      mocks.sizes.mockRejectedValue(new Error(error));
      const items = await discoverCloudSyncItems();
      for (const item of items.filter((item) => item.kind === "database")) {
        expect(item.sizeStatus).toBe("unavailable");
        expect(item.bytes).toBeUndefined();
        expect(item.sizeKind).toBeUndefined();
        expect(item.sizeUnavailableReason).toContain(reason);
      }
      expect(items.find((item) => item.id === "app:settings")?.bytes).toBe(
        bytes(mocks.settings),
      );
      expect(JSON.stringify(items)).not.toContain(error);
      expectNoDatabaseContentAccess();
    },
  );

  it("labels browser storage sizes as stored JSON even for protected databases", async () => {
    mocks.databases = [database(false)];
    mocks.getInvoke.mockResolvedValue(null);
    const storedBytes = vi
      .spyOn(IndexedDbService, "getItemByteLengthStrict")
      .mockResolvedValue(256);
    try {
      expect(await discoverCloudSyncItems()).toMatchObject([
        {
          id: `database:${collection.id}`,
          available: false,
          bytes: 256,
          sizeKind: "stored-json",
          sizeStatus: "measured",
        },
      ]);
      expect(storedBytes).toHaveBeenCalledExactlyOnceWith(
        `mremote-database-${collection.id}`,
      );
      expect(mocks.invoke).not.toHaveBeenCalled();
      expectNoDatabaseContentAccess();
    } finally {
      storedBytes.mockRestore();
    }
  });

  it("skips all metadata and size fields for availability-only discovery and unrelated capture", async () => {
    mocks.databases = [database(true), { ...database(false), id: "locked" }];
    mocks.raw.set("recording.terminal-macros", "{}");
    const items = await discoverCloudSyncItems({ includeSizes: false });
    expect(items.map((item) => item.id)).toEqual([
      `database:${collection.id}`,
      "database:locked",
      "app:recording.terminal-macros",
      "app:settings",
    ]);
    expect(items[0].available).toBe(true);
    expect(items[1].available).toBe(false);
    for (const item of items)
      for (const key of [
        "bytes",
        "sizeKind",
        "sizeStatus",
        "sizeUnavailableReason",
      ])
        expect(item).not.toHaveProperty(key);
    await captureCloudSyncPayload({
      ...defaultCloudSyncConfig,
      selectedItems: ["app:settings"],
    });
    expectNoDatabaseContentAccess();
    expect(mocks.sizes).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.every(([cmd]) => cmd.startsWith("read_")),
    ).toBe(true);
  });

  it("keeps empty terminal stores available without deleting their ledger tombstones", async () => {
    const original = {
      version: 1,
      legacyDigest: null,
      macros: [
        {
          id: "old",
          name: "Old macro",
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          steps: [],
        },
      ],
    };
    const ledger = await reconcileRecordLedger(original, undefined, {
      mode: "migrate",
    });
    const empty = { ...original, macros: [] };
    const recordMetadata = await reconcileRecordLedger(empty, ledger, {
      mode: "write",
    });
    const raw = JSON.stringify({ ...empty, recordMetadata });
    mocks.raw.set("recording.terminal-macros", raw);
    mocks.raw.set(
      "recording.managed-scripts",
      JSON.stringify({
        customScripts: [],
        modifiedDefaults: [],
        deletedDefaultIds: [],
      }),
    );
    const items = await discoverCloudSyncItems();
    for (const id of [
      "app:recording.terminal-macros",
      "app:recording.managed-scripts",
    ])
      expect(items.find((item) => item.id === id)).toMatchObject({
        available: true,
      });
    expect(
      Object.values(recordMetadata.records).some((stamp) => stamp.deletedAt),
    ).toBe(true);
    expect(mocks.raw.get("recording.terminal-macros")).toBe(raw);
    expect(
      items.find((item) => item.id === "app:recording.terminal-macros")?.bytes,
    ).toBe(Buffer.byteLength(raw, "utf8"));
  });

  it.each([
    [
      "recording.terminal-macros",
      { version: 1, macros: [], legacyDigest: "invalid" },
    ],
    [
      "recording.managed-scripts",
      {
        customScripts: [],
        modifiedDefaults: [],
        deletedDefaultIds: ["deleted-default"],
      },
    ],
    [
      "recording.managed-scripts",
      {
        customScripts: [],
        modifiedDefaults: [],
        deletedDefaultIds: [],
        unexpectedData: "retained",
      },
    ],
    ["recording.web-automation.v1", { version: 1, scripts: [], macros: [] }],
  ])(
    "does not hide unverified or nonterminal content in %s",
    async (key, value) => {
      mocks.raw.set(key, JSON.stringify(value));
      const items = await discoverCloudSyncItems();
      expect(items.find((item) => item.id === `app:${key}`)).toMatchObject({
        available: true,
        bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
      });
    },
  );

  it.each([
    ["recording.managed-scripts", "Saved terminal scripts"],
    ["recording.terminal-macros", "Terminal macros"],
    ["recording.web-automation.v1", "Website scripts and macros"],
    [
      "recording.managed-scripts",
      "Saved terminal scripts (legacy application-wide)",
    ],
    ["recording.terminal-macros", "Terminal macros (legacy application-wide)"],
    [
      "recording.web-automation.v1",
      "Website scripts and macros (application-wide)",
    ],
    ["recording.managed-scripts", "Saved terminal scripts (App-wide)"],
    ["documents.app-wide.v1", "Documents (App-wide)"],
  ])(
    "preserves existing label exclusions for %s after adding scope labels",
    async (key, label) => {
      mocks.raw.set(key, "{}");
      const payload = await captureCloudSyncPayload({
        ...defaultCloudSyncConfig,
        selectedItems: [`app:${key}`],
        encryptBeforeSync: true,
        excludePatterns: [label],
      });
      expect(payload.sections).toEqual({});
      expect(
        mocks.invoke.mock.calls.every(([cmd]) => cmd.startsWith("read_")),
      ).toBe(true);
    },
  );
});
