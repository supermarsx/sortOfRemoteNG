import type { GlobalSettings } from "../../types/settings/settings";
import type { DatabaseManager, CurrentDatabaseChange } from "./databaseManager";
import type { SettingsManager } from "../settings/settingsManager";
import { singleOsVaultUnlockSlot } from "./databaseUnlockMethods";

type OpenSet = NonNullable<GlobalSettings["databaseOpenSet"]>;
const emptySet = (): OpenSet => ({
  version: 1,
  databaseIds: [],
  activeDatabaseId: null,
});
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id);

export function readDatabaseOpenSet(
  settings: Pick<GlobalSettings, "databaseOpenSet" | "lastOpenedCollectionId">,
): OpenSet {
  const value = settings.databaseOpenSet;
  // An explicit empty (or invalid) new record must not resurrect the old ID.
  if (value === undefined) {
    const id = settings.lastOpenedCollectionId;
    return validId(id)
      ? { version: 1, databaseIds: [id], activeDatabaseId: id }
      : emptySet();
  }
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.databaseIds) ||
    value.databaseIds.length > 256 ||
    !value.databaseIds.every(validId) ||
    !(value.activeDatabaseId === null || validId(value.activeDatabaseId))
  )
    return emptySet();
  const ids = [...new Set(value.databaseIds)];
  return {
    version: 1,
    databaseIds: ids,
    activeDatabaseId:
      value.activeDatabaseId && ids.includes(value.activeDatabaseId)
        ? value.activeDatabaseId
        : null,
  };
}

/** One owner for startup and later open/close intent; never persists credentials. */
export function startDatabaseStartupSession({
  manager,
  settings,
  loadData,
  showChooser,
  isCurrent,
  safeMode = false,
  ownerWindow,
  restoreOnStart = true,
}: {
  manager: DatabaseManager;
  settings: SettingsManager;
  loadData: (id: string) => Promise<boolean>;
  showChooser: () => void;
  isCurrent: () => boolean;
  safeMode?: boolean;
  ownerWindow: boolean;
  restoreOnStart?: boolean;
}) {
  if (!ownerWindow) return { restore: Promise.resolve(), dispose: () => {} };
  let snapshot = readDatabaseOpenSet(settings.getSettings());
  let disposed = false;
  let restoring = true;
  let interrupted = false;
  let activating: string | undefined;
  let pendingUserChange = false;
  let mutation = 0;
  let saves = Promise.resolve();
  const live = () => !disposed && isCurrent();
  const save = () => {
    const next = structuredClone(snapshot);
    saves = saves
      .catch(() => undefined)
      .then(async () => {
        if (!live()) return;
        await settings.saveSettings(
          {
            databaseOpenSet: next,
            lastOpenedCollectionId: next.activeDatabaseId ?? undefined,
          },
          { silent: true },
        );
      })
      .catch(() => {
        // SettingsManager reports durable failures; never fail or retry a DB open.
      });
    return saves;
  };
  const changed = (change: CurrentDatabaseChange) => {
    if (!live()) return;
    if (!["open", "switch", "close", "delete"].includes(change.reason)) return;
    if (
      restoring &&
      activating === change.databaseId &&
      (change.reason === "open" || change.reason === "switch")
    )
      return;
    mutation++;
    if (restoring) {
      interrupted = true;
      pendingUserChange = true;
    }
    const ids = new Set(snapshot.databaseIds);
    if (change.reason === "close" || change.reason === "delete") {
      const removed = change.databaseId ?? change.previousDatabaseId;
      if (removed) ids.delete(removed);
    } else if (change.database?.id) ids.add(change.database.id);
    snapshot = {
      version: 1,
      databaseIds: [...ids],
      activeDatabaseId:
        change.database?.id && ids.has(change.database.id)
          ? change.database.id
          : null,
    };
    if (!restoring) void save();
  };
  const unsubscribe = manager.onCurrentDatabaseChange(changed);
  const restore = (async () => {
    let inspected = false;
    let needsChooser = false;
    try {
      // Reconcile a selection made before subscription, without reloading it.
      const selected = manager.getCurrentDatabase();
      if (selected) {
        snapshot = {
          version: 1,
          databaseIds: [...new Set([...snapshot.databaseIds, selected.id])],
          activeDatabaseId: selected.id,
        };
        pendingUserChange = true;
        return;
      }
      if (
        !restoreOnStart ||
        safeMode ||
        !settings.getSettings().autoOpenLastCollection ||
        !snapshot.databaseIds.length
      )
        return;
      const guard = manager.captureStartupRestoreGuard();
      const current = () => {
        const allowed =
          live() &&
          !interrupted &&
          settings.getSettings().autoOpenLastCollection &&
          guard();
        if (!allowed) interrupted = true;
        return allowed;
      };
      const databases = await manager.getAllDatabases();
      if (!current()) return;
      inspected = true;
      const existing = new Map(
        databases.map((database) => [database.id, database]),
      );
      const ids = snapshot.databaseIds.filter((id) => existing.has(id));
      needsChooser = ids.length !== snapshot.databaseIds.length;
      snapshot = {
        version: 1,
        databaseIds: ids,
        activeDatabaseId:
          snapshot.activeDatabaseId && ids.includes(snapshot.activeDatabaseId)
            ? snapshot.activeDatabaseId
            : null,
      };
      // Side databases never become the active tree. Activate the saved owner last.
      const order = [
        ...ids.filter((id) => id !== snapshot.activeDatabaseId),
        ...(snapshot.activeDatabaseId ? [snapshot.activeDatabaseId] : []),
      ];
      for (const id of order) {
        if (!current()) return;
        const database = existing.get(id)!;
        try {
          if (
            database.protectionFormat === "sorng-db" &&
            !manager.isDatabaseUnlocked(id)
          ) {
            const status = await manager.getDatabaseProtectionStatus(id);
            if (!current()) return;
            const slot = singleOsVaultUnlockSlot(status);
            if (!slot) {
              needsChooser = true;
              continue;
            }
            const capabilities =
              await manager.getDatabaseProtectionCapabilities();
            if (!current()) return;
            if (
              !capabilities.protectors.some(
                (protector) =>
                  protector.id === "os-vault" && protector.available,
              )
            ) {
              needsChooser = true;
              continue;
            }
            await manager.unlockManagedDatabase(id, slot.id, undefined, {
              isCurrent: current,
            });
            if (!current()) return;
          } else if (
            database.isEncrypted &&
            database.protectionFormat !== "sorng-db" &&
            !manager.isDatabaseUnlocked(id)
          ) {
            needsChooser = true;
            continue;
          }
          const active = id === snapshot.activeDatabaseId;
          activating = active ? id : undefined;
          await manager.restoreDatabase(id, {
            activate: active,
            isCurrent: current,
          });
          activating = undefined;
          if (
            !live() ||
            interrupted ||
            !settings.getSettings().autoOpenLastCollection
          )
            return;
          if (active) {
            if (manager.getCurrentDatabase()?.id !== id) return;
            if (!(await loadData(id))) {
              interrupted = true;
              return;
            }
          }
        } catch {
          // No password prompt, password persistence, alternate protector, or retry.
          activating = undefined;
          if (!live() || interrupted) return;
          needsChooser = true;
        }
      }
    } catch {
      // A failed inventory read is not proof of deletion: preserve the saved set.
      needsChooser = true;
    } finally {
      restoring = false;
      if (live()) {
        const beforeSave = mutation;
        const stillOwned = manager.captureStartupRestoreGuard();
        if ((inspected && !interrupted) || pendingUserChange) await save();
        if (
          needsChooser &&
          !interrupted &&
          live() &&
          mutation === beforeSave &&
          stillOwned()
        )
          showChooser();
      }
    }
  })();
  return {
    restore,
    dispose: () => {
      disposed = true;
      unsubscribe();
    },
  };
}
