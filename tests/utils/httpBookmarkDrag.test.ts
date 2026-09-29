import { describe, expect, it } from "vitest";
import type { HttpBookmarkItem } from "../../src/types/connection/connection";
import { moveHttpBookmark } from "../../src/utils/protocol/httpBookmarkDrag";

const home = { name: "Home", path: "/" };
const files = { name: "Files", path: "/files?q=1#latest" };
const logs = { name: "Logs", path: "https://logs.example.test/" };
const folder = (
  name: string,
  children: HttpBookmarkItem[] = [],
): HttpBookmarkItem => ({
  name,
  isFolder: true,
  children,
});

function freezeTree(items: HttpBookmarkItem[]): HttpBookmarkItem[] {
  for (const item of items) {
    if (item.isFolder) freezeTree(item.children);
    Object.freeze(item);
  }
  Object.freeze(items);
  return items;
}

describe("moveHttpBookmark", () => {
  it.each([
    { before: true, filled: false },
    { before: true, filled: true },
    { before: false, filled: false },
    { before: false, filled: true },
  ])(
    "appends a root bookmark to a folder (source before=$before, filled=$filled)",
    ({ before, filled }) => {
      const children = filled ? [files] : [];
      const tools = folder("Tools", children);
      const items = freezeTree(
        before ? [home, logs, tools] : [tools, logs, home],
      );
      const snapshot = structuredClone(items);
      const result = moveHttpBookmark(
        items,
        { idx: before ? 0 : 2 },
        before ? 2 : 0,
      );
      const moved = folder("Tools", [...children, home]);
      expect(result).toEqual(before ? [logs, moved] : [moved, logs]);
      expect(items).toEqual(snapshot);
    },
  );

  it.each([true, false])(
    "moves a child across folders (source before=%s)",
    (before) => {
      const source = folder("Source", [home, files]);
      const target = folder("Target", [logs]);
      const items = freezeTree(before ? [source, target] : [target, source]);
      const result = moveHttpBookmark(
        items,
        { idx: before ? 0 : 1, childIdx: 1 },
        before ? 1 : 0,
      );
      const expectedSource = folder("Source", [home]);
      const expectedTarget = folder("Target", [logs, files]);
      expect(result).toEqual(
        before
          ? [expectedSource, expectedTarget]
          : [expectedTarget, expectedSource],
      );
    },
  );

  it("keeps an emptied source folder when its last child moves to an empty folder", () => {
    expect(
      moveHttpBookmark(
        freezeTree([folder("Source", [files]), folder("Target")]),
        { idx: 0, childIdx: 0 },
        1,
      ),
    ).toEqual([folder("Source"), folder("Target", [files])]);
  });

  it.each([0, 2, null])("moves a child to root target %s", (target) => {
    expect(
      moveHttpBookmark(
        freezeTree([home, folder("Tools", [files, logs]), home]),
        { idx: 1, childIdx: 0 },
        target,
      ),
    ).toEqual(
      target === 0
        ? [files, home, folder("Tools", [logs]), home]
        : target === 2
          ? [home, folder("Tools", [logs]), files, home]
          : [home, folder("Tools", [logs]), home, files],
    );
  });

  it.each([
    { source: 0, target: 2, order: [files, logs, home] },
    { source: 2, target: 0, order: [logs, home, files] },
    { source: 0, target: null, order: [files, logs, home] },
  ])(
    "retains root reorder semantics from $source to $target",
    ({ source, target, order }) => {
      expect(
        moveHttpBookmark(
          freezeTree([home, files, logs]),
          { idx: source },
          target,
        ),
      ).toEqual(order);
    },
  );

  it.each([0, 1])(
    "reorders a folder onto another folder without nesting (source=%s)",
    (source) => {
      const a = folder("A", [home]);
      const b = folder("B", [files]);
      expect(
        moveHttpBookmark(freezeTree([a, b]), { idx: source }, 1 - source),
      ).toEqual([b, a]);
    },
  );

  it("moves a folder to the end of the bar with its contents intact", () => {
    const tools = folder("Tools", [files]);
    expect(
      moveHttpBookmark(freezeTree([tools, home]), { idx: 0 }, null),
    ).toEqual([home, tools]);
  });

  it.each([
    { idx: -1 },
    { idx: 3 },
    { idx: 0.5 },
    { idx: NaN },
    { idx: 0, childIdx: 0 },
    { idx: 1, childIdx: -1 },
    { idx: 1, childIdx: 2 },
    { idx: 1, childIdx: 0.5 },
  ])("rejects invalid source %j", (source) => {
    expect(
      moveHttpBookmark(
        freezeTree([home, folder("Tools", [files]), logs]),
        source,
        2,
      ),
    ).toBeNull();
  });

  it.each([-1, 3, 0.5, NaN, Infinity])(
    "rejects invalid target %s",
    (target) => {
      expect(
        moveHttpBookmark(
          freezeTree([home, folder("Tools", [files]), logs]),
          { idx: 0 },
          target,
        ),
      ).toBeNull();
    },
  );

  it("rejects missing items and self/same-folder/already-last drops", () => {
    const items = freezeTree([home, folder("Tools", [files, logs]), logs]);
    expect(moveHttpBookmark([], { idx: 0 }, null)).toBeNull();
    expect(moveHttpBookmark(items, { idx: 0 }, 0)).toBeNull();
    expect(moveHttpBookmark(items, { idx: 1 }, 1)).toBeNull();
    expect(moveHttpBookmark(items, { idx: 1, childIdx: 0 }, 1)).toBeNull();
    expect(moveHttpBookmark(items, { idx: 2 }, null)).toBeNull();
  });

  it("preserves extra properties without mutating either folder or bookmark", () => {
    const bookmark = { ...files, metadata: { color: "blue" } };
    const target = {
      name: "Target",
      isFolder: true as const,
      children: [logs],
      color: "red",
    };
    const items = freezeTree([folder("Source", [bookmark]), target]);
    const before = structuredClone(items);
    expect(moveHttpBookmark(items, { idx: 0, childIdx: 0 }, 1)).toEqual([
      folder("Source"),
      { ...target, children: [logs, bookmark] },
    ]);
    expect(items).toEqual(before);
  });
});
