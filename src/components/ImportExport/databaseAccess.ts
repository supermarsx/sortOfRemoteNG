import type { DatabaseManager } from "../../utils/connection/databaseManager";
import * as databaseEvents from "../../utils/connection/databaseManager";

export function subscribeImportExportAccess(refresh: () => void): () => void {
  const removeCurrent =
    "onCurrentDatabaseChange" in databaseEvents
      ? databaseEvents.onCurrentDatabaseChange(refresh)
      : undefined;
  const removeAccess =
    "onDatabaseAccessChange" in databaseEvents
      ? databaseEvents.onDatabaseAccessChange(refresh)
      : undefined;
  return () => {
    removeCurrent?.();
    removeAccess?.();
  };
}

/** Without an open database, the manager must prove residency and fence access on eviction. */
export async function listImportExportDatabases(manager: DatabaseManager) {
  if (manager.getCurrentDatabase()) return manager.getExportableDatabases();
  return (await manager.getMemoryResidentDatabases()).filter(
    (database) => database.isExportable && database.isUnlocked,
  );
}

export async function readImportExportDatabase(
  manager: DatabaseManager,
  ...args: Parameters<DatabaseManager["readExportableDatabaseSnapshot"]>
) {
  if (manager.getCurrentDatabase())
    return manager.readExportableDatabaseSnapshot(...args);
  return manager.readMemoryResidentDatabaseSnapshot(...args);
}

export async function appendImportExportDatabase(
  manager: DatabaseManager,
  ...args: Parameters<DatabaseManager["appendConnectionsToDatabase"]>
) {
  if (manager.getCurrentDatabase())
    return manager.appendConnectionsToDatabase(...args);
  return manager.appendConnectionsToMemoryResidentDatabase(...args);
}
