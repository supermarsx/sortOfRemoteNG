/**
 * Lightweight canvas drawing utilities shared by canvas-mode loading-element
 * variants and the offscreen recorder pipeline.
 */

/** Clear the entire canvas back to fully transparent. */
export function clearCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Resize a canvas for the current devicePixelRatio so subsequent drawing in
 * CSS pixels lands on a sharp framebuffer. Returns the dpr that was applied.
 */
export function withDpr(canvas: HTMLCanvasElement, w: number, h: number): number {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return dpr;
}

/**
 * Draw an additive glowing dot using a radial gradient and the 'lighter'
 * composite operation. `intensity` is 0..1 and scales the alpha of the core.
 */
export function drawGlowDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  intensity: number,
): void {
  if (radius <= 0) return;
  const a = Math.max(0, Math.min(1, intensity));
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';

  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, withAlpha(color, a));
  grad.addColorStop(0.45, withAlpha(color, a * 0.45));
  grad.addColorStop(1, withAlpha(color, 0));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = prev;
}

/** Best-effort conversion of a CSS color string to rgba(...) with given alpha. */
function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const c = color.trim();

  // #rgb / #rrggbb / #rrggbbaa
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    let r = 0;
    let g = 0;
    let b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // rgb(...) / rgba(...) — replace alpha
  const m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
    }
  }

  // Fallback: let the browser parse, layer alpha via globalAlpha is not
  // available here, so just return the original colour.
  return c;
}
