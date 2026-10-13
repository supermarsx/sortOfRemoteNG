import rules from "../../../src-tauri/src/origin_browser_digest_exclusions.json";
import type { Connection } from "../../types/connection/connection";
import { stableJsonStringify } from "../core/stableJsonStringify";

// The native lease (`authority_digest`) applies the same reviewed file. A file
// of another version yields no rules here: every edit then counts as a change
// of authority, as that file fails every lease closed natively.
const reviewed = rules.version === 1;

/** Saved-row key paths that never change an open native tab's authority.
 * Native removes exactly these before it hashes the row. */
export const NATIVE_BROWSER_AUTHORITY_EXCLUSIONS: readonly (readonly string[])[] =
  Object.freeze(
    reviewed
      ? rules.exclusions.map((entry) => Object.freeze([...entry.path]))
      : [],
  );

/** Objects that count as absent once the paths above are removed and exactly
 * these members are left, as canonical text for comparison. */
const ABSENT_WHEN_ONLY: readonly (readonly [readonly string[], string])[] =
  reviewed
    ? rules.absentWhenOnly.map(
        (entry) => [entry.path, stableJsonStringify(entry.members)] as const,
      )
    : [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The object holding a path's last key. A path names object keys from the
 * row down and never enters an array. */
function parentOf(row: unknown, path: readonly string[]) {
  let node = row;
  for (const key of path.slice(0, -1))
    node = isRecord(node) ? node[key] : undefined;
  return isRecord(node) ? node : undefined;
}

/** Not a security boundary. It only keeps saved secrets out of a value that is
 * compared and held in component state: a collision skips one early restart,
 * and native still ends a tab whose saved row changed. */
function fingerprint(text: string): string {
  let low = 0xdeadbeef ^ text.length;
  let high = 0x41c6ce57 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 2654435761);
    high = Math.imul(high ^ code, 1597334677);
  }
  low =
    Math.imul(low ^ (low >>> 16), 2246822507) ^
    Math.imul(high ^ (high >>> 13), 3266489909);
  high =
    Math.imul(high ^ (high >>> 16), 2246822507) ^
    Math.imul(low ^ (low >>> 13), 3266489909);
  return [high, low]
    .map((half) => (half >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** Equal exactly when two versions of a saved row give an open native tab the
 * same authority, so a rename, a new bookmark or a display override leaves it
 * unchanged and a changed address, credential, route or permission does not.
 * Undefined when the row cannot be read as saved data. */
export function nativeBrowserAuthoritySignature(
  connection: Connection,
): string | undefined {
  let row: unknown;
  try {
    // The persisted shape, which is what native reads back from the database.
    row = JSON.parse(JSON.stringify(connection));
  } catch {
    return undefined;
  }
  if (!isRecord(row)) return undefined;
  for (const path of NATIVE_BROWSER_AUTHORITY_EXCLUSIONS) {
    const parent = parentOf(row, path);
    if (parent) delete parent[path[path.length - 1]];
  }
  // After the removals: an editor creates an override object with the first
  // override and drops it with the last.
  for (const [path, members] of ABSENT_WHEN_ONLY) {
    const parent = parentOf(row, path);
    const leaf = path[path.length - 1];
    if (
      parent &&
      isRecord(parent[leaf]) &&
      stableJsonStringify(parent[leaf]) === members
    )
      delete parent[leaf];
  }
  return fingerprint(stableJsonStringify(row));
}
