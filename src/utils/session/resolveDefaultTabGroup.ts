import type { Connection, TabGroup } from "../../types/connection/connection";

/** Resolve only an existing group; inheritance never rewrites connections. */
export function resolveDefaultTabGroup(
  connectionId: string | undefined,
  connections: readonly Connection[],
  tabGroups: readonly TabGroup[],
  explicitSessionGroupId?: string,
): string | undefined {
  const groupIds = new Set(tabGroups.map((group) => group.id));
  if (explicitSessionGroupId && groupIds.has(explicitSessionGroupId))
    return explicitSessionGroupId;
  if (!connectionId || groupIds.size === 0) return undefined;
  const byId = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const visited = new Set<string>();
  let current = byId.get(connectionId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.defaultTabGroupId && groupIds.has(current.defaultTabGroupId))
      return current.defaultTabGroupId;
    if (!current.parentId) return undefined;
    const parent = byId.get(current.parentId);
    // Corrupt/orphaned ancestry cannot turn a non-folder into an inheritance source.
    if (parent?.isGroup !== true) return undefined;
    current = parent;
  }
  return undefined;
}
