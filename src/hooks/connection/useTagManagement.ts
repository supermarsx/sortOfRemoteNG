import { useCallback, useMemo } from "react";
import { useConnections } from "../../contexts/useConnections";
import { useSettings } from "../../contexts/SettingsContext";
import type { Connection } from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";

export interface TextTagRecord {
  name: string;
  count: number;
  connections: Connection[];
  connectionIds: string[];
}

export interface ColorTagRecord {
  id: string;
  name: string;
  color: string;
  global: boolean;
  count: number;
  connections: Connection[];
  connectionIds: string[];
}

export interface TagManagementStats {
  totalTextTags: number;
  totalColorTags: number;
  taggedConnectionCount: number;
  untaggedConnectionCount: number;
  colorTaggedConnectionCount: number;
}

export type TagActionFailureReason =
  | "empty-name"
  | "no-target-connections"
  | "no-matching-connections"
  | "tag-not-found"
  | "color-tag-not-found"
  | "already-assigned";

export type TagActionResult =
  | { ok: true; updatedConnections: number; id?: string }
  | { ok: false; reason: TagActionFailureReason };

export interface CreateColorTagInput {
  name: string;
  color: string;
  global?: boolean;
}

export type UpdateColorTagPatch = Partial<CreateColorTagInput>;

type PersistedColorTag = {
  name: string;
  color: string;
  global: boolean;
};

export function normalizeTextTagName(raw: string): string {
  return raw.trim();
}

function tagKey(tagName: string): string {
  return normalizeTextTagName(tagName).toLocaleLowerCase();
}

export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawTag of tags) {
    const normalizedTag = normalizeTextTagName(rawTag);
    if (!normalizedTag) continue;

    const normalizedKey = tagKey(normalizedTag);
    if (seen.has(normalizedKey)) continue;

    seen.add(normalizedKey);
    deduped.push(normalizedTag);
  }

  return deduped;
}

export function connectionHasTextTag(
  connection: Connection,
  tagName: string,
): boolean {
  const expectedKey = tagKey(tagName);
  if (!expectedKey) return false;

  return (connection.tags ?? []).some((rawTag) => tagKey(rawTag) === expectedKey);
}

function tagsChanged(previousTags: string[] | undefined, nextTags: string[]): boolean {
  const currentTags = previousTags ?? [];
  if (currentTags.length !== nextTags.length) return true;
  return currentTags.some((tagName, index) => tagName !== nextTags[index]);
}

function makeUpdatedConnection(
  connection: Connection,
  updates: Partial<Connection>,
): Connection {
  return {
    ...connection,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

function resolveConnectionsById(
  connections: Connection[],
  connectionIds: string[],
): Connection[] {
  if (connectionIds.length === 0) return [];

  const requestedIds = new Set(connectionIds);
  return connections.filter((connection) => requestedIds.has(connection.id));
}

export function useTagManagement() {
  const { state, dispatch } = useConnections();
  const { settings, updateSettings } = useSettings();
  const connections = state.connections;
  const colorTagSettings = useMemo(() => settings.colorTags ?? {}, [settings.colorTags]);

  const textTags = useMemo<TextTagRecord[]>(() => {
    const records = new Map<string, TextTagRecord>();

    for (const connection of connections) {
      for (const tagName of dedupeTags(connection.tags ?? [])) {
        const normalizedKey = tagKey(tagName);
        const existingRecord = records.get(normalizedKey);

        if (existingRecord) {
          existingRecord.connections.push(connection);
          existingRecord.connectionIds.push(connection.id);
          existingRecord.count += 1;
        } else {
          records.set(normalizedKey, {
            name: tagName,
            count: 1,
            connections: [connection],
            connectionIds: [connection.id],
          });
        }
      }
    }

    return Array.from(records.values()).sort((leftTag, rightTag) =>
      leftTag.name.localeCompare(rightTag.name),
    );
  }, [connections]);

  const colorTags = useMemo<ColorTagRecord[]>(() => {
    return Object.entries(colorTagSettings)
      .map(([id, colorTag]) => {
        const taggedConnections = connections.filter(
          (connection) => connection.colorTag === id,
        );

        return {
          id,
          name: colorTag.name,
          color: colorTag.color,
          global: colorTag.global,
          count: taggedConnections.length,
          connections: taggedConnections,
          connectionIds: taggedConnections.map((connection) => connection.id),
        };
      })
      .sort((leftTag, rightTag) => leftTag.name.localeCompare(rightTag.name));
  }, [colorTagSettings, connections]);

  const stats = useMemo<TagManagementStats>(() => {
    let taggedConnectionCount = 0;
    let colorTaggedConnectionCount = 0;

    for (const connection of connections) {
      const hasTextTag = dedupeTags(connection.tags ?? []).length > 0;
      const hasColorTag = Boolean(
        connection.colorTag && colorTagSettings[connection.colorTag],
      );

      if (hasTextTag || hasColorTag) taggedConnectionCount += 1;
      if (hasColorTag) colorTaggedConnectionCount += 1;
    }

    return {
      totalTextTags: textTags.length,
      totalColorTags: colorTags.length,
      taggedConnectionCount,
      untaggedConnectionCount: connections.length - taggedConnectionCount,
      colorTaggedConnectionCount,
    };
  }, [colorTagSettings, colorTags.length, connections, textTags.length]);

  const updateConnectionTags = useCallback(
    (connection: Connection, nextTags: string[]): boolean => {
      const dedupedTags = dedupeTags(nextTags);
      if (!tagsChanged(connection.tags, dedupedTags)) return false;

      dispatch({
        type: "UPDATE_CONNECTION",
        payload: makeUpdatedConnection(connection, { tags: dedupedTags }),
      });
      return true;
    },
    [dispatch],
  );

  const createTextTag = useCallback(
    (name: string, connectionIds: string[]): TagActionResult => {
      const normalizedName = normalizeTextTagName(name);
      if (!normalizedName) return { ok: false, reason: "empty-name" };
      if (connectionIds.length === 0) {
        return { ok: false, reason: "no-target-connections" };
      }

      const targetConnections = resolveConnectionsById(connections, connectionIds);
      if (targetConnections.length === 0) {
        return { ok: false, reason: "no-matching-connections" };
      }

      let updatedConnections = 0;
      for (const connection of targetConnections) {
        const didUpdate = updateConnectionTags(connection, [
          ...(connection.tags ?? []),
          normalizedName,
        ]);
        if (didUpdate) updatedConnections += 1;
      }

      if (updatedConnections === 0) {
        return { ok: false, reason: "already-assigned" };
      }

      return { ok: true, updatedConnections };
    },
    [connections, updateConnectionTags],
  );

  const renameTextTag = useCallback(
    (oldName: string, newName: string): TagActionResult => {
      const oldKey = tagKey(oldName);
      const normalizedNewName = normalizeTextTagName(newName);
      if (!oldKey) return { ok: false, reason: "tag-not-found" };
      if (!normalizedNewName) return { ok: false, reason: "empty-name" };

      let updatedConnections = 0;
      for (const connection of connections) {
        if (!connectionHasTextTag(connection, oldName)) continue;

        const nextTags = (connection.tags ?? []).map((rawTag) =>
          tagKey(rawTag) === oldKey ? normalizedNewName : rawTag,
        );
        const didUpdate = updateConnectionTags(connection, nextTags);
        if (didUpdate) updatedConnections += 1;
      }

      if (updatedConnections === 0) {
        return { ok: false, reason: "tag-not-found" };
      }

      return { ok: true, updatedConnections };
    },
    [connections, updateConnectionTags],
  );

  const deleteTextTag = useCallback(
    (name: string): TagActionResult => {
      const normalizedKey = tagKey(name);
      if (!normalizedKey) return { ok: false, reason: "tag-not-found" };

      let updatedConnections = 0;
      for (const connection of connections) {
        if (!connectionHasTextTag(connection, name)) continue;

        const nextTags = (connection.tags ?? []).filter(
          (rawTag) => tagKey(rawTag) !== normalizedKey,
        );
        const didUpdate = updateConnectionTags(connection, nextTags);
        if (didUpdate) updatedConnections += 1;
      }

      if (updatedConnections === 0) {
        return { ok: false, reason: "tag-not-found" };
      }

      return { ok: true, updatedConnections };
    },
    [connections, updateConnectionTags],
  );

  const assignTextTagToConnections = useCallback(
    (name: string, connectionIds: string[]): TagActionResult => {
      const normalizedName = normalizeTextTagName(name);
      if (!normalizedName) return { ok: false, reason: "empty-name" };
      if (connectionIds.length === 0) {
        return { ok: false, reason: "no-target-connections" };
      }

      const targetConnections = resolveConnectionsById(connections, connectionIds);
      if (targetConnections.length === 0) {
        return { ok: false, reason: "no-matching-connections" };
      }

      let updatedConnections = 0;
      for (const connection of targetConnections) {
        const didUpdate = updateConnectionTags(connection, [
          ...(connection.tags ?? []),
          normalizedName,
        ]);
        if (didUpdate) updatedConnections += 1;
      }

      return { ok: true, updatedConnections };
    },
    [connections, updateConnectionTags],
  );

  const removeTextTagFromConnection = useCallback(
    (name: string, connectionId: string): TagActionResult => {
      const normalizedKey = tagKey(name);
      if (!normalizedKey) return { ok: false, reason: "tag-not-found" };

      const connection = connections.find(
        (candidateConnection) => candidateConnection.id === connectionId,
      );
      if (!connection) return { ok: false, reason: "no-matching-connections" };

      const nextTags = (connection.tags ?? []).filter(
        (rawTag) => tagKey(rawTag) !== normalizedKey,
      );
      const didUpdate = updateConnectionTags(connection, nextTags);

      return { ok: true, updatedConnections: didUpdate ? 1 : 0 };
    },
    [connections, updateConnectionTags],
  );

  const createColorTag = useCallback(
    async ({ name, color, global = true }: CreateColorTagInput): Promise<TagActionResult> => {
      const normalizedName = name.trim();
      if (!normalizedName) return { ok: false, reason: "empty-name" };

      const id = generateId();
      const nextColorTags: Record<string, PersistedColorTag> = {
        ...colorTagSettings,
        [id]: {
          name: normalizedName,
          color: color || "#3b82f6",
          global,
        },
      };

      await updateSettings({ colorTags: nextColorTags });
      return { ok: true, updatedConnections: 0, id };
    },
    [colorTagSettings, updateSettings],
  );

  const updateColorTag = useCallback(
    async (id: string, patch: UpdateColorTagPatch): Promise<TagActionResult> => {
      const existingTag = colorTagSettings[id];
      if (!existingTag) return { ok: false, reason: "color-tag-not-found" };

      const normalizedName = patch.name === undefined ? existingTag.name : patch.name.trim();
      if (!normalizedName) return { ok: false, reason: "empty-name" };

      const nextColorTags: Record<string, PersistedColorTag> = {
        ...colorTagSettings,
        [id]: {
          name: normalizedName,
          color: patch.color ?? existingTag.color,
          global: patch.global ?? existingTag.global,
        },
      };

      await updateSettings({ colorTags: nextColorTags });
      return { ok: true, updatedConnections: 0, id };
    },
    [colorTagSettings, updateSettings],
  );

  const assignColorTagToConnections = useCallback(
    (id: string, connectionIds: string[]): TagActionResult => {
      if (!colorTagSettings[id]) return { ok: false, reason: "color-tag-not-found" };
      if (connectionIds.length === 0) {
        return { ok: false, reason: "no-target-connections" };
      }

      const targetConnections = resolveConnectionsById(connections, connectionIds);
      if (targetConnections.length === 0) {
        return { ok: false, reason: "no-matching-connections" };
      }

      let updatedConnections = 0;
      for (const connection of targetConnections) {
        if (connection.colorTag === id) continue;

        dispatch({
          type: "UPDATE_CONNECTION",
          payload: makeUpdatedConnection(connection, { colorTag: id }),
        });
        updatedConnections += 1;
      }

      return { ok: true, updatedConnections };
    },
    [colorTagSettings, connections, dispatch],
  );

  const clearColorTagFromConnection = useCallback(
    (connectionId: string): TagActionResult => {
      const connection = connections.find(
        (candidateConnection) => candidateConnection.id === connectionId,
      );
      if (!connection) return { ok: false, reason: "no-matching-connections" };
      if (!connection.colorTag) return { ok: true, updatedConnections: 0 };

      dispatch({
        type: "UPDATE_CONNECTION",
        payload: makeUpdatedConnection(connection, { colorTag: undefined }),
      });

      return { ok: true, updatedConnections: 1 };
    },
    [connections, dispatch],
  );

  const clearColorTagFromConnections = useCallback(
    (id: string): TagActionResult => {
      let updatedConnections = 0;

      for (const connection of connections) {
        if (connection.colorTag !== id) continue;

        dispatch({
          type: "UPDATE_CONNECTION",
          payload: makeUpdatedConnection(connection, { colorTag: undefined }),
        });
        updatedConnections += 1;
      }

      return { ok: true, updatedConnections };
    },
    [connections, dispatch],
  );

  const deleteColorTag = useCallback(
    async (id: string): Promise<TagActionResult> => {
      if (!colorTagSettings[id]) return { ok: false, reason: "color-tag-not-found" };

      const nextColorTags: Record<string, PersistedColorTag> = { ...colorTagSettings };
      delete nextColorTags[id];
      await updateSettings({ colorTags: nextColorTags });

      return clearColorTagFromConnections(id);
    },
    [clearColorTagFromConnections, colorTagSettings, updateSettings],
  );

  return {
    connections,
    textTags,
    colorTags,
    stats,
    normalizeTextTagName,
    connectionHasTextTag,
    dedupeTags,
    createTextTag,
    renameTextTag,
    deleteTextTag,
    assignTextTagToConnections,
    removeTextTagFromConnection,
    createColorTag,
    updateColorTag,
    deleteColorTag,
    assignColorTagToConnections,
    clearColorTagFromConnection,
    clearColorTagFromConnections,
  };
}

export type UseTagManagement = ReturnType<typeof useTagManagement>;
