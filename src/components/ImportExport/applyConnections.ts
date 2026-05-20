/**
 * Shared connection-apply transform used by the Import and Clone
 * pipelines. Takes a list of `{ connection, conflictStatus }` items
 * and the user's apply options, returns the deconflicted list of
 * connections ready to write into a database.
 *
 * The transform handles:
 *   - id regeneration on conflict / forced rename
 *   - parentId remapping when the folder isn't selected OR was
 *     remapped above
 *   - skip-on-conflict policy
 *   - bulk tag injection
 *   - name suffixing when the user picked the "rename" policy
 *
 * Credential stripping is *not* done here on purpose — the legacy
 * import path strips inline with its own helper, and the clone
 * path has different default semantics (include credentials by
 * default). Each caller is responsible for stripping before
 * calling this transform.
 */

import { Connection } from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";

export type ApplyConflictPolicy = "duplicate" | "rename" | "skip";

export interface ApplyConnectionsOptions {
  conflictPolicy: ApplyConflictPolicy;
  /** Tags to add to every applied connection (parsed list, not raw string). */
  addTags: string[];
  /** When false, parents are dropped and only leaves are kept. */
  preserveFolders: boolean;
}

/**
 * One source item carrying the connection plus the conflict status
 * computed against the target database's current contents.
 *
 * `sameEndpoint` is import-specific: two connections that hit the
 * same host/port/user but have distinct ids and names. We treat it
 * like `sameName` for the skip / rename branches and like `none` for
 * id regeneration — same as the legacy inline logic.
 */
export interface ApplyConnectionsItem {
  connection: Connection;
  conflictStatus: "none" | "sameId" | "sameName" | "sameEndpoint";
}

export interface ApplyConnectionsResult {
  remapped: Connection[];
  /** Count of items renamed because conflictPolicy === "rename". */
  renamed: number;
  /** Count of items dropped because conflictPolicy === "skip". */
  skipped: number;
}

export function remapConnectionsForApply(
  items: ApplyConnectionsItem[],
  options: ApplyConnectionsOptions,
): ApplyConnectionsResult {
  const selectedOriginalIds = new Set(
    items.map((item) => item.connection.id).filter(Boolean) as string[],
  );

  // First pass: build the id remap so parent references can chase
  // the new ids in the second pass.
  const remappedIds = new Map<string, string>();
  for (const item of items) {
    const conn = item.connection;
    if (item.conflictStatus === "sameId" || options.conflictPolicy === "rename") {
      remappedIds.set(conn.id, generateId());
    }
  }

  let renamed = 0;
  let skipped = 0;

  const remapped = items
    .filter((item) => {
      if (options.conflictPolicy !== "skip") return true;
      const keep = item.conflictStatus === "none";
      if (!keep) skipped += 1;
      return keep;
    })
    .flatMap((item) => {
      const conn = item.connection;
      const next: Connection = { ...conn };

      const newId = remappedIds.get(next.id);
      if (newId) {
        next.id = newId;
      }

      if (
        next.parentId &&
        (!options.preserveFolders || !selectedOriginalIds.has(next.parentId))
      ) {
        next.parentId = undefined;
      } else if (next.parentId && remappedIds.has(next.parentId)) {
        next.parentId = remappedIds.get(next.parentId);
      }

      if (
        options.conflictPolicy === "rename" &&
        item.conflictStatus !== "none"
      ) {
        next.name = `${next.name} (imported)`;
        renamed += 1;
      }

      if (options.addTags.length > 0) {
        next.tags = Array.from(new Set([...(next.tags ?? []), ...options.addTags]));
      }

      return [next];
    })
    .filter((conn) => options.preserveFolders || !conn.isGroup);

  return { remapped, renamed, skipped };
}

/**
 * Convenience: take a plain `Connection[]` and a list of existing
 * connections at the target, and produce the `ApplyConnectionsItem[]`
 * shape with conflict status precomputed. Used by Clone which doesn't
 * have a pre-built preview-item list like Import does.
 */
export function buildApplyItems(
  source: Connection[],
  existing: Connection[],
): ApplyConnectionsItem[] {
  const existingIds = new Set(existing.map((c) => c.id));
  const existingNamesByParent = new Map<string, Set<string>>();
  for (const conn of existing) {
    const key = conn.parentId ?? "__root__";
    if (!existingNamesByParent.has(key)) {
      existingNamesByParent.set(key, new Set());
    }
    existingNamesByParent.get(key)!.add(conn.name);
  }

  return source.map((connection) => {
    let conflictStatus: ApplyConnectionsItem["conflictStatus"] = "none";
    if (existingIds.has(connection.id)) {
      conflictStatus = "sameId";
    } else {
      const parentKey = connection.parentId ?? "__root__";
      const siblingNames = existingNamesByParent.get(parentKey);
      if (siblingNames?.has(connection.name)) {
        conflictStatus = "sameName";
      }
    }
    return { connection, conflictStatus };
  });
}
