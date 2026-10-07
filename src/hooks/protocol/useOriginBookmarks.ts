import { useLayoutEffect, useRef } from "react";
import { useConnections } from "../../contexts/useConnections";
import type {
  ConnectionSession,
  HttpBookmarkItem,
} from "../../types/connection/connection";
import { captureSessionDatabaseAccess } from "../../utils/session/sessionDatabaseOwnership";

export type BookmarkPath = number[];
export const bookmarkPathKey = (path: BookmarkPath) => path.join(".");
export const bookmarkContains = (parent: BookmarkPath, child: BookmarkPath) =>
  parent.length <= child.length &&
  parent.every((part, index) => child[index] === part);

/** Bound work without truncating saved data. Malformed trees remain untouched. */
export function cloneOriginBookmarks(value: unknown): HttpBookmarkItem[] {
  let count = 0;
  const copy = (rows: unknown, depth: number): HttpBookmarkItem[] => {
    if (!Array.isArray(rows) || depth > 8)
      throw new Error("Invalid bookmark tree");
    return rows.map((row) => {
      if (++count > 1024 || !row || typeof row.name !== "string")
        throw new Error("Invalid bookmark tree");
      if (row.isFolder === true)
        return { ...row, children: copy(row.children, depth + 1) };
      if (
        typeof row.path !== "string" ||
        (row.isFolder !== undefined && row.isFolder !== false)
      )
        throw new Error("Invalid bookmark tree");
      return { ...row };
    });
  };
  return copy(value ?? [], 0);
}

export function bookmarkChildren(
  tree: HttpBookmarkItem[],
  path: BookmarkPath,
): HttpBookmarkItem[] {
  let rows = tree;
  for (const index of path) {
    if (!Number.isSafeInteger(index) || index < 0)
      throw new Error("Bookmark changed");
    const item = rows[index];
    if (!item?.isFolder) throw new Error("Bookmark changed");
    rows = item.children;
  }
  return rows;
}

export function bookmarkAt(
  tree: HttpBookmarkItem[],
  path: BookmarkPath,
): HttpBookmarkItem {
  const index = path[path.length - 1];
  const item = bookmarkChildren(tree, path.slice(0, -1))[index];
  if (!Number.isSafeInteger(index) || index < 0 || !item)
    throw new Error("Bookmark changed");
  return item;
}

export type BookmarkChange =
  | {
      kind: "save";
      path?: BookmarkPath;
      parent: BookmarkPath;
      item: HttpBookmarkItem;
    }
  | { kind: "remove"; path: BookmarkPath }
  | { kind: "move"; path: BookmarkPath; parent: BookmarkPath; before?: number }
  | { kind: "clear" };

export function changeOriginBookmarks(
  original: HttpBookmarkItem[],
  change: BookmarkChange,
): HttpBookmarkItem[] {
  const tree = cloneOriginBookmarks(original);
  if (change.kind === "clear") return [];
  if (change.kind === "remove") {
    bookmarkAt(tree, change.path);
    bookmarkChildren(tree, change.path.slice(0, -1)).splice(
      change.path[change.path.length - 1],
      1,
    );
    return tree;
  }
  const path = change.path;
  if (path && bookmarkContains(path, change.parent))
    throw new Error("Cannot move a folder into itself");
  // Resolve destination before removing the source (sibling indices may shift).
  const destination = bookmarkChildren(tree, change.parent);
  let item =
    change.kind === "save" ? change.item : bookmarkAt(tree, change.path);
  let insertion =
    change.kind === "move"
      ? (change.before ?? destination.length)
      : destination.length;
  if (
    !Number.isSafeInteger(insertion) ||
    insertion < 0 ||
    insertion > destination.length
  )
    throw new Error("Bookmark changed");
  if (path) {
    const existing = bookmarkAt(tree, path);
    const source = bookmarkChildren(tree, path.slice(0, -1));
    const index = path[path.length - 1];
    if (change.kind === "save") {
      // Preserve non-editor metadata, and the contents of renamed folders.
      item =
        existing.isFolder && change.item.isFolder
          ? { ...existing, name: change.item.name }
          : { ...existing, ...change.item };
      if (source === destination) insertion = index;
    } else if (source === destination && index < insertion) insertion--;
    source.splice(index, 1);
  }
  destination.splice(insertion, 0, item);
  return cloneOriginBookmarks(tree);
}

export interface OriginBookmarkReview {
  tree: HttpBookmarkItem[];
  assertCurrent: () => void;
  commit: (change: BookmarkChange) => Promise<void>;
}

/** Capture at review opening, not at the delayed Save click. No database adoption. */
export function useOriginBookmarks(
  session: ConnectionSession,
  eligible: boolean,
  assertOwner: () => void,
  renderedBookmarks?: HttpBookmarkItem[],
) {
  const context = useConnections();
  const live = useRef({ context, session, eligible, assertOwner });
  const mounted = useRef(false);
  const saving = useRef(false);
  const scopeEpoch = useRef(0);
  useLayoutEffect(() => {
    scopeEpoch.current++;
  }, [
    session,
    eligible,
    context.databaseAvailability?.status,
    context.databaseAvailability?.databaseId,
    context.databaseAvailability?.generation,
  ]);
  useLayoutEffect(() => {
    live.current = { context, session, eligible, assertOwner };
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (): OriginBookmarkReview => {
    const lease = captureSessionDatabaseAccess(session);
    const availability = context.databaseAvailability;
    const databaseId = session.ownerDatabaseId;
    const epoch = scopeEpoch.current;
    const assertScope = () => {
      lease();
      const current = live.current;
      if (
        !mounted.current ||
        scopeEpoch.current !== epoch ||
        !eligible ||
        !current.eligible ||
        current.session !== session ||
        !databaseId ||
        availability?.status !== "ready" ||
        availability.databaseId !== databaseId ||
        current.context.databaseAvailability?.status !== "ready" ||
        current.context.databaseAvailability.databaseId !== databaseId ||
        current.context.databaseAvailability.generation !==
          availability.generation
      )
        throw new Error("Bookmark owner changed");
      current.assertOwner();
    };
    const read = () => {
      assertScope();
      const rows = live.current.context
        .getCurrentConnections?.({
          databaseId: databaseId!,
          generation: availability!.generation,
        })
        .filter((row) => row.id === session.connectionId);
      if (rows?.length !== 1) throw new Error("Bookmark owner changed");
      return rows[0];
    };
    assertOwner();
    const tree = cloneOriginBookmarks(read().httpBookmarks);
    const baseline = JSON.stringify(tree);
    if (baseline !== JSON.stringify(cloneOriginBookmarks(renderedBookmarks)))
      throw new Error("Bookmarks changed before review");
    let consumed = false;
    const assertCurrent = () => {
      assertOwner();
      if (
        consumed ||
        JSON.stringify(cloneOriginBookmarks(read().httpBookmarks)) !== baseline
      )
        throw new Error("Bookmarks changed during review");
    };
    return {
      tree,
      assertCurrent,
      commit: async (change) => {
        if (saving.current) throw new Error("Bookmark save pending");
        assertCurrent();
        const next = changeOriginBookmarks(tree, change);
        const current = read();
        assertCurrent();
        consumed = true;
        saving.current = true;
        try {
          await live.current.context.dispatchAndFlush({
            type: "UPDATE_CONNECTION",
            payload: { ...current, httpBookmarks: next },
          });
          // A save may publish a new connection object; check current authority,
          // not the pre-save React object, after persistence completes.
          assertScope();
        } finally {
          saving.current = false;
        }
      },
    };
  };
}
