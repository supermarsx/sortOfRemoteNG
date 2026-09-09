import type { Connection } from "../../types/connection/connection";
import {
  DEFAULT_RECYCLE_BIN_POLICY,
  type DatabaseRecycleBin,
  type RecycleBinEntry,
  type RecycleBinPolicy,
  type RecycleBinRow,
} from "../../types/connection/recycleBin";

const DAY = 86_400_000;
const MAX_ENTRIES = 100_000;
export const RECYCLE_BIN_PURGE_WARNING =
  "Purged records are removed from this database only. Backups and shared OS-vault secure notes are retained; exclusive note ownership cannot be proven across databases.";

export function normalizeRecycleBinPolicy(value: unknown): RecycleBinPolicy {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const policy = value as Record<string, unknown>;
    if (policy.mode === "forever") return { mode: "forever" };
    if (
      policy.mode === "days" &&
      Number.isInteger(policy.days) &&
      (policy.days as number) >= 1 &&
      (policy.days as number) <= 36_500
    )
      return { mode: "days", days: policy.days as number };
  }
  throw new Error(
    "Invalid Recycle Bin retention. Use 1–36500 days or keep indefinitely.",
  );
}

export function emptyRecycleBin(): DatabaseRecycleBin {
  return {
    version: 1,
    revision: "0",
    policy: { ...DEFAULT_RECYCLE_BIN_POLICY },
    entries: [],
  };
}

/** Malformed existing archives fail closed, never silently normalize to empty. */
export function normalizeRecycleBin(value: unknown): DatabaseRecycleBin {
  if (value === undefined) return emptyRecycleBin();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Invalid database Recycle Bin; archived data was not changed.",
    );
  const bin = value as DatabaseRecycleBin;
  if (
    bin.version !== 1 ||
    typeof bin.revision !== "string" ||
    bin.revision.length > 128 ||
    !Array.isArray(bin.entries) ||
    bin.entries.length > MAX_ENTRIES
  )
    throw new Error(
      "Unsupported or invalid database Recycle Bin; archived data was not changed.",
    );
  const ids = new Set<string>();
  for (const entry of bin.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.batchId !== "string" ||
      !entry.batchId ||
      !Number.isSafeInteger(entry.deletedAt) ||
      entry.deletedAt < 0 ||
      !Number.isFinite(new Date(entry.deletedAt).getTime()) ||
      !Number.isFinite(new Date(entry.deletedAt + 36_500 * DAY).getTime()) ||
      !entry.connection ||
      typeof entry.connection !== "object" ||
      Array.isArray(entry.connection) ||
      typeof entry.connection.id !== "string" ||
      !entry.connection.id ||
      typeof entry.connection.name !== "string" ||
      typeof entry.connection.protocol !== "string" ||
      typeof entry.connection.isGroup !== "boolean" ||
      (entry.connection.parentId !== undefined &&
        typeof entry.connection.parentId !== "string")
    )
      throw new Error(
        "Invalid archived connection or deletion date; Recycle Bin was not changed.",
      );
    ids.add(entry.id);
  }
  return { ...bin, policy: normalizeRecycleBinPolicy(bin.policy) };
}

export function recycleBinExpiresAt(
  entry: RecycleBinEntry,
  policy: RecycleBinPolicy,
): number | null {
  return policy.mode === "forever" ? null : entry.deletedAt + policy.days * DAY;
}
export function expiredRecycleBinIds(
  bin: DatabaseRecycleBin,
  now: number,
  policy = bin.policy,
): string[] {
  return bin.entries
    .filter((entry) => {
      const expiresAt = recycleBinExpiresAt(entry, policy);
      return expiresAt !== null && expiresAt <= now;
    })
    .map((entry) => entry.id);
}

/** One indexed, cycle-safe traversal; only folders own descendant connections. */
export function collectConnectionSubtreeIds(
  connections: readonly Connection[],
  roots: readonly string[],
): Set<string> {
  const byId = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const children = new Map<string, string[]>();
  for (const connection of connections) {
    if (connection.parentId) {
      const list = children.get(connection.parentId) ?? [];
      list.push(connection.id);
      children.set(connection.parentId, list);
    }
  }
  const selected = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!;
    if (selected.has(id)) continue;
    const connection = byId.get(id);
    if (!connection) continue;
    selected.add(id);
    if (connection.isGroup) pending.push(...(children.get(id) ?? []));
  }
  return selected;
}

export function archiveConnections(
  connections: Connection[],
  bin: DatabaseRecycleBin,
  roots: readonly string[],
  now: number,
  operationId: string,
  keepChildren = false,
) {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isFinite(new Date(now + 36_500 * DAY).getTime())
  )
    throw new Error("Invalid deletion time; connections were not changed.");
  const preservedFolder =
    keepChildren && roots.length === 1
      ? connections.find(
          (connection) => connection.id === roots[0] && connection.isGroup,
        )
      : undefined;
  if (keepChildren && !preservedFolder)
    throw new Error("Keep-children deletion requires one existing folder.");
  const selected = preservedFolder
    ? new Set([preservedFolder.id])
    : collectConnectionSubtreeIds(connections, roots);
  if (selected.size === 0) return { connections, bin, archived: 0 };
  if (bin.entries.length + selected.size > MAX_ENTRIES)
    throw new Error(
      "Recycle Bin capacity reached. Review and purge archived entries before deleting more connections.",
    );
  const entries = connections
    .filter((connection) => selected.has(connection.id))
    .map((connection) => ({
      id: `${operationId}/${encodeURIComponent(connection.id)}`,
      batchId: operationId,
      deletedAt: now,
      connection: structuredClone(connection),
    }));
  const parentId =
    preservedFolder &&
    connections.some(
      (connection) =>
        connection.id === preservedFolder.parentId &&
        connection.isGroup &&
        !selected.has(connection.id),
    )
      ? preservedFolder.parentId
      : undefined;
  return {
    connections: connections
      .filter((connection) => !selected.has(connection.id))
      .map((connection) =>
        preservedFolder && connection.parentId === preservedFolder.id
          ? { ...connection, parentId }
          : connection,
      ),
    bin: {
      ...bin,
      revision: operationId,
      entries: [...bin.entries, ...entries],
    },
    archived: entries.length,
  };
}

/** Selecting a deleted folder includes only its own deletion-batch descendants. */
export function selectedRecycleBinIds(
  bin: DatabaseRecycleBin,
  ids: readonly string[] | null,
): Set<string> {
  if (ids === null) return new Set(bin.entries.map((entry) => entry.id));
  const selected = new Set(ids);
  const byId = new Map(bin.entries.map((entry) => [entry.id, entry]));
  const rootsByBatch = new Map<string, string[]>();
  for (const id of selected) {
    const entry = byId.get(id);
    if (!entry)
      throw new Error(
        "Recycle Bin changed. Refresh and review the selection again.",
      );
    const roots = rootsByBatch.get(entry.batchId) ?? [];
    roots.push(entry.connection.id);
    rootsByBatch.set(entry.batchId, roots);
  }
  const batches = new Map<string, RecycleBinEntry[]>();
  for (const entry of bin.entries) {
    if (!rootsByBatch.has(entry.batchId)) continue;
    const batch = batches.get(entry.batchId) ?? [];
    batch.push(entry);
    batches.set(entry.batchId, batch);
  }
  for (const [batchId, batch] of batches) {
    const connectionIds = collectConnectionSubtreeIds(
      batch.map((entry) => entry.connection),
      rootsByBatch.get(batchId)!,
    );
    for (const entry of batch)
      if (connectionIds.has(entry.connection.id)) selected.add(entry.id);
  }
  return selected;
}

export function restoreRecycledConnections(
  connections: Connection[],
  bin: DatabaseRecycleBin,
  ids: readonly string[],
  now: number,
  operationId: string,
) {
  const selected = selectedRecycleBinIds(bin, ids);
  const expired = new Set(expiredRecycleBinIds(bin, now));
  const live = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const pending = new Map<string, RecycleBinEntry>();
  let skipped = 0;
  for (const entry of bin.entries)
    if (selected.has(entry.id)) {
      if (
        expired.has(entry.id) ||
        live.has(entry.connection.id) ||
        pending.has(entry.connection.id)
      )
        skipped++;
      else pending.set(entry.connection.id, entry);
    }
  const restored: Connection[] = [];
  const restoredEntryIds = new Set<string>();
  const children = new Map<string, string[]>();
  const ready: string[] = [];
  for (const [id, entry] of pending) {
    const parentId = entry.connection.parentId;
    if (parentId && pending.get(parentId)?.connection.isGroup) {
      const siblings = children.get(parentId) ?? [];
      siblings.push(id);
      children.set(parentId, siblings);
    } else ready.push(id);
  }
  while (pending.size) {
    const breakCycle = ready.length === 0;
    const id = ready.pop() ?? pending.keys().next().value!;
    const entry = pending.get(id);
    if (!entry) continue;
    const connection = structuredClone(entry.connection);
    if (
      breakCycle ||
      !connection.parentId ||
      live.get(connection.parentId)?.isGroup !== true
    )
      delete connection.parentId;
    restored.push(connection);
    live.set(id, connection);
    restoredEntryIds.add(entry.id);
    pending.delete(id);
    ready.push(...(children.get(id) ?? []));
  }
  return {
    connections: restored.length ? [...connections, ...restored] : connections,
    bin: restored.length
      ? {
          ...bin,
          revision: operationId,
          entries: bin.entries.filter(
            (entry) => !restoredEntryIds.has(entry.id),
          ),
        }
      : bin,
    restored: restored.length,
    skipped,
  };
}

export function recycleBinRows(
  bin: DatabaseRecycleBin,
  connections: readonly Connection[],
): RecycleBinRow[] {
  const names = new Map(
    connections
      .filter((connection) => connection.isGroup)
      .map((connection) => [connection.id, connection.name]),
  );
  const batchEntries = new Map<string, Map<string, RecycleBinEntry>>();
  for (const entry of bin.entries) {
    const batch =
      batchEntries.get(entry.batchId) ?? new Map<string, RecycleBinEntry>();
    batch.set(entry.connection.id, entry);
    batchEntries.set(entry.batchId, batch);
  }
  const counts = new Map<string, number>();
  const parents = new Map<string, string>();
  const remainingChildren = new Map<string, number>();
  for (const entry of bin.entries) {
    counts.set(entry.id, 0);
    const parent = batchEntries
      .get(entry.batchId)
      ?.get(entry.connection.parentId ?? "");
    if (parent?.connection.isGroup) {
      parents.set(entry.id, parent.id);
      remainingChildren.set(
        parent.id,
        (remainingChildren.get(parent.id) ?? 0) + 1,
      );
    }
  }
  const leaves = bin.entries
    .filter((entry) => !remainingChildren.has(entry.id))
    .map((entry) => entry.id);
  while (leaves.length) {
    const id = leaves.pop()!;
    const parent = parents.get(id);
    if (!parent) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + (counts.get(id) ?? 0) + 1);
    const remaining = (remainingChildren.get(parent) ?? 1) - 1;
    remainingChildren.set(parent, remaining);
    if (remaining === 0) leaves.push(parent);
  }
  // Corrupt cycles cannot be assigned a reliable tree count. Selection/review
  // still uses a visited-set traversal and computes its exact selected count.
  return bin.entries.map((entry) => {
    const batch = batchEntries.get(entry.batchId)!;
    const parent = batch.get(entry.connection.parentId ?? "");
    return {
      id: entry.id,
      batchId: entry.batchId,
      connectionId: entry.connection.id,
      name: entry.connection.name,
      protocol: entry.connection.protocol,
      isGroup: entry.connection.isGroup,
      deletedAt: entry.deletedAt,
      expiresAt: recycleBinExpiresAt(entry, bin.policy),
      parentName:
        (parent?.connection.isGroup ? parent.connection.name : undefined) ??
        names.get(entry.connection.parentId ?? ""),
      descendantCount:
        entry.connection.isGroup && !remainingChildren.get(entry.id)
          ? (counts.get(entry.id) ?? 0)
          : 0,
    };
  });
}
