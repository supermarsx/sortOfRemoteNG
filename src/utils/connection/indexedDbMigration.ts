/**
 * One-shot migrator from IndexedDB-backed database storage to the
 * file-based storage shipped in P1.
 *
 * Architecture: IndexedDB is a browser-side store, unreachable from
 * Rust. So this migrator lives on the TS side and uses the new
 * P1 Tauri commands (`save_database_data`, `databases_save_index`)
 * as its write surface. Each per-database file inherits P1's
 * fail-safe guarantees (preamble + checksum + atomic temp+rename +
 * sibling `.bak` for recovery), so a crash mid-migration leaves
 * the IndexedDB rows intact AND any files that did land cleanly.
 *
 * Idempotency: the migrator checks if `databases_list()` returns
 * a non-empty index first. If yes, migration already ran (or the
 * user is a fresh install that wrote directly to files) — skip
 * silently.
 *
 * Verification: after each per-database write, we read the file
 * back through `load_database_data` and compare payload equality
 * before counting the migration as successful. A mismatch leaves
 * the IndexedDB row in place and logs a failure.
 *
 * Rollback: we do NOT delete the IndexedDB rows for one release
 * cycle. The user can roll back manually by clearing the files
 * directory; the IDB rows are still there. P5 will retire the IDB
 * surface entirely.
 */

import { getInvoke } from "../tauri/invoke";
import { IndexedDbService } from "../storage/indexedDbService";

const DATABASES_LIST_KEY = "mremote-databases";
const LEGACY_DATABASES_LIST_KEY = "mremote-collections";
const PER_DB_KEY_PREFIX = "mremote-database-";
const LEGACY_PER_DB_KEY_PREFIX = "mremote-collection-";

export interface MigrationReport {
  /** How many database files were freshly written. */
  migrated: number;
  /** How many rows were skipped because the file already existed. */
  alreadyOnDisk: number;
  /** Rows the migrator could not move (read-back mismatch, missing
   *  data, etc.). The IDB rows for these stay in place — the user
   *  can retry by re-running the boot. */
  failed: number;
  /** Per-failure detail surfaced to the UI (or the console). */
  failures: Array<{ id: string; reason: string }>;
  /** True when no work was done because the index already exists on
   *  disk. Distinguishes "migration ran" from "first-run on fresh
   *  install" for telemetry. */
  alreadyMigrated: boolean;
}

interface LoadResultEnvelope {
  value: unknown;
  source: "current" | "backup" | "v0-migration";
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Run the migrator. Safe to call on every boot — idempotent and
 * cheap on a no-op run.
 */
export async function migrateIndexedDbToFiles(): Promise<MigrationReport> {
  const report: MigrationReport = {
    migrated: 0,
    alreadyOnDisk: 0,
    failed: 0,
    failures: [],
    alreadyMigrated: false,
  };

  const invoke = (await getInvoke()) as Invoke | null;
  if (!invoke) {
    // Browser-only build: nothing to migrate to. Skip silently.
    return report;
  }

  // ── Step 1: idempotency check. If `databases_list` returns a
  // non-empty index, the migration already happened (or the user
  // started on the file-based store directly). Either way, leave
  // the IndexedDB rows alone.
  try {
    const existing = await invoke<LoadResultEnvelope | null>("databases_list");
    if (existing && Array.isArray(existing.value) && existing.value.length > 0) {
      report.alreadyMigrated = true;
      return report;
    }
  } catch (e) {
    // The new command should always exist after P1, so a failure
    // here is a real backend problem. Bail without touching IDB.
    report.failed = 1;
    report.failures.push({
      id: "<probe>",
      reason: `databases_list failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return report;
  }

  // ── Step 2: read the list from IndexedDB. Try the current key,
  // then the legacy "mremote-collections" key.
  let dbList = await IndexedDbService.getItem<unknown[]>(DATABASES_LIST_KEY);
  if (!dbList) {
    dbList = await IndexedDbService.getItem<unknown[]>(LEGACY_DATABASES_LIST_KEY);
  }
  if (!dbList || !Array.isArray(dbList) || dbList.length === 0) {
    // Nothing to migrate. Not an error — fresh install.
    return report;
  }

  // ── Step 3: migrate each per-database payload. Write via
  // `save_database_data`, then verify by reading back through
  // `load_database_data`. Only count a row as migrated when the
  // round-trip succeeds.
  for (const raw of dbList) {
    const id = typeof raw === "object" && raw && "id" in raw ? String((raw as any).id) : null;
    if (!id) {
      report.failed += 1;
      report.failures.push({
        id: "<unknown>",
        reason: "database entry has no id field",
      });
      continue;
    }

    // Per-database payload — try the current key first, then the
    // legacy alias the databaseManager already migrates over.
    let payload = await IndexedDbService.getItem<unknown>(
      `${PER_DB_KEY_PREFIX}${id}`,
    );
    if (payload === undefined || payload === null) {
      payload = await IndexedDbService.getItem<unknown>(
        `${LEGACY_PER_DB_KEY_PREFIX}${id}`,
      );
    }
    if (payload === undefined || payload === null) {
      // No payload row for this metadata entry — the database is
      // empty / never saved. Skip but don't fail; the user can
      // still see the entry in the picker.
      continue;
    }

    try {
      // Already a file? Then we're picking up where a previous
      // migration run left off — don't re-write, just count.
      const onDisk = await invoke<LoadResultEnvelope | null>(
        "load_database_data",
        { databaseId: id },
      );
      if (onDisk && onDisk.value !== null && onDisk.value !== undefined) {
        report.alreadyOnDisk += 1;
        continue;
      }

      // Write via the safe writer.
      await invoke<void>("save_database_data", {
        databaseId: id,
        data: payload,
      });

      // Read-back verification. The payload from IDB and the
      // payload we just wrote must round-trip JSON-equal.
      const verified = await invoke<LoadResultEnvelope | null>(
        "load_database_data",
        { databaseId: id },
      );
      if (!verified) {
        throw new Error("read-back returned null");
      }
      if (!jsonEqual(verified.value, payload)) {
        throw new Error("read-back payload does not match written payload");
      }

      report.migrated += 1;
    } catch (e) {
      report.failed += 1;
      report.failures.push({
        id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Step 4: write the index list itself. Use the same safe
  // writer; failure here doesn't undo per-database migrations
  // (those files exist on disk), but means the user will keep
  // seeing the IDB-backed picker until the next boot retries.
  try {
    await invoke<void>("databases_save_index", { list: dbList });
  } catch (e) {
    report.failures.push({
      id: "<index>",
      reason: e instanceof Error ? e.message : String(e),
    });
    report.failed += 1;
  }

  return report;
}

/**
 * Structural equality for JSON-like values. Used by the read-back
 * verification so we don't depend on reference identity.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const ba = b as unknown[];
    if (a.length !== ba.length) return false;
    return a.every((v, i) => jsonEqual(v, ba[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => jsonEqual(ao[k], bo[k]));
}
