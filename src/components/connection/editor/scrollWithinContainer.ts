export interface ScrollWithinContainerOptions {
  padding?: number;
}

export interface ScrollWithinContainerResult {
  changed: boolean;
  left: number;
  top: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const nearestAxisDelta = (
  targetStart: number,
  targetEnd: number,
  viewportStart: number,
  viewportEnd: number,
) => {
  if (targetStart < viewportStart) return targetStart - viewportStart;
  if (targetEnd > viewportEnd) return targetEnd - viewportEnd;
  return 0;
};

/**
 * Moves only the supplied scroll container. It deliberately avoids
 * `scrollIntoView`, which may scroll every ancestor including the document.
 */
export function scrollElementWithinContainer(
  scrollContainer: HTMLElement,
  target: HTMLElement,
  { padding = 0 }: ScrollWithinContainerOptions = {},
): ScrollWithinContainerResult | undefined {
  if (!scrollContainer.contains(target)) return undefined;

  const safePadding = Math.max(0, padding);
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const viewportLeft = Math.min(
    containerRect.right,
    containerRect.left + safePadding,
  );
  const viewportRight = Math.max(
    viewportLeft,
    containerRect.right - safePadding,
  );
  const viewportTop = Math.min(
    containerRect.bottom,
    containerRect.top + safePadding,
  );
  const viewportBottom = Math.max(
    viewportTop,
    containerRect.bottom - safePadding,
  );

  const left = clamp(
    scrollContainer.scrollLeft +
      nearestAxisDelta(
        targetRect.left,
        targetRect.right,
        viewportLeft,
        viewportRight,
      ),
    0,
    Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth),
  );
  const top = clamp(
    scrollContainer.scrollTop +
      nearestAxisDelta(
        targetRect.top,
        targetRect.bottom,
        viewportTop,
        viewportBottom,
      ),
    0,
    Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
  );
  const changed =
    left !== scrollContainer.scrollLeft || top !== scrollContainer.scrollTop;

  if (left !== scrollContainer.scrollLeft) scrollContainer.scrollLeft = left;
  if (top !== scrollContainer.scrollTop) scrollContainer.scrollTop = top;

  return { changed, left, top };
}
