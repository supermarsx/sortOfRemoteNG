import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  archiveConnections,
  collectConnectionSubtreeIds,
  emptyRecycleBin,
  expiredRecycleBinIds,
  normalizeRecycleBin,
  normalizeRecycleBinPolicy,
  recycleBinRows,
  restoreRecycledConnections,
  selectedRecycleBinIds,
} from "../../src/utils/connection/recycleBin";

const now = Date.UTC(2026, 8, 9);
const day = 86_400_000;
const connection = (
  id: string,
  parentId?: string,
  isGroup = false,
): Connection => ({
  id,
  name: id,
  parentId,
  isGroup,
  protocol: "ssh",
  hostname: "private-host.example.test",
  port: 22,
  username: "fixture-user",
  password: "fixture-secret",
  privateKey: "fixture-private-key",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});
const tree = [
  connection("root", undefined, true),
  connection("nested", "root", true),
  connection("leaf", "nested"),
  connection("other"),
];

describe("database Recycle Bin pure transitions", () => {
  it("defaults only a missing legacy envelope to fifteen days", () => {
    expect(normalizeRecycleBin(undefined)).toEqual({
      version: 1,
      revision: "0",
      policy: { mode: "days", days: 15 },
      entries: [],
    });
    for (const value of [
      null,
      [],
      { version: 2 },
      { ...emptyRecycleBin(), policy: { mode: "days", days: 0 } },
    ])
      expect(() => normalizeRecycleBin(value)).toThrow();
    for (const days of [NaN, Infinity, 0, -1, 1.5, 36_501, "15"])
      expect(() => normalizeRecycleBinPolicy({ mode: "days", days })).toThrow();
  });
  it("rejects invalid and out-of-Date-range archive timestamps without purging", () => {
    const archived = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root"],
      now,
      "batch",
    ).bin;
    for (const deletedAt of [
      NaN,
      -1,
      "today",
      Number.MAX_SAFE_INTEGER,
      8_640_000_000_000_000,
    ]) {
      const value = {
        ...archived,
        entries: [{ ...archived.entries[0], deletedAt }],
      };
      expect(() => normalizeRecycleBin(value)).toThrow();
      expect(archived.entries).toHaveLength(3);
    }
  });
  it("archives the folder and all descendants atomically, retaining full restore data and references", () => {
    const before = structuredClone(tree);
    const moved = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root", "leaf"],
      now,
      "batch",
    );
    expect(moved.archived).toBe(3);
    expect(moved.connections.map((item) => item.id)).toEqual(["other"]);
    expect(moved.bin.entries.map((entry) => entry.connection.id)).toEqual([
      "root",
      "nested",
      "leaf",
    ]);
    expect(moved.bin.entries[2].connection.password).toBe("fixture-secret");
    expect(tree).toEqual(before);
    expect(
      archiveConnections(
        moved.connections,
        moved.bin,
        ["nested", "leaf"],
        now,
        "repeat",
      ).archived,
    ).toBe(0);
  });
  it("keeps children in one mutation without archiving or inheriting their parent secrets", () => {
    const moved = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["nested"],
      now,
      "keep",
      true,
    );
    expect(moved.archived).toBe(1);
    expect(moved.connections.find((item) => item.id === "leaf")?.parentId).toBe(
      "root",
    );
    expect(moved.bin.entries[0].connection.id).toBe("nested");
    const root = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root"],
      now,
      "keep-root",
      true,
    );
    expect(
      root.connections.find((item) => item.id === "nested")?.parentId,
    ).toBeUndefined();
  });
  it("restores parents before children even from reversed archived order", () => {
    const moved = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root"],
      now,
      "batch",
    );
    const bin = { ...moved.bin, entries: [...moved.bin.entries].reverse() };
    const restored = restoreRecycledConnections(
      moved.connections,
      bin,
      ["batch/root"],
      now + day,
      "restore",
    );
    expect(restored.connections.map((item) => item.id)).toEqual([
      "other",
      "root",
      "nested",
      "leaf",
    ]);
    expect(
      restored.connections.find((item) => item.id === "leaf")?.parentId,
    ).toBe("nested");
    expect(restored.bin.entries).toEqual([]);
  });
  it("restores a missing or non-folder parent at root and retains ID collisions", () => {
    const moved = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["leaf"],
      now,
      "batch",
    );
    const restored = restoreRecycledConnections(
      [connection("nested")],
      moved.bin,
      ["batch/leaf"],
      now,
      "restore",
    );
    expect(restored.connections[1].parentId).toBeUndefined();
    const collided = restoreRecycledConnections(
      [connection("leaf")],
      moved.bin,
      ["batch/leaf"],
      now,
      "collision",
    );
    expect(collided.skipped).toBe(1);
    expect(collided.restored).toBe(0);
    expect(collided.bin).toBe(moved.bin);
  });
  it("never restores expired entries and applies changed retention to existing deletion dates", () => {
    const bin = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root"],
      now,
      "batch",
    ).bin;
    expect(expiredRecycleBinIds(bin, now + 15 * day - 1)).toEqual([]);
    expect(expiredRecycleBinIds(bin, now + 15 * day)).toHaveLength(3);
    expect(
      restoreRecycledConnections(
        [],
        bin,
        ["batch/root"],
        now + 15 * day,
        "late",
      ),
    ).toMatchObject({ restored: 0, skipped: 3 });
    expect(
      expiredRecycleBinIds(bin, now + 2 * day, { mode: "days", days: 1 }),
    ).toHaveLength(3);
    expect(
      expiredRecycleBinIds(bin, now + 1000 * day, { mode: "forever" }),
    ).toEqual([]);
  });
  it("isolates folder selection to its deletion batch", () => {
    const old = archiveConnections(
      tree,
      emptyRecycleBin(),
      ["root"],
      now,
      "old",
    ).bin;
    const unrelated = archiveConnections(
      [connection("new-child", "root")],
      old,
      ["new-child"],
      now,
      "new",
    ).bin;
    expect([...selectedRecycleBinIds(unrelated, ["old/root"])]).not.toContain(
      "new/new-child",
    );
  });
  it("handles cyclic and non-folder ancestry without recursion or overwrite", () => {
    const cycle = [
      connection("a", "b", true),
      connection("b", "a", true),
      connection("leaf", "a"),
    ];
    expect([...collectConnectionSubtreeIds(cycle, ["a"])]).toHaveLength(3);
    const bin = archiveConnections(
      cycle,
      emptyRecycleBin(),
      ["a"],
      now,
      "cycle",
    ).bin;
    const restored = restoreRecycledConnections(
      [],
      bin,
      ["cycle/a"],
      now,
      "restore",
    );
    expect(restored.restored).toBe(3);
    expect(restored.connections.filter((item) => !item.parentId)).toHaveLength(
      1,
    );
    expect(
      collectConnectionSubtreeIds(
        [connection("a"), connection("child", "a")],
        ["a"],
      ).size,
    ).toBe(1);
  });
  it("builds redacted rows and descendant counts in a deep ten-thousand-folder chain without recursion", () => {
    const deep = Array.from({ length: 10_000 }, (_, index) =>
      connection(String(index), index ? String(index - 1) : undefined, true),
    );
    const bin = archiveConnections(
      deep,
      emptyRecycleBin(),
      ["0"],
      now,
      "deep",
    ).bin;
    const rows = recycleBinRows(bin, []);
    expect(rows[0].descendantCount).toBe(9_999);
    expect(rows[9_999].descendantCount).toBe(0);
    expect(rows[1].parentName).toBe("0");
    expect(JSON.stringify(rows)).not.toMatch(
      /fixture-secret|fixture-private-key|fixture-user|private-host/,
    );
    expect(
      restoreRecycledConnections(
        [],
        { ...bin, entries: [...bin.entries].reverse() },
        ["deep/0"],
        now,
        "restore",
      ).restored,
    ).toBe(10_000);
  });
});
