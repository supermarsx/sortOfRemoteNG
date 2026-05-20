import { describe, it, expect } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  buildApplyItems,
  remapConnectionsForApply,
  type ApplyConnectionsItem,
} from "../../src/components/ImportExport/applyConnections";

function conn(id: string, name: string, extras: Partial<Connection> = {}): Connection {
  return {
    id,
    name,
    protocol: "ssh",
    hostname: "host",
    port: 22,
    isGroup: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extras,
  } as Connection;
}

function item(c: Connection, status: ApplyConnectionsItem["conflictStatus"] = "none"): ApplyConnectionsItem {
  return { connection: c, conflictStatus: status };
}

describe("remapConnectionsForApply", () => {
  it("passes non-conflicting connections through unchanged", () => {
    const items = [item(conn("a", "Alpha")), item(conn("b", "Beta"))];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped).toHaveLength(2);
    expect(result.remapped[0].id).toBe("a");
    expect(result.remapped[1].id).toBe("b");
    expect(result.renamed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("regenerates id only when status is sameId (duplicate policy)", () => {
    const items = [
      item(conn("a", "Alpha"), "sameId"),
      item(conn("b", "Beta"), "sameName"),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped[0].id).not.toBe("a");
    expect(result.remapped[1].id).toBe("b");
  });

  it("regenerates id for every item when policy is rename", () => {
    const items = [item(conn("a", "Alpha")), item(conn("b", "Beta"))];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "rename",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped[0].id).not.toBe("a");
    expect(result.remapped[1].id).not.toBe("b");
  });

  it("suffixes the name only for non-none conflicts under rename policy", () => {
    const items = [
      item(conn("a", "Alpha"), "none"),
      item(conn("b", "Beta"), "sameName"),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "rename",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped[0].name).toBe("Alpha");
    expect(result.remapped[1].name).toBe("Beta (imported)");
    expect(result.renamed).toBe(1);
  });

  it("drops conflicting items under skip policy", () => {
    const items = [
      item(conn("a", "Alpha"), "none"),
      item(conn("b", "Beta"), "sameId"),
      item(conn("c", "Gamma"), "sameEndpoint"),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "skip",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped).toHaveLength(1);
    expect(result.remapped[0].id).toBe("a");
    expect(result.skipped).toBe(2);
  });

  it("remaps parentId when the parent's id was regenerated", () => {
    const items = [
      item(conn("parent", "Folder", { isGroup: true }), "sameId"),
      item(conn("child", "Inside", { parentId: "parent" })),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: [],
      preserveFolders: true,
    });
    const parent = result.remapped.find((c) => c.name === "Folder")!;
    const child = result.remapped.find((c) => c.name === "Inside")!;
    expect(parent.id).not.toBe("parent");
    expect(child.parentId).toBe(parent.id);
  });

  it("drops parentId when the parent isn't in the selection", () => {
    const items = [
      item(conn("orphan", "Orphan", { parentId: "missing-parent" })),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: [],
      preserveFolders: true,
    });
    expect(result.remapped[0].parentId).toBeUndefined();
  });

  it("drops parentId when preserveFolders is off, even for selected parents", () => {
    const items = [
      item(conn("parent", "Folder", { isGroup: true })),
      item(conn("child", "Inside", { parentId: "parent" })),
    ];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: [],
      preserveFolders: false,
    });
    // The folder itself is filtered out, and the child loses its parent
    expect(result.remapped).toHaveLength(1);
    expect(result.remapped[0].name).toBe("Inside");
    expect(result.remapped[0].parentId).toBeUndefined();
  });

  it("appends addTags without duplicating existing ones", () => {
    const items = [item(conn("a", "Alpha", { tags: ["existing"] }))];
    const result = remapConnectionsForApply(items, {
      conflictPolicy: "duplicate",
      addTags: ["existing", "new"],
      preserveFolders: true,
    });
    expect(result.remapped[0].tags).toEqual(["existing", "new"]);
  });
});

describe("buildApplyItems", () => {
  it("marks sameId when an id collides at the target", () => {
    const items = buildApplyItems([conn("a", "Alpha")], [conn("a", "Existing")]);
    expect(items[0].conflictStatus).toBe("sameId");
  });

  it("marks sameName when the parent + name collides", () => {
    const items = buildApplyItems(
      [conn("b", "Beta", { parentId: "p1" })],
      [conn("z", "Beta", { parentId: "p1" })],
    );
    expect(items[0].conflictStatus).toBe("sameName");
  });

  it("returns none when neither id nor name+parent overlap", () => {
    const items = buildApplyItems(
      [conn("a", "Alpha")],
      [conn("b", "Beta")],
    );
    expect(items[0].conflictStatus).toBe("none");
  });

  it("treats parentless connections as a separate namespace from any folder", () => {
    const items = buildApplyItems(
      [conn("a", "Same Name")],
      [conn("b", "Same Name", { parentId: "p1" })],
    );
    // Same name but the existing one is inside a folder, the new one
    // is at the root — no collision.
    expect(items[0].conflictStatus).toBe("none");
  });
});
