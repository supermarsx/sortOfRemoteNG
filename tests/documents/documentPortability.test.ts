import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { DatabaseManager } from "../../src/utils/connection/databaseManager";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";
import { SettingsManager } from "../../src/utils/settings/settingsManager";
import { rebindDatabaseQuickActions } from "../../src/utils/connection/rebindDatabaseQuickActions";
import { fixture } from "./fixtures";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
describe("private document portability boundaries", () => {
  let manager: DatabaseManager;
  beforeEach(async () => {
    await IndexedDbService.init();
    const db = await openDB("mremote-keyval", 1);
    await db.clear("keyval");
    db.close();
    DatabaseManager.resetInstance();
    vi.spyOn(SettingsManager.prototype, "logAction").mockImplementation(
      () => {},
    );
    manager = DatabaseManager.getInstance();
  });
  afterEach(() => {
    DatabaseManager.resetInstance();
    vi.restoreAllMocks();
  });
  it("omits private document content from routine exports even with credentials included", async () => {
    const database = await manager.createDatabase("Synthetic export");
    // Crafted legacy fixture in fake IDB only; the document writer never permits this route.
    await manager.saveDatabaseData(database.id, {
      connections: [],
      settings: {},
      timestamp: 1,
      documents: fixture(),
    });
    for (const includePasswords of [false, true]) {
      const json = await manager.exportDatabase(database.id, includePasswords);
      expect(JSON.parse(json)).not.toHaveProperty("documents");
      expect(json).not.toContain("PRIVATE_FIXTURE");
    }
  });
  it("refuses plaintext archives before creating a destination", async () => {
    const create = vi.spyOn(manager, "createDatabase");
    await expect(
      manager.importDatabase(
        JSON.stringify({
          collection: { name: "Unsafe" },
          connections: [],
          documents: fixture(),
        }),
      ),
    ).rejects.toThrow(/encrypted source/);
    expect(create).not.toHaveBeenCalled();
    expect(await manager.getAllDatabases()).toEqual([]);
  });
  it("whole-database copy remaps only owned links and preserves secret bytes without mutating source", () => {
    const source = {
      connections: [],
      settings: {},
      timestamp: 1,
      documents: fixture(),
    };
    const copy = rebindDatabaseQuickActions(source, "db-a", "db-copy");
    const block = copy.documents!.documents[0].blocks.find(
      (item) => item.type === "spreadsheet",
    );
    expect(
      block?.type === "spreadsheet" &&
        block.workbook.sheets[0].cells.A1.reference?.databaseId,
    ).toBe("db-copy");
    expect(JSON.stringify(copy.documents)).toContain("PRIVATE_FIXTURE");
    expect(source.documents).toEqual(fixture());
  });
});
