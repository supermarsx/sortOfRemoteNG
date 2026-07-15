import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  buildParentFolderProjection,
  canSelectParentFolder,
  filterParentFolderOptions,
} from "../../src/utils/connection/parentFolderTree";

const makeConnection = (
  id: string,
  name: string,
  overrides: Partial<Connection> = {},
): Connection => ({
  id,
  name,
  protocol: "rdp",
  hostname: "",
  port: 3389,
  isGroup: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("parent folder tree projection", () => {
  it("projects actual hierarchy with deterministic order, depth, and full paths", () => {
    const connections = [
      makeConnection("z-root", "Zulu", { order: 2 }),
      makeConnection("server", "Not a folder", { isGroup: false }),
      makeConnection("prod", "Production", { parentId: "a-root" }),
      makeConnection("a-root", "Infrastructure", { order: 1 }),
      makeConnection("db", "Databases", { parentId: "prod" }),
      makeConnection("orphan", "Orphaned", { parentId: "missing" }),
    ];

    const projection = buildParentFolderProjection({ connections });

    expect(projection.options.map((option) => option.value)).toEqual([
      "",
      "a-root",
      "prod",
      "db",
      "z-root",
      "orphan",
    ]);
    expect(
      projection.options.find((option) => option.value === "prod"),
    ).toMatchObject({
      depth: 1,
      path: "Infrastructure / Production",
      orphaned: false,
    });
    expect(
      projection.options.find((option) => option.value === "db"),
    ).toMatchObject({
      depth: 2,
      path: "Infrastructure / Production / Databases",
    });
    expect(
      projection.options.find((option) => option.value === "orphan"),
    ).toMatchObject({
      depth: 0,
      path: "Missing folder (missing) / Orphaned",
      orphaned: true,
    });
  });

  it("preserves self, descendant, and maximum-depth disabled reasons", () => {
    const deepFolders = Array.from({ length: 8 }, (_, index) =>
      makeConnection(`deep-${index}`, `Deep ${index}`, {
        parentId: index === 0 ? undefined : `deep-${index - 1}`,
      }),
    );
    const current = makeConnection("current", "Current");
    const child = makeConnection("child", "Child", { parentId: current.id });
    const connections = [current, child, ...deepFolders];

    const projection = buildParentFolderProjection({
      connections,
      currentConnectionId: current.id,
      currentIsGroup: true,
    });

    expect(
      projection.options.find((option) => option.value === current.id)?.reason,
    ).toBe("Cannot be its own parent");
    expect(
      projection.options.find((option) => option.value === child.id)?.reason,
    ).toBe("Cannot move into own descendant");
    expect(
      projection.options.find((option) => option.value === "deep-7")?.reason,
    ).toBe("Max depth (8) exceeded");
    expect(canSelectParentFolder(projection, current.id)).toBe(false);
    expect(canSelectParentFolder(projection, child.id)).toBe(false);
    expect(canSelectParentFolder(projection, "")).toBe(true);
  });

  it("surfaces missing and non-folder current parents without losing Root", () => {
    const nonFolder = makeConnection("server", "Legacy Server", {
      isGroup: false,
    });

    const missing = buildParentFolderProjection({
      connections: [nonFolder],
      selectedParentId: "missing-parent",
    });
    expect(missing.options[0]).toMatchObject({ value: "", kind: "root" });
    expect(missing.selected).toMatchObject({
      value: "missing-parent",
      kind: "orphan",
      path: "Unavailable parent: missing-parent",
      reason: "Current parent folder is missing",
      current: true,
    });

    const invalid = buildParentFolderProjection({
      connections: [nonFolder],
      selectedParentId: nonFolder.id,
    });
    expect(invalid.selected).toMatchObject({
      path: "Unavailable parent: Legacy Server",
      reason: "Current parent is not a folder",
    });
  });

  it("handles corrupt cycles safely and prevents selecting into them", () => {
    const first = makeConnection("first", "First", { parentId: "second" });
    const second = makeConnection("second", "Second", { parentId: "first" });

    const projection = buildParentFolderProjection({
      connections: [first, second],
    });

    expect(projection.options.map((option) => option.value)).toEqual([
      "",
      "first",
      "second",
    ]);
    expect(projection.options.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining("Cyclic folder hierarchy"),
          reason: "Folder hierarchy contains a cycle",
          disabled: true,
        }),
      ]),
    );
    expect(canSelectParentFolder(projection, "first")).toBe(false);
  });

  it("filters case-insensitively by folder name or complete breadcrumb", () => {
    const projection = buildParentFolderProjection({
      connections: [
        makeConnection("infra", "Infrastructure"),
        makeConnection("prod", "Production", { parentId: "infra" }),
        makeConnection("db", "Databases", { parentId: "prod" }),
      ],
    });

    expect(
      filterParentFolderOptions(
        projection.options,
        "PRODUCTION / databases",
      ).map((option) => option.value),
    ).toEqual(["db"]);
    expect(
      filterParentFolderOptions(projection.options, "root").map(
        (option) => option.value,
      ),
    ).toEqual([""]);
  });
});
