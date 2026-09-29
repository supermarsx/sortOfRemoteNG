import type { HttpBookmarkItem } from "../../types/connection/connection";

export const HTTP_BOOKMARK_DRAG_TYPE = "application/x-sorng-http-bookmark";

export interface HttpBookmarkLocation {
  idx: number;
  childIdx?: number;
}

const validIndex = (index: number, length: number) =>
  Number.isInteger(index) && index >= 0 && index < length;

/** Move existing items only. A folder target contains bookmarks, not folders. */
export function moveHttpBookmark(
  items: HttpBookmarkItem[],
  source: HttpBookmarkLocation,
  targetIdx: number | null,
): HttpBookmarkItem[] | null {
  if (
    !validIndex(source.idx, items.length) ||
    (targetIdx !== null && !validIndex(targetIdx, items.length)) ||
    targetIdx === source.idx
  )
    return null;

  const root = items[source.idx];
  const childIdx = source.childIdx;
  if (
    childIdx !== undefined &&
    (!root.isFolder || !validIndex(childIdx, root.children.length))
  )
    return null;
  const item =
    childIdx !== undefined && root.isFolder ? root.children[childIdx] : root;
  // Nested folders are not rendered by the bookmark bar; never create them.
  if (childIdx !== undefined && item.isFolder) return null;
  if (
    childIdx === undefined &&
    targetIdx === null &&
    source.idx === items.length - 1
  )
    return null;

  const target = targetIdx === null ? undefined : items[targetIdx];
  const next = [...items];
  if (childIdx !== undefined && root.isFolder) {
    next[source.idx] = {
      ...root,
      children: root.children.filter((_, index) => index !== childIdx),
    };
  } else {
    next.splice(source.idx, 1);
  }

  if (target?.isFolder && !item.isFolder && targetIdx !== null) {
    const adjustedTarget =
      childIdx === undefined && source.idx < targetIdx
        ? targetIdx - 1
        : targetIdx;
    next[adjustedTarget] = { ...target, children: [...target.children, item] };
  } else {
    // Retain the existing bar-reorder behavior for folder drags and ordinary
    // bookmark targets. Dropping on empty bar space appends at the root.
    next.splice(targetIdx ?? next.length, 0, item);
  }
  return next;
}
