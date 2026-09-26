import { describe, expect, it, vi } from "vitest";
import {
  listImportExportDatabases,
  readImportExportDatabase,
  appendImportExportDatabase,
} from "../../src/components/ImportExport/databaseAccess";
import type { DatabaseManager } from "../../src/utils/connection/databaseManager";

function managerFixture() {
  const resident = { id: "resident", isExportable: true, isUnlocked: true };
  const mock = {
    getCurrentDatabase: vi.fn().mockReturnValue(null),
    getExportableDatabases: vi
      .fn()
      .mockResolvedValue([{ id: "unopened", isExportable: true }]),
    getMemoryResidentDatabases: vi.fn().mockResolvedValue([resident]),
    readExportableDatabaseSnapshot: vi.fn(),
    readMemoryResidentDatabaseSnapshot: vi
      .fn()
      .mockResolvedValue({ collection: resident, connections: [] }),
    appendConnectionsToDatabase: vi.fn(),
    appendConnectionsToMemoryResidentDatabase: vi.fn(),
  };
  return { mock, manager: mock as unknown as DatabaseManager };
}

describe("database access without an open database", () => {
  it("offers only resident databases and never lists or reads disk databases", async () => {
    const { mock, manager } = managerFixture();
    expect(await listImportExportDatabases(manager)).toEqual([
      { id: "resident", isExportable: true, isUnlocked: true },
    ]);
    await readImportExportDatabase(manager, "resident", false, {
      includeTrust: false,
    });
    expect(mock.readMemoryResidentDatabaseSnapshot).toHaveBeenCalledWith(
      "resident",
      false,
      { includeTrust: false },
    );
    expect(mock.getExportableDatabases).not.toHaveBeenCalled();
    expect(mock.readExportableDatabaseSnapshot).not.toHaveBeenCalled();
  });

  it("routes writes through the residency-guarded API", async () => {
    const { mock, manager } = managerFixture();
    await appendImportExportDatabase(manager, "resident", [], {
      includeTrust: false,
    });
    expect(mock.appendConnectionsToMemoryResidentDatabase).toHaveBeenCalledWith(
      "resident",
      [],
      { includeTrust: false },
    );
    expect(mock.appendConnectionsToDatabase).not.toHaveBeenCalled();
  });

  it("removes closed and locked residents and rejects a stale read without disk fallback", async () => {
    const { mock, manager } = managerFixture();
    expect(await listImportExportDatabases(manager)).toHaveLength(1);
    mock.getMemoryResidentDatabases.mockResolvedValue([
      { id: "resident", isUnlocked: false, isExportable: false },
    ]);
    mock.readMemoryResidentDatabaseSnapshot.mockRejectedValue(
      new Error("Database evicted"),
    );
    expect(await listImportExportDatabases(manager)).toEqual([]);
    await expect(readImportExportDatabase(manager, "resident")).rejects.toThrow(
      "Database evicted",
    );
    expect(mock.readExportableDatabaseSnapshot).not.toHaveBeenCalled();
    mock.getMemoryResidentDatabases.mockResolvedValue([]);
    expect(await listImportExportDatabases(manager)).toEqual([]);
  });

  it("fails closed when the manager cannot prove residency", async () => {
    const { mock, manager } = managerFixture();
    mock.getMemoryResidentDatabases.mockResolvedValue([]);
    mock.readMemoryResidentDatabaseSnapshot.mockRejectedValue(
      new Error("not available in memory"),
    );
    mock.appendConnectionsToMemoryResidentDatabase.mockRejectedValue(
      new Error("not available for changes in memory"),
    );
    expect(await listImportExportDatabases(manager)).toEqual([]);
    await expect(readImportExportDatabase(manager, "unopened")).rejects.toThrow(
      "not available in memory",
    );
    await expect(
      appendImportExportDatabase(manager, "unopened", []),
    ).rejects.toThrow("not available for changes in memory");
    expect(mock.getExportableDatabases).not.toHaveBeenCalled();
    expect(mock.readExportableDatabaseSnapshot).not.toHaveBeenCalled();
  });
});
