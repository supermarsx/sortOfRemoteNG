import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  buildConnectionDocumentRows,
  type TreeDocumentMetadata,
} from "../../src/components/connection/connectionTree/documentTreeModel";

const connection = (
  id: string,
  parentId?: string,
  isGroup = true,
): Connection => ({
  id,
  name: id,
  protocol: "ssh",
  hostname: "host",
  port: 22,
  isGroup,
  parentId,
  expanded: false,
  createdAt: "",
  updatedAt: "",
});
const connections = [
  connection("Office"),
  connection("Servers", "Office"),
  connection("SSH", "Servers", false),
  connection("Root connection", undefined, false),
];
const docs: TreeDocumentMetadata[] = [
  {
    id: "runbook",
    name: "Runbook",
    icon: "file-text",
    parentFolderId: "Servers",
    blockTypes: ["note", "spreadsheet"],
  },
  {
    id: "root",
    name: "Root document",
    icon: "file-text",
    parentFolderId: null,
    blockTypes: [],
  },
];
const buildTree = (items: Connection[], parentId?: string) =>
  items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
const build = (
  overrides: Partial<Parameters<typeof buildConnectionDocumentRows>[0]> = {},
) =>
  buildConnectionDocumentRows({
    connections,
    filteredConnections: connections,
    documents: docs,
    mode: "all",
    documentType: "all",
    searchTerm: "",
    hasActiveConnectionFilter: false,
    buildTree,
    ...overrides,
  });
const keys = (rows: ReturnType<typeof build>) => rows.map((row) => row.key);

describe("connection/document tree rows", () => {
  it("keeps the connection-only path and respects collapsed folders", () => {
    expect(keys(build({ mode: "connections" }))).toEqual([
      "connection:Office",
      "connection:Root connection",
    ]);
    expect(keys(build())).toEqual([
      "connection:Office",
      "connection:Root connection",
      "document:root",
    ]);
    const expanded = connections.map((entry) => ({ ...entry, expanded: true }));
    expect(
      keys(build({ connections: expanded, filteredConnections: expanded })),
    ).toEqual([
      "connection:Office",
      "connection:Servers",
      "connection:SSH",
      "document:runbook",
      "connection:Root connection",
      "document:root",
    ]);
    expect(connections.every((entry) => entry.expanded === false)).toBe(true);
  });
  it("includes ancestors and hides connection leaves in Documents mode", () => {
    const rows = build({ mode: "documents" });
    expect(keys(rows)).toEqual([
      "connection:Office",
      "connection:Servers",
      "document:runbook",
      "document:root",
    ]);
    expect(rows[2]).toMatchObject({
      kind: "document",
      level: 2,
      parentKey: "connection:Servers",
      setSize: 1,
      posInSet: 1,
    });
    expect(rows[3]).toMatchObject({ level: 0, setSize: 2, posInSet: 2 });
  });
  it("restores collapsed ancestors even when connection search excluded them", () => {
    expect(
      keys(
        build({
          filteredConnections: [],
          searchTerm: " RUNBOOK ",
          hasActiveConnectionFilter: true,
        }),
      ),
    ).toEqual(["connection:Office", "connection:Servers", "document:runbook"]);
  });
  it("filters mixed-block and blank documents without examining bodies", () => {
    expect(
      keys(build({ mode: "documents", documentType: "spreadsheet" })),
    ).toEqual(["connection:Office", "connection:Servers", "document:runbook"]);
    expect(keys(build({ mode: "documents", documentType: "blank" }))).toEqual([
      "document:root",
    ]);
    expect(build({ mode: "documents", documentType: "secret" })).toEqual([]);
  });
  it("uses only explicitly supplied content matches and removes them immediately", () => {
    expect(
      keys(
        build({
          mode: "documents",
          searchTerm: "ordinary content",
          contentMatches: new Set(["runbook"]),
        }),
      ),
    ).toContain("document:runbook");
    expect(
      build({ mode: "documents", searchTerm: "ordinary content" }),
    ).toEqual([]);
  });
  it("uses distinct keys for colliding IDs and exposes orphaned documents at root", () => {
    const documents = [{ ...docs[0], id: "Office", parentFolderId: "missing" }];
    const rows = build({ documents });
    expect(keys(rows)).toEqual([
      "connection:Office",
      "connection:Root connection",
      "document:Office",
    ]);
    expect(rows[2]).not.toHaveProperty("connection");
  });
  it("terminates cyclic folder chains and keeps their documents visible", () => {
    const cycle = [connection("A", "B"), connection("B", "A")];
    expect(
      keys(
        build({
          connections: cycle,
          filteredConnections: cycle,
          documents: [{ ...docs[0], parentFolderId: "A" }],
          mode: "documents",
        }),
      ),
    ).toEqual(["document:runbook"]);
  });
});
