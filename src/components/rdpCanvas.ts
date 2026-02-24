/**
 * RDP Canvas utilities.
 *
 * This module provides helpers for working with the RDP canvas
 * including frame rendering, offscreen double-buffering, and
 * legacy simulated desktop drawing (kept for offline/demo mode
 * and tests).
 */

// ─── Real frame rendering helpers ──────────────────────────────────────────

/**
 * Paints a dirty-region RGBA frame onto a canvas context.
 * The `rgba` data must be raw RGBA bytes (Uint8ClampedArray).
 */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): void {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return;
  const imgData = new ImageData(rgba, width, height);
  ctx.putImageData(imgData, x, y);
}

/**
 * Decodes a base64-encoded RGBA string to a Uint8ClampedArray.
 */
export function decodeBase64Rgba(base64: string): Uint8ClampedArray {
  const binary = atob(base64);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Clears the canvas with a dark background.
 */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
}

// ─── Offscreen double-buffer / frame-cache manager ─────────────────────────

/**
 * FrameBuffer manages rendering of RDP dirty-region updates.
 *
 * **Primary path (paintDirect)**: putImageData straight to the visible
 * canvas — zero intermediate copies, minimal latency, no bounding-box
 * merge waste.
 *
 * An OffscreenCanvas is kept *only* as a resize cache so that we can
 * instantly scale the last known frame into a new resolution without
 * waiting for the server.  It is lazily synced from the visible canvas
 * (via `syncFromVisible()`) right before a resize needs it.
 */
export class FrameBuffer {
  /** Offscreen canvas kept as a resize cache. */
  offscreen: OffscreenCanvas;
  /** 2D context of the offscreen canvas. */
  ctx: OffscreenCanvasRenderingContext2D;
  /** Whether at least one frame has been painted (used to gate blits). */
  hasPainted = false;

  /**
   * True when the visible canvas has newer content than the offscreen
   * cache.  Reset after `syncFromVisible()`.
   */
  private offscreenStale = false;

  // ── Dirty bounding box (kept for legacy blitTo callers) ──────────
  private dirtyMinX = 0;
  private dirtyMinY = 0;
  private dirtyMaxX = 0;
  private dirtyMaxY = 0;
  private hasDirtyRect = false;

  constructor(width: number, height: number) {
    this.offscreen = new OffscreenCanvas(width, height);
    const ctx = this.offscreen.getContext('2d');
    if (!ctx) throw new Error('Failed to get OffscreenCanvas 2D context');
    this.ctx = ctx;
  }

  // ── Primary path: paint directly to the visible canvas ───────────

  /**
   * Paint a dirty region directly onto the visible canvas context.
   *
   * This is the hot-path renderer: one `putImageData` per region with
   * **no** intermediate copy.  The browser composites all updates
   * within the same rAF callback into a single on-screen frame.
   */
  paintDirect(
    visibleCtx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return;
    const imgData = new ImageData(rgba, width, height);
    visibleCtx.putImageData(imgData, x, y);
    this.hasPainted = true;
    this.offscreenStale = true;
  }

  /**
   * Sync the offscreen cache from the visible canvas.  Called lazily
   * only when the offscreen content is actually needed (i.e. resize).
   */
  syncFromVisible(visible: HTMLCanvasElement): void {
    if (!this.offscreenStale || !this.hasPainted) return;
    this.ctx.drawImage(visible, 0, 0);
    this.offscreenStale = false;
  }

  // ── Legacy path (kept for backward compatibility / tests) ────────

  /**
   * Apply a dirty-region update to the *offscreen* canvas.
   * @deprecated Prefer `paintDirect()` for the live render path.
   */
  applyRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return;
    const imgData = new ImageData(rgba, width, height);
    this.ctx.putImageData(imgData, x, y);
    this.hasPainted = true;
    // Expand dirty bounding box
    if (this.hasDirtyRect) {
      this.dirtyMinX = Math.min(this.dirtyMinX, x);
      this.dirtyMinY = Math.min(this.dirtyMinY, y);
      this.dirtyMaxX = Math.max(this.dirtyMaxX, x + width);
      this.dirtyMaxY = Math.max(this.dirtyMaxY, y + height);
    } else {
      this.dirtyMinX = x;
      this.dirtyMinY = y;
      this.dirtyMaxX = x + width;
      this.dirtyMaxY = y + height;
      this.hasDirtyRect = true;
    }
  }

  /**
   * Resize the offscreen canvas.  The previous content is scaled into the
   * new dimensions so there is no visual gap while waiting for the server
   * to send fresh frames at the new size.
   *
   * @param newWidth  New canvas width.
   * @param newHeight New canvas height.
   * @param visible   Optional visible canvas — when provided, the offscreen
   *                  cache is synced from it first (needed for the direct
   *                  paint path where offscreen may be stale).
   */
  resize(newWidth: number, newHeight: number, visible?: HTMLCanvasElement): void {
    if (
      newWidth === this.offscreen.width &&
      newHeight === this.offscreen.height
    )
      return;

    // Sync offscreen from visible canvas if stale (direct-paint path)
    if (visible) this.syncFromVisible(visible);

    // Capture current content as a bitmap before resizing.
    if (this.hasPainted) {
      const tmp = new OffscreenCanvas(this.offscreen.width, this.offscreen.height);
      const tmpCtx = tmp.getContext('2d');
      if (tmpCtx) {
        tmpCtx.drawImage(this.offscreen, 0, 0);
        // Resize then scale the old content into the new dimensions.
        this.offscreen.width = newWidth;
        this.offscreen.height = newHeight;
        this.ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, newWidth, newHeight);
        this.offscreenStale = false;
        return;
      }
    }

    // No prior content or fallback: just resize.
    this.offscreen.width = newWidth;
    this.offscreen.height = newHeight;
  }

  /** Blit only the dirty region of the offscreen buffer onto the visible canvas. */
  blitTo(visible: HTMLCanvasElement): void {
    if (!this.hasPainted) return;
    const ctx = visible.getContext('2d');
    if (!ctx) return;
    if (this.hasDirtyRect) {
      const sx = this.dirtyMinX;
      const sy = this.dirtyMinY;
      const sw = this.dirtyMaxX - this.dirtyMinX;
      const sh = this.dirtyMaxY - this.dirtyMinY;
      if (sw > 0 && sh > 0) {
        ctx.drawImage(this.offscreen, sx, sy, sw, sh, sx, sy, sw, sh);
      }
      this.hasDirtyRect = false;
    }
  }

  /** Blit the entire offscreen buffer (used after resize). */
  blitFull(visible: HTMLCanvasElement): void {
    if (!this.hasPainted) return;
    const ctx = visible.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.offscreen, 0, 0);
    this.hasDirtyRect = false;
  }
}

// ─── Legacy simulated desktop (demo / offline mode) ────────────────────────

export const drawSimulatedDesktop = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void => {
  // Draw desktop background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1e40af');
  gradient.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Draw taskbar
  ctx.fillStyle = '#374151';
  ctx.fillRect(0, height - 40, width, 40);

  // Draw start button
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(5, height - 35, 80, 30);
  ctx.fillStyle = 'white';
  ctx.font = '14px Arial';
  ctx.fillText('Start', 15, height - 15);

  // Draw system tray
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(width - 100, height - 35, 95, 30);

  // Draw time
  ctx.fillStyle = 'white';
  ctx.font = '12px Arial';
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
  ctx.fillText(time, width - 60, height - 15);

  // Draw desktop icons
  drawDesktopIcon(ctx, 50, 50, 'Computer');
  drawDesktopIcon(ctx, 50, 130, 'Documents');
  drawDesktopIcon(ctx, 50, 210, 'Network');

  // Draw window
  drawWindow(ctx, 200, 100, 400, 300, 'Remote Desktop Session');
};

export const drawDesktopIcon = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string
): void => {
  // Icon background
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(x, y, 48, 48);

  // Icon border
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, 48, 48);

  // Icon symbol
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('📁', x + 24, y + 32);

  // Label
  ctx.fillStyle = 'white';
  ctx.font = '11px Arial';
  ctx.fillText(label, x + 24, y + 65);
  ctx.textAlign = 'left';
};

export const drawWindow = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string
): void => {
  // Window background
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y, width, height);

  // Title bar
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(x, y, width, 30);

  // Title text
  ctx.fillStyle = 'white';
  ctx.font = '14px Arial';
  ctx.fillText(title, x + 10, y + 20);

  // Window controls
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x + width - 25, y + 5, 20, 20);
  ctx.fillStyle = 'white';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('×', x + width - 15, y + 17);
  ctx.textAlign = 'left';

  // Window content
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x + 10, y + 40, width - 20, height - 50);

  // Content text
  ctx.fillStyle = '#10b981';
  ctx.font = '12px monospace';
  ctx.fillText('C:\\Users\\Administrator>', x + 20, y + 60);
  ctx.fillText('Microsoft Windows [Version 10.0.19044]', x + 20, y + 80);
  ctx.fillText('(c) Microsoft Corporation. All rights reserved.', x + 20, y + 100);
  ctx.fillText('', x + 20, y + 120);
  ctx.fillText('C:\\Users\\Administrator>_', x + 20, y + 140);
};
