import type { Connection } from "../../types/connection/connection";
import { MAX_NESTING_DEPTH } from "../window/dragDropManager";

export const ROOT_PARENT_FOLDER_VALUE = "";

export type ParentFolderOptionKind = "root" | "group" | "orphan";

export interface ParentFolderOption {
  value: string;
  kind: ParentFolderOptionKind;
  name: string;
  path: string;
  depth: number;
  disabled: boolean;
  reason?: string;
  current: boolean;
  orphaned: boolean;
}

export interface ParentFolderProjection {
  options: readonly ParentFolderOption[];
  selected: ParentFolderOption;
}

export interface ParentFolderProjectionInput {
  connections: readonly Connection[];
  currentConnectionId?: string;
  currentIsGroup?: boolean;
  selectedParentId?: string;
  maxDepth?: number;
}

interface IndexedGroup {
  connection: Connection;
  sourceIndex: number;
}

interface PathInfo {
  path: string;
  orphaned: boolean;
  cyclic: boolean;
}

function compareGroups(left: IndexedGroup, right: IndexedGroup): number {
  const leftOrder = Number.isFinite(left.connection.order)
    ? (left.connection.order as number)
    : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.connection.order)
    ? (right.connection.order as number)
    : Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const nameOrder = left.connection.name.localeCompare(
    right.connection.name,
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
  if (nameOrder !== 0) return nameOrder;

  return left.sourceIndex - right.sourceIndex;
}

function getPathInfo(
  groupId: string,
  groupsById: ReadonlyMap<string, IndexedGroup>,
  connectionsById: ReadonlyMap<string, Connection>,
): PathInfo {
  const names: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = groupId;
  let unavailablePrefix: string | undefined;
  let cyclic = false;

  while (currentId) {
    if (visited.has(currentId)) {
      cyclic = true;
      break;
    }
    visited.add(currentId);

    const indexed = groupsById.get(currentId);
    if (!indexed) {
      const invalidParent = connectionsById.get(currentId);
      unavailablePrefix = invalidParent
        ? `${invalidParent.name} (not a folder)`
        : `Missing folder (${currentId})`;
      break;
    }

    names.unshift(indexed.connection.name);
    currentId = indexed.connection.parentId;
  }

  const prefix = cyclic ? "Cyclic folder hierarchy" : unavailablePrefix;
  return {
    path: [prefix, ...names].filter(Boolean).join(" / "),
    orphaned: !!unavailablePrefix,
    cyclic,
  };
}

function ancestorChainContains(
  connectionId: string,
  ancestorId: string,
  connectionsById: ReadonlyMap<string, Connection>,
): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = connectionId;

  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = connectionsById.get(currentId)?.parentId;
  }

  return false;
}

function hasAncestorCycle(
  connectionId: string,
  connectionsById: ReadonlyMap<string, Connection>,
): boolean {
  const visited = new Set<string>();
  let currentId: string | undefined = connectionId;

  while (currentId) {
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = connectionsById.get(currentId)?.parentId;
  }

  return false;
}

function getSafeConnectionDepth(
  connectionId: string,
  connectionsById: ReadonlyMap<string, Connection>,
): number {
  const visited = new Set<string>();
  let currentId: string | undefined = connectionId;
  let depth = 0;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parentId: string | undefined =
      connectionsById.get(currentId)?.parentId;
    if (!parentId) break;
    depth++;
    currentId = parentId;
  }

  return depth;
}

function getSafeMaxDescendantDepth(
  connectionId: string,
  childrenByParentId: ReadonlyMap<string, readonly Connection[]>,
  path: ReadonlySet<string> = new Set(),
): number {
  if (path.has(connectionId)) return 0;

  const nextPath = new Set(path);
  nextPath.add(connectionId);
  let maximum = 0;

  for (const child of childrenByParentId.get(connectionId) ?? []) {
    if (nextPath.has(child.id)) continue;
    maximum = Math.max(
      maximum,
      1 + getSafeMaxDescendantDepth(child.id, childrenByParentId, nextPath),
    );
  }

  return maximum;
}

function disabledReasonForGroup(
  group: Connection,
  input: ParentFolderProjectionInput,
  connectionsById: ReadonlyMap<string, Connection>,
  childrenByParentId: ReadonlyMap<string, readonly Connection[]>,
): string | undefined {
  const currentId = input.currentConnectionId;
  if (currentId && group.id === currentId) {
    return "Cannot be its own parent";
  }

  if (
    currentId &&
    ancestorChainContains(group.id, currentId, connectionsById)
  ) {
    return "Cannot move into own descendant";
  }

  if (hasAncestorCycle(group.id, connectionsById)) {
    return "Folder hierarchy contains a cycle";
  }

  const descendantDepth =
    currentId && input.currentIsGroup
      ? getSafeMaxDescendantDepth(currentId, childrenByParentId)
      : 0;
  const targetDepth = getSafeConnectionDepth(group.id, connectionsById) + 1;
  const maxDepth = input.maxDepth ?? MAX_NESTING_DEPTH;
  if (targetDepth + descendantDepth >= maxDepth) {
    return `Max depth (${maxDepth}) exceeded`;
  }

  return undefined;
}

export function buildParentFolderProjection(
  input: ParentFolderProjectionInput,
): ParentFolderProjection {
  const connectionsById = new Map(
    input.connections.map((connection) => [connection.id, connection]),
  );
  const childrenByParentId = new Map<string, Connection[]>();
  input.connections.forEach((connection) => {
    if (!connection.parentId) return;
    const children = childrenByParentId.get(connection.parentId) ?? [];
    children.push(connection);
    childrenByParentId.set(connection.parentId, children);
  });

  const indexedGroups: IndexedGroup[] = input.connections
    .map((connection, sourceIndex) => ({ connection, sourceIndex }))
    .filter(({ connection }) => connection.isGroup);
  const groupsById = new Map(
    indexedGroups.map((indexed) => [indexed.connection.id, indexed]),
  );
  const groupChildren = new Map<string, IndexedGroup[]>();

  for (const indexed of indexedGroups) {
    const parentId = indexed.connection.parentId;
    if (
      !parentId ||
      !groupsById.has(parentId) ||
      parentId === indexed.connection.id
    ) {
      continue;
    }
    const children = groupChildren.get(parentId) ?? [];
    children.push(indexed);
    groupChildren.set(parentId, children);
  }
  groupChildren.forEach((children) => children.sort(compareGroups));

  const selectedValue = input.selectedParentId ?? ROOT_PARENT_FOLDER_VALUE;
  const rootOption: ParentFolderOption = {
    value: ROOT_PARENT_FOLDER_VALUE,
    kind: "root",
    name: "Root",
    path: "Root (No parent)",
    depth: 0,
    disabled: false,
    current: selectedValue === ROOT_PARENT_FOLDER_VALUE,
    orphaned: false,
  };

  const flattenedGroups: ParentFolderOption[] = [];
  const visited = new Set<string>();
  const appendGroup = (indexed: IndexedGroup, depth: number) => {
    const group = indexed.connection;
    if (visited.has(group.id)) return;
    visited.add(group.id);

    const pathInfo = getPathInfo(group.id, groupsById, connectionsById);
    const reason = disabledReasonForGroup(
      group,
      input,
      connectionsById,
      childrenByParentId,
    );
    flattenedGroups.push({
      value: group.id,
      kind: "group",
      name: group.name,
      path: pathInfo.path,
      depth,
      disabled: !!reason,
      reason,
      current: selectedValue === group.id,
      orphaned: pathInfo.orphaned || pathInfo.cyclic,
    });

    for (const child of groupChildren.get(group.id) ?? []) {
      appendGroup(child, depth + 1);
    }
  };

  const roots = indexedGroups
    .filter(({ connection }) => {
      const parentId = connection.parentId;
      return (
        !parentId || !groupsById.has(parentId) || parentId === connection.id
      );
    })
    .sort(compareGroups);
  roots.forEach((root) => appendGroup(root, 0));
  indexedGroups
    .filter(({ connection }) => !visited.has(connection.id))
    .sort(compareGroups)
    .forEach((orphanedRoot) => appendGroup(orphanedRoot, 0));

  let orphanOption: ParentFolderOption | undefined;
  if (
    selectedValue !== ROOT_PARENT_FOLDER_VALUE &&
    !groupsById.has(selectedValue)
  ) {
    const invalidParent = connectionsById.get(selectedValue);
    const reason = invalidParent
      ? "Current parent is not a folder"
      : "Current parent folder is missing";
    const name = invalidParent?.name ?? selectedValue;
    orphanOption = {
      value: selectedValue,
      kind: "orphan",
      name,
      path: `Unavailable parent: ${name}`,
      depth: 0,
      disabled: true,
      reason,
      current: true,
      orphaned: true,
    };
  }

  const options = [
    rootOption,
    ...(orphanOption ? [orphanOption] : []),
    ...flattenedGroups,
  ];
  return {
    options,
    selected: options.find((option) => option.current) ?? rootOption,
  };
}

export function filterParentFolderOptions(
  options: readonly ParentFolderOption[],
  query: string,
): ParentFolderOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...options];

  return options.filter((option) =>
    `${option.name}\n${option.path}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

export function canSelectParentFolder(
  projection: ParentFolderProjection,
  value: string,
): boolean {
  const option = projection.options.find(
    (candidate) => candidate.value === value,
  );
  return !!option && !option.disabled;
}
