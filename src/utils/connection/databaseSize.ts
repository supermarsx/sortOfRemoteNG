import { IndexedDbService } from "../storage/indexedDbService";
import { getInvoke } from "../tauri/invoke";

export type DatabaseSize = {
  bytes?: number;
  status: "measured" | "missing" | "unavailable";
  source?: "stored-file" | "browser-json";
  reason?: string;
};

const batchLimit = 256;
const metadataUnavailable =
  "Could not read the stored database size. Refresh to retry; database contents were not opened or changed.";
const missingDatabase =
  "The current database file is missing. Check that the database is still stored on this device; recovery backups are not counted.";
const unavailable = (reason = metadataUnavailable): DatabaseSize => ({
  status: "unavailable",
  reason,
});

function validId(id: string): boolean {
  // Native validation remains authoritative. Accept Unicode names and spaces
  // just as database storage does; never accept a path or reserved index name.
  return (
    id.length > 0 &&
    id.trim() === id &&
    new TextEncoder().encode(id).byteLength <= 128 &&
    /^[\p{Alphabetic}\p{N} _-]+$/u.test(id) &&
    !/^(index|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)
  );
}

function validBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Actual canonical-file bytes (envelope included), independent of unlock or
 * export eligibility. Excludes backups, trust sidecars and unsaved changes.
 * Browser-only mode reports stored JSON bytes, not a fictitious disk size.
 * No cross-refresh cache: saves, imports and encryption can change file size.
 */
export async function readDatabaseSizes(
  ids: readonly string[],
): Promise<Record<string, DatabaseSize>> {
  const result: Record<string, DatabaseSize> = Object.create(null);
  const valid: string[] = [];
  for (const id of new Set(ids)) {
    result[id] = unavailable();
    if (validId(id)) valid.push(id);
    else
      result[id] = unavailable(
        "This database identifier is not valid for storage.",
      );
  }
  if (!valid.length) return result;

  let invoke;
  try {
    invoke = await getInvoke();
  } catch {
    return result;
  }
  if (invoke) {
    for (let offset = 0; offset < valid.length; offset += batchLimit) {
      const batch = valid.slice(offset, offset + batchLimit);
      try {
        const response = await invoke<unknown>("get_database_file_sizes", {
          databaseIds: batch,
        });
        if (!Array.isArray(response)) continue;
        const requested = new Set(batch);
        const seen = new Set<string>();
        for (const entry of response) {
          if (!entry || typeof entry !== "object") continue;
          const { databaseId: id, status, bytes } = entry;
          if (typeof id !== "string" || !requested.has(id)) continue;
          // An ambiguous/malformed backend response must never show a made-up size.
          if (seen.has(id)) {
            result[id] = unavailable();
            continue;
          }
          seen.add(id);
          if (status === "measured" && validBytes(bytes))
            result[id] = { status, bytes, source: "stored-file" };
          else if (status === "missing" && bytes == null)
            result[id] = { status, reason: missingDatabase };
        }
      } catch (error) {
        // Never fall back to a stale browser copy when native storage fails.
        const message = error instanceof Error ? error.message : String(error);
        if (/command.*(?:not found|unknown)|unknown.*command/i.test(message)) {
          for (const id of batch)
            result[id] = unavailable(
              "Database size measurement needs the updated desktop backend. Rebuild or restart the desktop app, then refresh.",
            );
        }
      }
    }
  } else {
    // Bound simultaneous reads so a large browser-only collection does not
    // materialize every stored database at once merely to count its bytes.
    for (let offset = 0; offset < valid.length; offset += 8) {
      await Promise.all(
        valid.slice(offset, offset + 8).map(async (id) => {
          try {
            const bytes =
              (await IndexedDbService.getItemByteLengthStrict(
                `mremote-database-${id}`,
              )) ??
              (await IndexedDbService.getItemByteLengthStrict(
                `mremote-collection-${id}`,
              ));
            if (validBytes(bytes))
              result[id] = {
                status: "measured",
                bytes,
                source: "browser-json",
              };
            else if (bytes === null)
              result[id] = {
                status: "missing",
                reason: "This database has no stored data in this browser.",
              };
          } catch {
            // Preserve the distinction between inaccessible storage and missing data.
          }
        }),
      );
    }
  }
  return result;
}

export function formatDatabaseBytes(bytes: number): string {
  if (!validBytes(bytes)) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)) - 1,
    units.length - 1,
  );
  return `${(bytes / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
}
