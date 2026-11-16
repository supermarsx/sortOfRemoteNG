export interface OverflowItem {
  id: string;
  /** Lower numbers stay visible longest. */
  priority: number;
  /** Rendered width in px, including its gap. */
  width: number;
}

/**
 * Splits toolbar items into visible and overflow sets for the available
 * width. Items keep their original order; the lowest-priority ones overflow
 * first. When anything overflows, room is reserved for the "more" button.
 */
export function splitToolbarItems(
  items: readonly OverflowItem[],
  available: number,
  moreWidth = 32,
): { visible: string[]; overflow: string[] } {
  const total = items.reduce((sum, item) => sum + item.width, 0);
  if (!Number.isFinite(available) || total <= available)
    return { visible: items.map((item) => item.id), overflow: [] };
  const budget = Math.max(0, available - moreWidth);
  const byPriority = [...items].sort(
    (a, b) => a.priority - b.priority || items.indexOf(a) - items.indexOf(b),
  );
  const keep = new Set<string>();
  let used = 0;
  for (const item of byPriority) {
    if (used + item.width > budget) continue;
    used += item.width;
    keep.add(item.id);
  }
  return {
    visible: items.filter((item) => keep.has(item.id)).map((item) => item.id),
    overflow: items.filter((item) => !keep.has(item.id)).map((item) => item.id),
  };
}
