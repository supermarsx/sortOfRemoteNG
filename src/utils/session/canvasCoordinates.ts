export interface CanvasClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MapClientPointOptions {
  clientX: number;
  clientY: number;
  rect: CanvasClientRect;
  canvasWidth: number;
  canvasHeight: number;
  objectFitContain?: boolean;
}

export interface CanvasPixelPoint {
  x: number;
  y: number;
}

interface DispatchVncPointerClickOptions extends MapClientPointOptions {
  sendPointerEvent: (x: number, y: number, buttonMask: number) => void;
  scheduleRelease?: (callback: () => void, delayMs: number) => unknown;
}

export function mapClientPointToCanvas({
  clientX,
  clientY,
  rect,
  canvasWidth,
  canvasHeight,
  objectFitContain = false,
}: MapClientPointOptions): CanvasPixelPoint | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return null;
  }

  let left = rect.left;
  let top = rect.top;
  let width = rect.width;
  let height = rect.height;

  if (objectFitContain) {
    const scale = Math.min(
      rect.width / canvasWidth,
      rect.height / canvasHeight,
    );
    width = canvasWidth * scale;
    height = canvasHeight * scale;
    left += (rect.width - width) / 2;
    top += (rect.height - height) / 2;
  }

  const right = left + width;
  const bottom = top + height;
  if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
    return null;
  }

  return {
    x: Math.min(
      canvasWidth - 1,
      Math.max(0, Math.floor(((clientX - left) / width) * canvasWidth)),
    ),
    y: Math.min(
      canvasHeight - 1,
      Math.max(0, Math.floor(((clientY - top) / height) * canvasHeight)),
    ),
  };
}

export function dispatchVncPointerClick({
  sendPointerEvent,
  scheduleRelease = (callback, delayMs) => setTimeout(callback, delayMs),
  ...mapping
}: DispatchVncPointerClickOptions): boolean {
  const point = mapClientPointToCanvas(mapping);
  if (!point) return false;

  sendPointerEvent(point.x, point.y, 0x1);
  scheduleRelease(() => {
    sendPointerEvent(point.x, point.y, 0x0);
  }, 100);
  return true;
}
