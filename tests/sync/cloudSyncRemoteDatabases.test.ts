import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import {
  buildFullDatabaseArchive,
  FullDatabaseRestoreIncompleteError,
} from "../../src/utils/connection/fullDatabaseArchive";
import { collection, fullData, trust } from "../fixtures/fullDatabaseArchive";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  getInvoke: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: native.getInvoke,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getAllDatabases: native.list,
      importCloudSyncDatabase: native.create,
    }),
  },
}));
import {
  discoverRemoteDatabases,
  pullRemoteDatabase,
  sameRemoteDatabaseSource,
} from "../../src/utils/services/cloudSyncRemoteDatabases";
import {
  decodeCloudSnapshot,
  encodeCloudSnapshot,
  type CloudSyncSnapshot,
} from "../../src/utils/services/cloudSyncCodec";
import {
  getCloudSyncActivity,
  invalidateCloudSyncTarget,
} from "../../src/utils/services/cloudSyncActivity";
import { upgradeCloudSyncPayload } from "../../src/utils/services/cloudSyncPayload";

const target = (
  provider: CloudSyncTarget["provider"] = "nextcloud",
): CloudSyncTarget => ({
  id: "remote-catalog-fixture",
  label: "Backup",
  provider,
  enabled: true,
  nextcloud: {
    serverUrl: "https://fixture.invalid",
    username: "user",
    password: "PRIVATE_TARGET",
    folderPath: "/sorng",
    useAppPassword: true,
  },
});
const config = () => ({
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: [],
  encryptBeforeSync: true,
  syncEncryptionPassword: "PRIVATE_SYNC_PASSWORD",
  compressionEnabled: false,
});
const options = () => ({
  name: "Downloaded database",
  protectionTarget: {
    dataCipher: "aes-256-gcm" as const,
    keepSlotIds: [],
    newSlots: [
      {
        type: "password" as const,
        label: "Local password",
        password: "PRIVATE_LOCAL_PASSWORD",
      },
    ],
  },
});
let remote: { data: string | null; revision: string | null };
let snapshot: CloudSyncSnapshot;
async function publish(value = snapshot, settings = config()) {
  remote = { data: await encodeCloudSnapshot(value, settings), revision: "v1" };
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  invalidateCloudSyncTarget(target().id);
  native.getInvoke.mockResolvedValue(native.invoke);
  native.list.mockResolvedValue([]);
  native.create.mockResolvedValue({ ...collection, name: options().name });
  native.invoke.mockImplementation(async (command) => {
    if (command === "cloud_sync_read") return { ...remote };
    throw new Error(`Unexpected command ${command}`);
  });
  snapshot = {
    format: "sortofremoteng-cloud-sync",
    version: 1,
    modifiedAt: Date.now(),
    payload: await upgradeCloudSyncPayload({
      version: 1,
      sections: {
        [`database:${collection.id}`]: await buildFullDatabaseArchive(
          collection,
          await fullData(),
          trust,
        ),
      },
    }),
    databaseNames: { [collection.id]: collection.name },
  };
  await publish();
});
afterEach(() => {
  expect(
    native.invoke.mock.calls.every(
      ([command]) => command === "cloud_sync_read",
    ),
  ).toBe(true);
  expect(getCloudSyncActivity()).toHaveLength(0);
  vi.unstubAllGlobals();
});

describe("remote-only synced database discovery and pull", () => {
  it("refuses disabled targets and missing native transport without a remote read", async () => {
    await expect(
      discoverRemoteDatabases({ ...target(), enabled: false }, config()),
    ).rejects.toThrow(/Enable and configure/);
    native.getInvoke.mockResolvedValue(null);
    await expect(discoverRemoteDatabases(target(), config())).rejects.toThrow(
      /desktop backend/,
    );
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("does not mistake a failed local index read for an empty device", async () => {
    const catalog = await discoverRemoteDatabases(target(), config());
    native.list.mockRejectedValue(new Error("PRIVATE_LOCAL_PATH"));
    await expect(
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
    ).rejects.toThrow(/local database list/);
    expect(native.create).not.toHaveBeenCalled();
  });

  it("serializes simultaneous pulls and refuses a second copy of the same identity", async () => {
    const catalog = await discoverRemoteDatabases(target(), config());
    native.create.mockImplementation(async () => {
      native.list.mockResolvedValue([collection]);
      return collection;
    });
    const results = await Promise.allSettled([
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(native.create).toHaveBeenCalledTimes(1);
  });

  it.each(["nextcloud", "webdav", "sftp", "googleDrive", "oneDrive"] as const)(
    "discovers and pulls via %s with no local DB or sync selection",
    async (provider) => {
      const catalog = await discoverRemoteDatabases(target(provider), config());
      expect(catalog.databases).toEqual([
        {
          id: collection.id,
          label: collection.name,
          nameAvailable: true,
          bytes: expect.any(Number),
          existsLocally: false,
        },
      ]);
      expect(catalog.databases[0].bytes).toBeGreaterThan(0);
      expect(JSON.stringify(catalog)).not.toMatch(
        /PRIVATE_|connections|credentialVault|documents|trustRecords/,
      );
      expect(native.create).not.toHaveBeenCalled();
      const db = await pullRemoteDatabase(
        target(provider),
        config(),
        catalog,
        collection.id,
        options(),
      );
      expect(db.id).toBe(collection.id);
      expect(native.create).toHaveBeenCalledWith(
        snapshot.payload.sections[`database:${collection.id}`],
        { ...options(), assertCurrent: expect.any(Function) },
      );
      expect(native.invoke).toHaveBeenCalledTimes(2);
      expect(native.invoke.mock.calls[0][1]).toMatchObject({
        target: { provider },
        options: { maxBytes: 50 * 1024 * 1024 },
      });
      expect(config().selectedItems).toEqual([]);
    },
  );

  it("shows older snapshots by identity and existing databases as already local", async () => {
    delete snapshot.databaseNames;
    await publish();
    expect(
      (await discoverRemoteDatabases(target(), config())).databases[0],
    ).toMatchObject({
      label: `Database ${collection.id}`,
      nameAvailable: false,
    });
    native.list.mockResolvedValue([{ ...collection, name: "Local name" }]);
    const catalog = await discoverRemoteDatabases(target(), config());
    expect(catalog.databases[0]).toMatchObject({
      label: "Local name",
      existsLocally: true,
    });
    await expect(
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
    ).rejects.toThrow(/already on this device/);
    expect(native.create).not.toHaveBeenCalled();
  });

  it("does not overwrite a database created since discovery", async () => {
    const catalog = await discoverRemoteDatabases(target(), config());
    native.list.mockResolvedValue([collection]);
    await expect(
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
    ).rejects.toThrow(/already on this device/);
    expect(native.create).not.toHaveBeenCalled();
  });

  it.each(["revision", "content", "removed"])(
    "requires a refresh if remote %s changed",
    async (change) => {
      const catalog = await discoverRemoteDatabases(target(), config());
      if (change === "revision") remote.revision = "v2";
      if (change === "content") {
        snapshot.databaseNames![collection.id] = "Changed name";
        await publish();
      }
      if (change === "removed") remote = { data: null, revision: null };
      await expect(
        pullRemoteDatabase(
          target(),
          config(),
          catalog,
          collection.id,
          options(),
        ),
      ).rejects.toThrow(/snapshot changed/);
      expect(native.create).not.toHaveBeenCalled();
    },
  );

  it("does not trust edited or manufactured catalog receipts", async () => {
    const catalog = await discoverRemoteDatabases(target(), config());
    await expect(
      pullRemoteDatabase(
        target(),
        config(),
        { ...catalog },
        collection.id,
        options(),
      ),
    ).rejects.toThrow(/Refresh/);
    catalog.databases.push({ ...catalog.databases[0], id: "other" });
    await expect(
      pullRemoteDatabase(target(), config(), catalog, "other", options()),
    ).rejects.toThrow(/Refresh/);
    expect(native.create).not.toHaveBeenCalled();
  });

  it.each(["password", "destination", "disabled", "identity"])(
    "rejects %s changes before creating a DB",
    async (change) => {
      const catalog = await discoverRemoteDatabases(target(), config());
      const t = target();
      const c = config();
      if (change === "password") c.syncEncryptionPassword = "different";
      if (change === "destination") t.nextcloud!.folderPath = "/different";
      if (change === "disabled") t.enabled = false;
      if (change === "identity") invalidateCloudSyncTarget(t.id);
      await expect(
        pullRemoteDatabase(t, c, catalog, collection.id, options()),
      ).rejects.toThrow(/Refresh|changed/);
      expect(native.create).not.toHaveBeenCalled();
    },
  );

  it("checks ownership after asynchronous reads and before native creation", async () => {
    let valid = true;
    const check = () => {
      if (!valid) throw new Error("Settings changed");
    };
    const catalog = await discoverRemoteDatabases(target(), config(), check);
    native.list.mockImplementationOnce(async () => {
      valid = false;
      return [];
    });
    await expect(
      pullRemoteDatabase(target(), config(), catalog, collection.id, {
        ...options(),
        assertCurrent: check,
      }),
    ).rejects.toThrow(/Settings changed/);
    expect(native.create).not.toHaveBeenCalled();
  });

  it("keeps read-only discovery available with automatic sync off", async () => {
    const catalog = await discoverRemoteDatabases(target(), {
      ...config(),
      enabled: false,
    });
    expect(catalog.databases).toHaveLength(1);
    expect(native.create).not.toHaveBeenCalled();
  });

  it("distinguishes no snapshot from a snapshot without databases", async () => {
    remote = { data: null, revision: null };
    expect(await discoverRemoteDatabases(target(), config())).toMatchObject({
      modifiedAt: null,
      databases: [],
    });
    await publish({
      ...snapshot,
      payload: { version: 1, sections: { "app:settings": { theme: "dark" } } },
      databaseNames: undefined,
    });
    expect(await discoverRemoteDatabases(target(), config())).toMatchObject({
      modifiedAt: snapshot.modifiedAt,
      databases: [],
    });
  });

  it.each([
    "wrong-password",
    "malformed",
    "missing-revision",
    "oversized",
    "invalid-archive",
    "plaintext",
  ])("fails closed for %s without applying", async (failure) => {
    const c = config();
    if (failure === "wrong-password") c.syncEncryptionPassword = "wrong";
    if (failure === "malformed") remote.data = "not-a-snapshot";
    if (failure === "missing-revision") remote.revision = null;
    if (failure === "oversized") c.maxFileSizeMB = 0.0001;
    if (failure === "invalid-archive") {
      snapshot.payload.sections[`database:${collection.id}`] = {
        format: "sorng-full-database",
        version: 1,
        collection: { id: collection.id },
      };
      await publish();
    }
    if (failure === "plaintext") {
      c.encryptBeforeSync = false;
      await publish(snapshot, c);
    }
    await expect(discoverRemoteDatabases(target(), c)).rejects.toThrow();
    expect(native.create).not.toHaveBeenCalled();
  });

  it("does not echo provider secrets in errors", async () => {
    native.invoke.mockRejectedValue(
      new Error(
        "https://PRIVATE_USER:PRIVATE_PASS@fixture.invalid?token=PRIVATE_TOKEN",
      ),
    );
    const error = await discoverRemoteDatabases(target(), config()).catch(
      (e) => e,
    );
    expect(error.message).toMatch(/Check its connection settings/);
    expect(error.message).not.toContain("PRIVATE_");
  });

  it("preserves partial restore diagnostics without retrying or uploading", async () => {
    const catalog = await discoverRemoteDatabases(target(), config());
    native.create.mockRejectedValue(
      new FullDatabaseRestoreIncompleteError(collection.id),
    );
    await expect(
      pullRemoteDatabase(target(), config(), catalog, collection.id, options()),
    ).rejects.toMatchObject({ databaseId: collection.id });
    expect(native.create).toHaveBeenCalledTimes(1);
  });

  it("ignores sync status and local selections for source comparison, not destination credentials", () => {
    expect(
      sameRemoteDatabaseSource(target(), config(), target(), {
        ...config(),
        lastSyncTime: Date.now(),
        selectedItems: ["app:settings"],
      }),
    ).toBe(true);
    const changed = target();
    changed.nextcloud!.password = "new";
    expect(
      sameRemoteDatabaseSource(target(), config(), changed, config()),
    ).toBe(false);
  });
});

describe("encrypted remote catalog metadata", () => {
  it("keeps names inside encryption and outside canonical record metadata", async () => {
    expect(Buffer.from(remote.data!, "base64").toString()).not.toContain(
      collection.name,
    );
    const result = await decodeCloudSnapshot(remote.data!, config());
    expect(result.databaseNames).toEqual({ [collection.id]: collection.name });
    expect(
      (
        result.payload.sections[`database:${collection.id}`] as {
          collection: { name: string };
        }
      ).collection.name,
    ).toBe(collection.id);
  });
  it.each([
    { absent: "Name" },
    { [collection.id]: "" },
    { [collection.id]: "x".repeat(513) },
    { [collection.id]: "bad\nname" },
  ])("rejects invalid name metadata %j", async (databaseNames) => {
    await publish({ ...snapshot, databaseNames });
    await expect(decodeCloudSnapshot(remote.data!, config())).rejects.toThrow(
      /database names/,
    );
  });
});
