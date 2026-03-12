/**
 * RDP Frame Pipeline
 *
 * Encapsulates the entire frame rendering hot-path outside of React.
 * Owns the frame queue, rAF loop, renderer, and canvas context — none of
 * which participate in React state or re-renders.
 *
 * The Channel callback pushes raw ArrayBuffers into the queue; the rAF
 * loop drains them and paints directly to the canvas.  React only interacts
 * via imperative calls (attach/detach canvas, resize, destroy).
 */

import { FrameBuffer } from './rdpCanvas';
import {
  createFrameRenderer,
  type FrameRenderer,
  type FrontendRendererType,
} from './rdpRenderers';

export class RdpFramePipeline {
  // ── Queue & scheduling ──────────────────────────────────────────────
  private queue: ArrayBuffer[] = [];
  private rafId = 0;
  private rafPending = false;
  private destroyed = false;

  // ── Rendering ───────────────────────────────────────────────────────
  private canvas: HTMLCanvasElement | null = null;
  private renderer: FrameRenderer | null = null;
  private visCtx: CanvasRenderingContext2D | null = null;
  private fb: FrameBuffer | null = null;

  // ── Magnifier mirror (optional) ─────────────────────────────────────
  private magnifierActive = false;
  private offImgCache: { img: ImageData; w: number; h: number } | null = null;

  // ── Bound rAF callback (stable identity) ────────────────────────────
  private readonly tick = () => this.renderFrames();

  /** The callback to wire into `new Channel<ArrayBuffer>(cb)`. */
  readonly onFrame = (data: ArrayBuffer): void => {
    if (this.destroyed || data.byteLength < 8) return;
    this.queue.push(data);
    if (!this.rafPending) {
      this.rafPending = true;
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Attach a visible canvas and create the renderer. */
  attach(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    rendererType: FrontendRendererType = 'auto',
  ): void {
    this.canvas = canvas;
    canvas.width = width;
    canvas.height = height;
    this.fb = new FrameBuffer(width, height);
    this.renderer = createFrameRenderer(rendererType, canvas);
    this.visCtx = null; // lazily acquired if renderer is null (canvas2d fallback)

    // Flush any frames that arrived before the canvas was ready
    if (this.queue.length > 0 && !this.rafPending) {
      this.rafPending = true;
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /** Resize the render surface (e.g. remote desktop resolution change). */
  resize(width: number, height: number): void {
    if (!this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.fb?.resize(width, height, this.canvas);
    this.renderer?.resize(width, height);
  }

  /** Enable/disable magnifier mirror painting. */
  setMagnifierActive(active: boolean): void {
    this.magnifierActive = active;
  }

  /** Access the FrameBuffer (for magnifier drawing, snapshots, etc.). */
  getFrameBuffer(): FrameBuffer | null {
    return this.fb;
  }

  /** Access the active renderer (for diagnostics). */
  getRenderer(): FrameRenderer | null {
    return this.renderer;
  }

  /** Tear down everything. */
  destroy(): void {
    this.destroyed = true;
    if (this.rafPending) {
      cancelAnimationFrame(this.rafId);
      this.rafPending = false;
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.fb = null;
    this.canvas = null;
    this.visCtx = null;
    this.queue.length = 0;
  }

  // ── Hot path ────────────────────────────────────────────────────────

  private renderFrames(): void {
    this.rafPending = false;
    const queue = this.queue;
    const fb = this.fb;
    const canvas = this.canvas;
    const renderer = this.renderer;

    if (queue.length === 0 || !fb || !canvas) {
      queue.length = 0;
      return;
    }

    if (renderer) {
      const needsOffscreen = this.magnifierActive;
      const offCtx = needsOffscreen ? fb.offscreen.getContext('2d') : null;

      for (let i = 0; i < queue.length; i++) {
        const data = queue[i];
        const view = new DataView(data);
        let offset = 0;
        while (offset + 8 <= data.byteLength) {
          const x = view.getUint16(offset, true);
          const y = view.getUint16(offset + 2, true);
          const w = view.getUint16(offset + 4, true);
          const h = view.getUint16(offset + 6, true);
          const pixelBytes = w * h * 4;
          if (offset + 8 + pixelBytes > data.byteLength) break;
          const rgba = new Uint8ClampedArray(data, offset + 8, pixelBytes);
          renderer.paintRegion(x, y, w, h, rgba);
          if (offCtx && w > 0 && h > 0) {
            let cache = this.offImgCache;
            if (!cache || cache.w !== w || cache.h !== h) {
              cache = { img: new ImageData(w, h), w, h };
              this.offImgCache = cache;
            }
            cache.img.data.set(rgba);
            offCtx.putImageData(cache.img, x, y);
            fb.hasPainted = true;
          }
          offset += 8 + pixelBytes;
        }
      }
      renderer.present();
    } else {
      // Canvas 2D fallback (no pluggable renderer)
      if (!this.visCtx) this.visCtx = canvas.getContext('2d');
      const ctx = this.visCtx;
      if (ctx) {
        for (let i = 0; i < queue.length; i++) {
          const data = queue[i];
          const view = new DataView(data);
          let offset = 0;
          while (offset + 8 <= data.byteLength) {
            const x = view.getUint16(offset, true);
            const y = view.getUint16(offset + 2, true);
            const w = view.getUint16(offset + 4, true);
            const h = view.getUint16(offset + 6, true);
            const pixelBytes = w * h * 4;
            if (offset + 8 + pixelBytes > data.byteLength) break;
            const rgba = new Uint8ClampedArray(data, offset + 8, pixelBytes);
            fb.paintDirect(ctx, x, y, w, h, rgba);
            offset += 8 + pixelBytes;
          }
        }
      }
    }

    queue.length = 0;
  }
}
