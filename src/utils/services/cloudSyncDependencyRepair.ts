import { DatabaseManager } from "../connection/databaseManager";
import { repairSafeArchiveDependencies } from "../connection/archiveDependencyResolution";
import { assertArchiveDependencyRefresh } from "../connection/archiveDependencyRefresh";
import { createAutomationLibraryApi } from "../recording/automationLibrary";
import {
  normalizeAutomationEntry,
  normalizeDatabaseAutomationLibrary,
} from "../recording/automationLibraryValidation";
import { stableJsonStringify } from "../core/stableJsonStringify";
import {
  acquireCloudSyncDatabaseBarrier,
  type CloudSyncDependencyRepairIntent,
} from "./cloudSyncDatabaseBarrier";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationScope,
} from "../../types/recording/automationLibrary";

/** Only the actual sync failure handler may call this; captures/reviews stay read-only. */
export async function repairCloudSyncArchiveDependencies(
  databaseId: string,
  assertCurrent: () => void,
): Promise<number> {
  const manager = DatabaseManager.getInstance();
  // Capture ownership before even acquiring the asynchronous writer barrier.
  const destination = manager.captureDatabaseOperationGuard([databaseId]);
  const sources = new Map<
    string,
    ReturnType<typeof manager.captureDatabaseOperationGuard>
  >();
  const ready = (id: string) => {
    const state = manager.getDatabaseAccessState(id);
    if (state ? state.status !== "ready" : !manager.isDatabaseUnlocked(id))
      throw new Error("Database access is unavailable.");
  };
  const check = () => {
    assertCurrent();
    destination.assertCurrent();
    ready(databaseId);
    for (const [id, guard] of sources) {
      guard.assertCurrent();
      ready(id);
    }
  };
  const app = createAutomationLibraryApi(undefined, check);
  const snapshots = new Map<
    string,
    {
      scope: AutomationScope;
      family: AutomationFamily;
      id: string;
      entry: AutomationEntry;
    }
  >();
  const read = async (
    scope: AutomationScope,
    family: AutomationFamily,
    id: string,
  ): Promise<AutomationEntry | undefined> => {
    check();
    let entry: AutomationEntry | undefined;
    if (scope.kind === "app") {
      entry = (await app.read(scope, family)).entries.find(
        (item) => item.payload.id === id,
      );
      check();
    } else {
      ready(scope.databaseId);
      if (!sources.has(scope.databaseId))
        sources.set(
          scope.databaseId,
          manager.captureDatabaseOperationGuard([scope.databaseId]),
        );
      check();
      await sources.get(scope.databaseId)!.verifyCurrent();
      check();
      const data = await manager.loadDatabaseData(scope.databaseId);
      check();
      if (!data) return undefined;
      const library = normalizeDatabaseAutomationLibrary(
        data.automationLibrary,
      );
      const payloads =
        family === "terminal-script"
          ? [
              ...library.terminalScripts.customScripts,
              ...library.terminalScripts.modifiedDefaults,
            ]
          : family === "terminal-macro"
            ? library.terminalMacros
            : family === "website-script"
              ? library.website.scripts
              : library.website.macros;
      const payload = payloads.find((item) => item.id === id);
      if (payload)
        entry = normalizeAutomationEntry({
          family,
          payload,
          ...(library.provenance[`${family}:${id}`]
            ? { provenance: library.provenance[`${family}:${id}`] }
            : {}),
        });
    }
    if (!entry || entry.family !== family || entry.payload.id !== id)
      return undefined;
    return structuredClone(normalizeAutomationEntry(entry));
  };
  const readSource = async (
    scope: AutomationScope,
    family: AutomationFamily,
    id: string,
  ) => {
    check();
    const key = stableJsonStringify({ scope, family, id });
    const previous = snapshots.get(key);
    // Repeated references and bounded passes use one immutable reviewed item.
    // Every cached source is freshly re-read below, outside the pure helper's
    // intentional unavailable-source catch, immediately before the CAS.
    if (previous) return structuredClone(previous.entry);
    const entry = await read(scope, family, id);
    check();
    if (entry)
      snapshots.set(key, {
        scope: structuredClone(scope),
        family,
        id,
        entry: structuredClone(entry),
      });
    return entry;
  };
  let release: (() => Promise<void>) | undefined;
  const intent: CloudSyncDependencyRepairIntent = { kind: "dependency-repair" };
  let repairedCount = 0;
  let committed = false;
  let uncertainCommit = false;
  let partialRefresh = false;
  let failure: unknown;
  try {
    check();
    release = await acquireCloudSyncDatabaseBarrier(
      [databaseId],
      false,
      intent,
    );
    check();
    await destination.verifyCurrent();
    check();
    const original = await manager.loadDatabaseData(databaseId);
    check();
    if (!original) throw new Error("Database unavailable.");
    let data = original;
    for (let pass = 0; pass < 32; pass++) {
      const before = stableJsonStringify(data);
      const result = await repairSafeArchiveDependencies(
        databaseId,
        data,
        readSource,
      );
      check();
      if (!result.repaired) break;
      if (stableJsonStringify(result.data) === before)
        throw new Error("Dependency repair made no progress.");
      repairedCount += result.repaired;
      data = result.data;
      if (!result.remaining.totalIssues) break;
    }
    if (repairedCount) {
      for (const snapshot of snapshots.values()) {
        const fresh = await read(snapshot.scope, snapshot.family, snapshot.id);
        check();
        if (stableJsonStringify(fresh) !== stableJsonStringify(snapshot.entry))
          throw new Error("A dependency changed.");
      }
      check();
      assertArchiveDependencyRefresh(databaseId, original, data);
      try {
        await manager.commitArchiveDependencyRepair(databaseId, original, data);
      } catch (error) {
        uncertainCommit =
          typeof error === "object" &&
          error !== null &&
          "kind" in error &&
          error.kind === "partial";
        intent.uncertain = uncertainCommit;
        throw error;
      }
      committed = true;
      intent.receipt = { before: original, after: data };
      check();
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      await release?.();
      if (!failure) check();
    } catch (error) {
      partialRefresh =
        typeof error === "object" &&
        error !== null &&
        "kind" in error &&
        error.kind === "partial";
      failure = error;
    }
    app.invalidateReviews();
  }
  if (failure) {
    const partial = committed || uncertainCommit || partialRefresh;
    throw Object.assign(
      new Error(
        partial
          ? "Dependency copies may have been saved locally, but sync preparation did not finish. Reload the database before retrying."
          : "Automatic dependency repair did not finish. Review the selected database and its available script sources before retrying.",
      ),
      partial
        ? {
            kind: "partial" as const,
            repairedCount: committed ? repairedCount : 0,
          }
        : {},
    );
  }
  return repairedCount;
}
