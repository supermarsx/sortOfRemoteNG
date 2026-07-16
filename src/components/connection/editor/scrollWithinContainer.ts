export interface ScrollWithinContainerOptions {
  padding?: number;
  /** Limit movement to one axis when the caller owns only that scroll lane. */
  axis?: "both" | "horizontal" | "vertical";
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
  const targetSize = targetEnd - targetStart;
  const viewportSize = viewportEnd - viewportStart;
  if (targetSize > viewportSize) {
    // An oversized target can never fit completely. If it already intersects
    // the viewport, keep the current stable position; otherwise reveal its
    // leading edge. This avoids resize/observer ping-pong between both edges.
    if (targetEnd >= viewportStart && targetStart <= viewportEnd) return 0;
    return targetStart - viewportStart;
  }
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
  { padding = 0, axis = "both" }: ScrollWithinContainerOptions = {},
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

  const left =
    axis === "vertical"
      ? scrollContainer.scrollLeft
      : clamp(
          scrollContainer.scrollLeft +
            nearestAxisDelta(
              targetRect.left,
              targetRect.right,
              viewportLeft,
              viewportRight,
            ),
          0,
          Math.max(
            0,
            scrollContainer.scrollWidth - scrollContainer.clientWidth,
          ),
        );
  const top =
    axis === "horizontal"
      ? scrollContainer.scrollTop
      : clamp(
          scrollContainer.scrollTop +
            nearestAxisDelta(
              targetRect.top,
              targetRect.bottom,
              viewportTop,
              viewportBottom,
            ),
          0,
          Math.max(
            0,
            scrollContainer.scrollHeight - scrollContainer.clientHeight,
          ),
        );
  const changed =
    left !== scrollContainer.scrollLeft || top !== scrollContainer.scrollTop;

  if (left !== scrollContainer.scrollLeft) scrollContainer.scrollLeft = left;
  if (top !== scrollContainer.scrollTop) scrollContainer.scrollTop = top;

  return { changed, left, top };
}
