import type { Connection } from "../../../types/connection/connection";
import type {
  DatabaseDocument,
  DocumentBlock,
} from "../../../types/documents/document";

/** The tree retains this projection only, never complete blocks or attachments. */
export type TreeDocumentMetadata = Pick<
  DatabaseDocument,
  "id" | "name" | "icon" | "parentFolderId"
> & {
  blockTypes: DocumentBlock["type"][];
};
export type TreeEntryFilter = "all" | "connections" | "documents";
export type TreeDocumentTypeFilter = "all" | "blank" | DocumentBlock["type"];
type Position = {
  key: string;
  parentKey?: string;
  level: number;
  setSize: number;
  posInSet: number;
};
export type ConnectionDocumentTreeRow = Position &
  (
    | { kind: "connection"; connection: Connection; expanded: boolean }
    | { kind: "document"; document: TreeDocumentMetadata }
  );
export const connectionRowKey = (id: string) => `connection:${id}`;
export const documentRowKey = (id: string) => `document:${id}`;

/** Merge document leaves into the existing ordered connection hierarchy. */
export function buildConnectionDocumentRows(options: {
  connections: Connection[];
  filteredConnections: Connection[];
  documents: TreeDocumentMetadata[];
  mode: TreeEntryFilter;
  documentType: TreeDocumentTypeFilter;
  searchTerm: string;
  contentMatches?: ReadonlySet<string>;
  hasActiveConnectionFilter: boolean;
  buildTree: (connections: Connection[], parentId?: string) => Connection[];
}): ConnectionDocumentTreeRow[] {
  const { connections, filteredConnections, buildTree, mode, documentType } =
    options;
  const search = options.searchTerm.trim().toLowerCase();
  const groups = new Map(
    connections
      .filter((entry) => entry.isGroup)
      .map((entry) => [entry.id, entry]),
  );
  const included = new Set(
    mode === "documents" ? [] : filteredConnections.map((entry) => entry.id),
  );
  const expandedForDocuments = new Set<string>();
  const byParent = new Map<string | undefined, TreeDocumentMetadata[]>();
  for (const document of mode === "connections" ? [] : options.documents) {
    if (
      documentType === "blank"
        ? document.blockTypes.length !== 0
        : documentType !== "all" && !document.blockTypes.includes(documentType)
    )
      continue;
    if (
      search &&
      !document.name.toLowerCase().includes(search) &&
      !options.contentMatches?.has(document.id)
    )
      continue;
    const ancestors: Connection[] = [];
    const visited = new Set<string>();
    let parentId = document.parentFolderId ?? undefined;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = groups.get(parentId);
      if (!parent) break;
      ancestors.push(parent);
      parentId = parent.parentId;
    }
    // Missing or cyclic folder chains must not make a saved document invisible.
    const owner = parentId ? undefined : (document.parentFolderId ?? undefined);
    if (owner)
      for (const ancestor of ancestors) {
        included.add(ancestor.id);
        if (mode === "documents" || search || documentType !== "all")
          expandedForDocuments.add(ancestor.id);
      }
    const siblings = byParent.get(owner) ?? [];
    siblings.push(document);
    byParent.set(owner, siblings);
  }
  for (const siblings of byParent.values())
    siblings.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  const collection = connections.filter((entry) => included.has(entry.id));
  const rows: ConnectionDocumentTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | undefined, level: number) => {
    const connectionSiblings = buildTree(collection, parentId);
    const documentSiblings = byParent.get(parentId) ?? [];
    const setSize = connectionSiblings.length + documentSiblings.length;
    const parentKey = parentId ? connectionRowKey(parentId) : undefined;
    connectionSiblings.forEach((connection, index) => {
      if (visited.has(connection.id)) return;
      visited.add(connection.id);
      const expanded =
        !!connection.expanded ||
        options.hasActiveConnectionFilter ||
        expandedForDocuments.has(connection.id);
      rows.push({
        kind: "connection",
        key: connectionRowKey(connection.id),
        connection,
        expanded,
        parentKey,
        level,
        setSize,
        posInSet: index + 1,
      });
      if (connection.isGroup && expanded) visit(connection.id, level + 1);
    });
    documentSiblings.forEach((document, index) =>
      rows.push({
        kind: "document",
        key: documentRowKey(document.id),
        document,
        parentKey,
        level,
        setSize,
        posInSet: connectionSiblings.length + index + 1,
      }),
    );
  };
  visit(undefined, 0);
  return rows;
}
