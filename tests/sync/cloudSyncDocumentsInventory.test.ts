import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseDocuments } from "../../src/types/documents/document";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import { APP_DOCUMENTS_STORE_KEY } from "../../src/utils/documents/appDocumentsStore";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import { emptyDatabaseDocuments } from "../../src/utils/documents/validation";
import {
  applyCloudSyncPayload,
  captureCloudSyncPayload,
  discoverCloudSyncItems,
  validateCloudSyncPayload,
} from "../../src/utils/services/cloudSyncPayload";
import {
  reconcileRecordLedger,
  type RecordLedger,
} from "../../src/utils/storage/recordLedger";
import { fixture } from "../documents/fixtures";

const mocks = vi.hoisted(() => ({
  raw: new Map<string, string>(),
  invoke: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => mocks.invoke,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => null,
      getExportableDatabases: async () => [],
      readFullDatabaseArchive: mocks.archive,
      restoreCloudSyncArchive: mocks.restore,
    }),
  },
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({ getSettings: () => ({}) }) },
}));

const id = `app:${APP_DOCUMENTS_STORE_KEY}`;
const config = {
  ...defaultCloudSyncConfig,
  selectedItems: [id],
  encryptBeforeSync: true,
};
type StoredDocuments = DatabaseDocuments & { recordMetadata: RecordLedger };
const payload = (value: unknown) => ({
  version: 1 as const,
  sections: { [id]: value },
});
const writes = () =>
  mocks.invoke.mock.calls.filter(([command]) => !command.startsWith("read_"));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.raw.clear();
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "read_app_settings") return null;
    if (command === "read_app_data" || command === "read_macro_library")
      return mocks.raw.get(args.key) ?? null;
    if (command === "compare_and_swap_app_data") {
      if ((mocks.raw.get(args.key) ?? null) !== args.expected) return false;
      mocks.raw.set(args.key, args.replacement);
      return true;
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
});

async function seed(data = fixture()) {
  const recordMetadata = await reconcileRecordLedger(data, undefined, {
    mode: "migrate",
  });
  const value = { ...data, recordMetadata };
  mocks.raw.set(APP_DOCUMENTS_STORE_KEY, JSON.stringify(value));
  return value;
}

describe("app-wide document sync inventory and payloads", () => {
  it("leaves an absent library optional without creating it or guessing a selection", async () => {
    expect(
      (await discoverCloudSyncItems()).some((item) => item.id === id),
    ).toBe(false);
    expect(
      await captureCloudSyncPayload({ ...config, selectedItems: undefined }),
    ).toEqual({ version: 1, sections: {} });
    await expect(captureCloudSyncPayload(config)).rejects.toThrow(
      /unavailable/,
    );
    expect(mocks.raw.size).toBe(0);
    expect(writes()).toHaveLength(0);
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "lists stored documents, including an empty library, with actual UTF-8 bytes (empty=%s)",
    async (empty) => {
      const data = empty ? emptyDatabaseDocuments() : fixture();
      if (!empty) data.documents[0].name = "東京 🗃️";
      const value = await seed(data);
      const before = mocks.raw.get(APP_DOCUMENTS_STORE_KEY)!;
      const item = (await discoverCloudSyncItems()).find(
        (item) => item.id === id,
      );
      expect(item).toEqual({
        id,
        label: "Documents (App-wide)",
        kind: "library",
        available: true,
        sensitive: true,
        bytes: Buffer.byteLength(before, "utf8"),
        sizeKind: "stored-json",
      });
      expect(mocks.invoke).toHaveBeenCalledWith("read_app_data", {
        key: APP_DOCUMENTS_STORE_KEY,
      });
      expect(mocks.raw.get(APP_DOCUMENTS_STORE_KEY)).toBe(before);
      expect(JSON.stringify(item)).not.toMatch(/PRIVATE_|東京/);
      expect(writes()).toHaveLength(0);
      expect((await captureCloudSyncPayload(config)).sections).toEqual({
        [id]: value,
      });
      expect(mocks.archive).not.toHaveBeenCalled();
    },
  );

  it("requires encrypted sync for app-wide documents", async () => {
    await seed();
    await expect(
      captureCloudSyncPayload({ ...config, encryptBeforeSync: false }),
    ).rejects.toThrow(/encrypted/);
    expect(writes()).toHaveLength(0);
  });

  it("preserves reviewed document history and deletion tombstones exactly through apply and recapture", async () => {
    await seed();
    const baseline = await captureCloudSyncPayload(config);
    const original = baseline.sections[id] as StoredDocuments;
    const remote = {
      ...original,
      revision: original.revision + 1,
      documents: [],
    };
    remote.recordMetadata = await reconcileRecordLedger(
      remote,
      original.recordMetadata,
      {
        mode: "write",
        now: "2026-10-01T00:00:00.000Z",
      },
    );
    expect(
      Object.values(remote.recordMetadata.records).some(
        (record) => record.deletedAt,
      ),
    ).toBe(true);
    mocks.invoke.mockClear();
    await applyCloudSyncPayload(payload(remote), config, baseline);
    expect(JSON.parse(mocks.raw.get(APP_DOCUMENTS_STORE_KEY)!)).toEqual(remote);
    expect(await captureCloudSyncPayload(config)).toEqual(payload(remote));
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe("compare_and_swap_app_data");
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("rejects unselected documents and mismatched remote history before writing", async () => {
    const original = await seed();
    const baseline = await captureCloudSyncPayload(config);
    const before = mocks.raw.get(APP_DOCUMENTS_STORE_KEY);
    const remote = structuredClone(original);
    remote.documents[0].name = "Untracked change";
    await expect(
      applyCloudSyncPayload(payload(remote), config, baseline),
    ).rejects.toThrow(/metadata does not match/);
    await expect(
      applyCloudSyncPayload(payload(original), {
        ...config,
        selectedItems: [],
      }),
    ).rejects.toThrow(/unselected/);
    expect(mocks.raw.get(APP_DOCUMENTS_STORE_KEY)).toBe(before);
    expect(writes()).toHaveLength(0);
  });

  it.each([
    { unexpected: true },
    { version: 2 },
    {
      documents: [
        { ...fixture().documents[0], parentFolderId: "database-folder" },
      ],
    },
    {
      documents: [
        { ...fixture().documents[0], blocks: [{ id: "bad", type: "unknown" }] },
      ],
    },
    { recordMetadata: { version: 2, records: {}, journal: [] } },
    { databaseMigration: {} },
  ])("strictly rejects malformed document libraries: %j", async (patch) => {
    const value = { ...fixture(), ...patch };
    expect(() => validateCloudSyncPayload(payload(value))).toThrow();
    await expect(
      applyCloudSyncPayload(payload(value), config),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it("roundtrips verified embedded attachments and their record metadata", async () => {
    await seed();
    const baseline = await captureCloudSyncPayload(config);
    const remote = structuredClone(baseline.sections[id]) as StoredDocuments;
    remote.attachments.push(
      await createDocumentAttachment(
        new TextEncoder().encode("PRIVATE_ATTACHMENT 東京"),
        "fixture.txt",
        "text/plain",
      ),
    );
    remote.recordMetadata = await reconcileRecordLedger(
      remote,
      remote.recordMetadata,
      { mode: "write" },
    );
    await applyCloudSyncPayload(payload(remote), config, baseline);
    expect(await captureCloudSyncPayload(config)).toEqual(payload(remote));
  });

  it.each(["hash", "mime", "size", "base64"])(
    "rejects invalid attachment %s before any apply write",
    async (field) => {
      await seed();
      const baseline = await captureCloudSyncPayload(config);
      const before = mocks.raw.get(APP_DOCUMENTS_STORE_KEY);
      const remote = fixture();
      const attachment = await createDocumentAttachment(
        new TextEncoder().encode("fixture"),
        "fixture.txt",
        "text/plain",
      );
      if (field === "hash") attachment.sha256 = "0".repeat(64);
      if (field === "mime") attachment.mimeType = "image/png";
      if (field === "size") attachment.size++;
      if (field === "base64") attachment.dataBase64 = "!!!!";
      remote.attachments.push(attachment);
      // No incoming ledger: attachment verification must independently reject it.
      await expect(
        applyCloudSyncPayload(payload(remote), config, baseline),
      ).rejects.toThrow();
      expect(mocks.raw.get(APP_DOCUMENTS_STORE_KEY)).toBe(before);
      expect(writes()).toHaveLength(0);
    },
  );
});
