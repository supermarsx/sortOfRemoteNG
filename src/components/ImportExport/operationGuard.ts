import type { DatabaseManager } from "../../utils/connection/databaseManager";

/** Bind async operations to the original workspace generation and manager access epochs. */
export function captureImportExportOperation(
  manager: DatabaseManager,
  databaseIds: readonly string[],
  getGeneration: () => number | undefined,
) {
  const guards = [manager.captureDatabaseOperationGuard(databaseIds)];
  const ids = new Set(databaseIds);
  const currentId = manager.getCurrentDatabase()?.id;
  const generation = getGeneration();
  const assertCurrent = () => {
    guards.forEach((guard) => guard.assertCurrent());
    if (
      ids.size > 0 &&
      (manager.getCurrentDatabase()?.id !== currentId ||
        getGeneration() !== generation)
    ) {
      throw new Error(
        "Database workspace changed during this operation. Review the selection and retry.",
      );
    }
  };
  return {
    addDatabases: (additionalIds: readonly string[]) => {
      assertCurrent();
      const added = additionalIds.filter((id) => !ids.has(id));
      if (added.length)
        guards.push(manager.captureDatabaseOperationGuard(added));
      added.forEach((id) => ids.add(id));
      assertCurrent();
    },
    assertCurrent,
    verifyCurrent: async () => {
      assertCurrent();
      for (const guard of guards) await guard.verifyCurrent();
      assertCurrent();
    },
  };
}

export type ImportExportOperation = ReturnType<
  typeof captureImportExportOperation
>;
