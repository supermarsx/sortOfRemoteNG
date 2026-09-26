import type { ConnectionDatabase } from "../../types/connection/connection";
import type { DatabaseManager } from "./databaseManager";

export type DatabaseActionManager = Pick<
  DatabaseManager,
  | "getDatabase"
  | "getAllDatabases"
  | "getCurrentDatabase"
  | "duplicateDatabase"
  | "deleteDatabase"
  | "lockDatabase"
  | "closeCurrentDatabase"
  | "unlockDatabase"
  | "isDatabaseUnlocked"
  | "updateDatabase"
  | "changeDatabasePassword"
  | "removePasswordFromDatabase"
  | "readExportableDatabaseSnapshot"
>;

export interface DatabaseActionContext {
  manager: DatabaseActionManager;
  /** Persist the current React snapshot and drain its pending writes. */
  flushCurrent: () => Promise<void>;
  /** Clear the host's connection state and auto-open pointer after closure. */
  onCurrentClosed?: () => Promise<void> | void;
  /** Stop sensitive sessions/views before dropping the current unlock key. */
  beforeCurrentLock?: () => Promise<void>;
  /** Non-secret phase reporting; never changes the mutation or cancellation boundary. */
  onProgress?: (phase: string) => void;
}

export type DatabaseAction =
  | { type: "clone"; password?: string }
  | { type: "delete" }
  | { type: "lock" }
  | { type: "unlock"; password?: string }
  | {
      type: "metadata";
      namePattern?: string;
      description?: string;
      index: number;
    };

export interface DatabaseActionOutcome {
  status: "success" | "skipped";
  message: string;
  createdId?: string;
}

const mutationQueues = new WeakMap<object, Promise<void>>();

/** Shared by collection and Settings actions; a failed operation cannot wedge the queue. */
export function withDatabaseMutation<T>(
  manager: DatabaseActionManager,
  action: () => Promise<T>,
): Promise<T> {
  const previous = mutationQueues.get(manager) ?? Promise.resolve();
  const next = previous.then(action, action);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(manager, settled);
  void settled.then(() => {
    if (mutationQueues.get(manager) === settled) mutationQueues.delete(manager);
  });
  return next;
}

/** Never close or capture a replacement database after waiting on a save. */
export async function flushDatabaseIfCurrent(
  id: string,
  context: DatabaseActionContext,
): Promise<boolean> {
  if (context.manager.getCurrentDatabase()?.id !== id) return false;
  await context.flushCurrent();
  if (context.manager.getCurrentDatabase()?.id !== id) {
    throw new Error(
      "The active database changed while saving. Retry this item.",
    );
  }
  return true;
}

function metadataUpdate(
  collection: ConnectionDatabase,
  action: Extract<DatabaseAction, { type: "metadata" }>,
): ConnectionDatabase {
  const name = action.namePattern
    ? action.namePattern
        .replace(/\{name\}/g, () => collection.name)
        .replace(/\{index\}/g, () => String(action.index))
        .trim()
    : collection.name;
  if (!name) throw new Error("Database names cannot be empty.");
  if (action.namePattern && !/\{(?:name|index)\}/.test(action.namePattern)) {
    throw new Error("Use {name} or {index} in the rename pattern.");
  }
  return {
    ...collection,
    name,
    ...(action.description !== undefined
      ? { description: action.description }
      : {}),
  };
}

/** Credentials are supplied per target and are never persisted by this layer. */
export function performDatabaseAction(
  id: string,
  action: DatabaseAction,
  context: DatabaseActionContext,
): Promise<DatabaseActionOutcome> {
  const report = (phase: string) => {
    try {
      context.onProgress?.(phase);
    } catch {
      // Presentation cannot abort a database mutation.
    }
  };
  return withDatabaseMutation(context.manager, async () => {
    const { manager } = context;
    report("Checking the database…");
    const collection = await manager.getDatabase(id);
    if (!collection) throw new Error("This database no longer exists.");

    switch (action.type) {
      case "clone": {
        report("Copying the database…");
        await flushDatabaseIfCurrent(id, context);
        const created = await manager.duplicateDatabase(id, {
          password: action.password,
        });
        return {
          status: "success",
          message: `Created ${created.name}`,
          createdId: created.id,
        };
      }
      case "delete": {
        report("Saving pending changes…");
        const wasCurrent = await flushDatabaseIfCurrent(id, context);
        if (wasCurrent && context.beforeCurrentLock) {
          report("Closing active sessions and sensitive views…");
          await context.beforeCurrentLock();
          report("Finishing pending writes…");
          await flushDatabaseIfCurrent(id, context);
        }
        report("Deleting the database and its stored data…");
        await manager.deleteDatabase(id);
        if (wasCurrent) {
          report("Clearing the closed database from the workspace…");
          await context.onCurrentClosed?.();
        }
        return { status: "success", message: "Deleted" };
      }
      case "lock": {
        report("Saving and closing the database…");
        const wasCurrent = await flushDatabaseIfCurrent(id, context);
        if (wasCurrent && context.beforeCurrentLock) {
          await context.beforeCurrentLock();
          await flushDatabaseIfCurrent(id, context);
        }
        if (
          !wasCurrent &&
          (!collection.isEncrypted ||
            (!manager.isDatabaseUnlocked(id) &&
              collection.protectionFormat !== "sorng-db"))
        ) {
          return {
            status: "skipped",
            message: collection.isEncrypted
              ? "Already locked"
              : "Not open or encrypted",
          };
        }
        if (collection.isEncrypted) await manager.lockDatabase(id);
        else await manager.closeCurrentDatabase();
        if (wasCurrent) await context.onCurrentClosed?.();
        return {
          status: "success",
          message: wasCurrent ? "Closed and locked where encrypted" : "Locked",
        };
      }
      case "unlock": {
        report("Unlocking the database…");
        if (!collection.isEncrypted || manager.isDatabaseUnlocked(id)) {
          return {
            status: "skipped",
            message: collection.isEncrypted
              ? "Already unlocked"
              : "Not encrypted",
          };
        }
        if (!action.password)
          throw new Error("Enter this database's password to unlock it.");
        await manager.unlockDatabase(id, action.password);
        return { status: "success", message: "Unlocked without opening" };
      }
      case "metadata": {
        report("Updating database metadata…");
        const updated = metadataUpdate(collection, action);
        if (updated.name !== collection.name) {
          const all = await manager.getAllDatabases();
          if (
            all.some(
              (item) =>
                item.id !== id &&
                item.name.trim().toLocaleLowerCase() ===
                  updated.name.toLocaleLowerCase(),
            )
          ) {
            throw new Error(`A database named ${updated.name} already exists.`);
          }
        }
        await flushDatabaseIfCurrent(id, context);
        await manager.updateDatabase(updated);
        return {
          status: "success",
          message: "Metadata updated; encryption unchanged",
        };
      }
    }
  });
}
