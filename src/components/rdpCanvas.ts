/**
 * RDP Canvas utilities.
 *
 * This module provides helpers for working with the RDP canvas
 * including frame rendering and legacy simulated desktop drawing
 * (kept for offline/demo mode and tests).
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
