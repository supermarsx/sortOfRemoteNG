/**
 * Window repatriation utilities for handling windows that are positioned
 * off-screen due to monitor configuration changes.
 */
import {
  getCurrentWindow,
  availableMonitors,
  type Monitor,
} from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RepatriationResult {
  wasOffScreen: boolean;
  previousPosition: { x: number; y: number };
  newPosition: { x: number; y: number };
  targetMonitor?: string;
}

/**
 * Check if a rectangle is at least partially visible on any available monitor.
 * @param bounds - The window bounds to check
 * @param monitors - List of available monitors
 * @param minVisiblePixels - Minimum pixels that must be visible (default: 100)
 * @returns Whether the window is visible on any monitor
 */
export function isWindowVisibleOnAnyMonitor(
  bounds: WindowBounds,
  monitors: Monitor[],
  minVisiblePixels: number = 100
): boolean {
  for (const monitor of monitors) {
    // Use work area if available (excludes taskbar), otherwise use full size
    const monitorX = monitor.workArea?.position?.x ?? monitor.position.x;
    const monitorY = monitor.workArea?.position?.y ?? monitor.position.y;
    const monitorWidth = monitor.workArea?.size?.width ?? monitor.size.width;
    const monitorHeight = monitor.workArea?.size?.height ?? monitor.size.height;

    // Calculate intersection
    const intersectLeft = Math.max(bounds.x, monitorX);
    const intersectRight = Math.min(
      bounds.x + bounds.width,
      monitorX + monitorWidth
    );
    const intersectTop = Math.max(bounds.y, monitorY);
    const intersectBottom = Math.min(
      bounds.y + bounds.height,
      monitorY + monitorHeight
    );

    const intersectWidth = Math.max(0, intersectRight - intersectLeft);
    const intersectHeight = Math.max(0, intersectBottom - intersectTop);
    const intersectArea = intersectWidth * intersectHeight;

    // Check if enough of the window is visible
    if (intersectArea >= minVisiblePixels * minVisiblePixels) {
      return true;
    }

    // Also check if the title bar area is accessible (top part of window)
    const titleBarHeight = 40; // Approximate title bar height
    if (
      intersectWidth >= minVisiblePixels &&
      intersectTop <= bounds.y + titleBarHeight &&
      intersectBottom >= bounds.y
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Find the best monitor to move the window to.
 * Prefers the primary monitor, then the closest monitor to the current position.
 */
export function findBestMonitor(
  currentPosition: { x: number; y: number },
  monitors: Monitor[]
): Monitor | null {
  if (monitors.length === 0) return null;

  // Try to find the primary monitor (usually at 0,0)
  const primaryMonitor = monitors.find(
    (m) => m.position.x === 0 && m.position.y === 0
  );

  if (primaryMonitor) return primaryMonitor;

  // Otherwise, find the closest monitor
  let closestMonitor = monitors[0];
  let closestDistance = Infinity;

  for (const monitor of monitors) {
    const monitorCenterX =
      monitor.position.x + (monitor.workArea?.size?.width ?? monitor.size.width) / 2;
    const monitorCenterY =
      monitor.position.y + (monitor.workArea?.size?.height ?? monitor.size.height) / 2;

    const distance = Math.sqrt(
      Math.pow(currentPosition.x - monitorCenterX, 2) +
        Math.pow(currentPosition.y - monitorCenterY, 2)
    );

    if (distance < closestDistance) {
      closestDistance = distance;
      closestMonitor = monitor;
    }
  }

  return closestMonitor;
}

/**
 * Calculate a safe position within the target monitor's work area.
 * Centers the window if it would overflow, otherwise keeps it within bounds.
 */
export function calculateSafePosition(
  windowSize: { width: number; height: number },
  monitor: Monitor,
  margin: number = 20
): { x: number; y: number } {
  const monitorX = monitor.workArea?.position?.x ?? monitor.position.x;
  const monitorY = monitor.workArea?.position?.y ?? monitor.position.y;
  const monitorWidth = monitor.workArea?.size?.width ?? monitor.size.width;
  const monitorHeight = monitor.workArea?.size?.height ?? monitor.size.height;

  // Ensure window fits within monitor with margin
  const maxWidth = monitorWidth - margin * 2;
  const maxHeight = monitorHeight - margin * 2;

  const effectiveWidth = Math.min(windowSize.width, maxWidth);
  const effectiveHeight = Math.min(windowSize.height, maxHeight);

  // Center the window on the target monitor
  const x = monitorX + (monitorWidth - effectiveWidth) / 2;
  const y = monitorY + (monitorHeight - effectiveHeight) / 2;

  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Check if the current window is off-screen and needs repatriation.
 */
export async function checkWindowNeedsRepatriation(
  minVisiblePixels: number = 100
): Promise<boolean> {
  try {
    const currentWindow = getCurrentWindow();
    const [position, size, scaleFactor, monitors] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
      currentWindow.scaleFactor(),
      availableMonitors(),
    ]);

    if (monitors.length === 0) return false;

    const logicalPosition = position.toLogical(scaleFactor);
    const logicalSize = size.toLogical(scaleFactor);

    const bounds: WindowBounds = {
      x: logicalPosition.x,
      y: logicalPosition.y,
      width: logicalSize.width,
      height: logicalSize.height,
    };

    return !isWindowVisibleOnAnyMonitor(bounds, monitors, minVisiblePixels);
  } catch (error) {
    console.error("Failed to check window visibility:", error);
    return false;
  }
}

/**
 * Repatriate the window to a visible position on an available monitor.
 * @param centerOnMonitor - If true, centers the window; if false, moves to top-left with margin
 * @returns Information about the repatriation action
 */
export async function repatriateWindow(
  centerOnMonitor: boolean = true
): Promise<RepatriationResult> {
  const currentWindow = getCurrentWindow();
  const [position, size, scaleFactor, monitors] = await Promise.all([
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
    currentWindow.scaleFactor(),
    availableMonitors(),
  ]);

  const logicalPosition = position.toLogical(scaleFactor);
  const logicalSize = size.toLogical(scaleFactor);

  const previousPosition = {
    x: logicalPosition.x,
    y: logicalPosition.y,
  };

  const bounds: WindowBounds = {
    x: logicalPosition.x,
    y: logicalPosition.y,
    width: logicalSize.width,
    height: logicalSize.height,
  };

  const wasOffScreen = !isWindowVisibleOnAnyMonitor(bounds, monitors);

  if (!wasOffScreen) {
    return {
      wasOffScreen: false,
      previousPosition,
      newPosition: previousPosition,
    };
  }

  // Find the best monitor to move to
  const targetMonitor = findBestMonitor(previousPosition, monitors);
  if (!targetMonitor) {
    // Fallback: center the window
    await currentWindow.center();
    const newPos = await currentWindow.outerPosition();
    const newLogical = newPos.toLogical(scaleFactor);
    return {
      wasOffScreen: true,
      previousPosition,
      newPosition: { x: newLogical.x, y: newLogical.y },
    };
  }

  // Calculate safe position
  let newPosition: { x: number; y: number };

  if (centerOnMonitor) {
    newPosition = calculateSafePosition(
      { width: logicalSize.width, height: logicalSize.height },
      targetMonitor
    );
  } else {
    // Move to top-left corner with margin
    const margin = 50;
    newPosition = {
      x: (targetMonitor.workArea?.position?.x ?? targetMonitor.position.x) + margin,
      y: (targetMonitor.workArea?.position?.y ?? targetMonitor.position.y) + margin,
    };
  }

  await currentWindow.setPosition(
    new LogicalPosition(newPosition.x, newPosition.y)
  );

  return {
    wasOffScreen: true,
    previousPosition,
    newPosition,
    targetMonitor: targetMonitor.name ?? undefined,
  };
}

/**
 * Validate and adjust a saved window position before applying it.
 * Returns the adjusted position or null if adjustment is needed.
 */
export async function validateSavedPosition(
  savedPosition: { x: number; y: number },
  savedSize: { width: number; height: number },
  minVisiblePixels: number = 100
): Promise<{ position: { x: number; y: number }; adjusted: boolean } | null> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) return null;

    const bounds: WindowBounds = {
      x: savedPosition.x,
      y: savedPosition.y,
      width: savedSize.width,
      height: savedSize.height,
    };

    if (isWindowVisibleOnAnyMonitor(bounds, monitors, minVisiblePixels)) {
      return { position: savedPosition, adjusted: false };
    }

    // Position is off-screen, calculate a safe alternative
    const targetMonitor = findBestMonitor(savedPosition, monitors);
    if (!targetMonitor) return null;

    const safePosition = calculateSafePosition(savedSize, targetMonitor);
    return { position: safePosition, adjusted: true };
  } catch (error) {
    console.error("Failed to validate saved position:", error);
    return null;
  }
}

/**
 * Get information about all available monitors for debugging/display.
 */
export async function getMonitorInfo(): Promise<
  Array<{
    name: string | null;
    position: { x: number; y: number };
    size: { width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    scaleFactor: number;
  }>
> {
  const monitors = await availableMonitors();
  return monitors.map((m) => ({
    name: m.name,
    position: { x: m.position.x, y: m.position.y },
    size: { width: m.size.width, height: m.size.height },
    workArea: {
      x: m.workArea?.position?.x ?? m.position.x,
      y: m.workArea?.position?.y ?? m.position.y,
      width: m.workArea?.size?.width ?? m.size.width,
      height: m.workArea?.size?.height ?? m.size.height,
    },
    scaleFactor: m.scaleFactor,
  }));
}
