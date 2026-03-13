/**
 * RDP Frame Pipeline
 *
 * Encapsulates the entire frame rendering hot-path outside of React.
 * Owns the frame queue, render loop, renderer, and canvas context — none of
 * which participate in React state or re-renders.
 *
 * Scheduling modes:
 *
 * | Mode          | Interval | Mechanism                      | Best for            |
 * |---------------|----------|--------------------------------|---------------------|
 * | `vsync`       | ~16ms    | requestAnimationFrame          | Battery / idle      |
 * | `low-latency` | ~1ms     | MessageChannel.postMessage     | Fast animations     |
 * | `adaptive`    | dynamic  | Starts vsync, escalates on     | Default — balances  |
 * |               |          | queue pressure, relaxes back   | latency vs. power   |
 *
 * Triple buffering:
 * When the WebGL renderer is created with `tripleBuffering: true`, it uses
 * ping-pong textures so the GPU never stalls reading a texture while the
 * CPU is uploading dirty regions to the other.
 */

import { FrameBuffer } from './rdpCanvas';
import {
  createFrameRenderer,
  type FrameRenderer,
  type FrontendRendererType,
  type RendererOptions,
} from './rdpRenderers';

// ─── Types ──────────────────────────────────────────────────────────────────

export type FrameSchedulingMode = 'vsync' | 'low-latency' | 'adaptive';

export interface PipelineOptions {
  scheduling?: FrameSchedulingMode;
  tripleBuffering?: boolean;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export class RdpFramePipeline {
  // ── Queue & scheduling ──────────────────────────────────────────────
  private queue: ArrayBuffer[] = [];
  private rafId = 0;
  private pending = false;
  private destroyed = false;
  private diagFrameCount = 0;
  private diagRenderCount = 0;
  private diagDropCount = 0;

  // ── Scheduling ──────────────────────────────────────────────────────
  private readonly scheduleMode: FrameSchedulingMode;
  private readonly msgChannel: MessageChannel | null = null;
  private usingLowLatency = false; // current state for adaptive mode

  // Adaptive mode: tracks queue depth to decide when to escalate/relax.
  // Escalation requires ESCALATE_COUNT consecutive high-queue ticks to avoid
  // oscillation from transient spikes.
  private static readonly ADAPTIVE_ESCALATE_THRESHOLD = 2;
  private static readonly ADAPTIVE_ESCALATE_COUNT = 3; // require 3 consecutive high ticks
  private static readonly ADAPTIVE_RELAX_FRAMES = 60; // relax after N consecutive low-queue ticks
  private adaptiveRelaxCounter = 0;
  private adaptiveEscalateCounter = 0;

  // ── Rendering ───────────────────────────────────────────────────────
  private canvas: HTMLCanvasElement | null = null;
  private renderer: FrameRenderer | null = null;
  private visCtx: CanvasRenderingContext2D | null = null;
  private fb: FrameBuffer | null = null;
  private readonly rendererOpts: RendererOptions;
  // Frames that arrived before attach() — replayed once a renderer exists.
  private preAttachBuffer: ArrayBuffer[] = [];
  private static readonly MAX_PRE_ATTACH_BYTES = 64 * 1024 * 1024; // 64 MB cap
  private preAttachBytes = 0;

  // ── Magnifier mirror (optional) ─────────────────────────────────────
  private magnifierActive = false;
  private offImgCache: { img: ImageData; w: number; h: number } | null = null;

  // ── Bound callbacks (stable identity) ──────────────────────────────
  private readonly tick = () => this.renderFrames();

  constructor(opts?: PipelineOptions) {
    this.scheduleMode = opts?.scheduling ?? 'vsync';
    this.rendererOpts = { tripleBuffering: opts?.tripleBuffering ?? false };

    // Create the MessageChannel for low-latency / adaptive scheduling.
    // The channel fires a micro-task on port1 when port2.postMessage() is
    // called — ~0.5-1ms latency vs rAF's ~16ms.
    if (this.scheduleMode !== 'vsync') {
      this.msgChannel = new MessageChannel();
      this.msgChannel.port1.onmessage = this.tick;
    }

    if (this.scheduleMode === 'low-latency') {
      this.usingLowLatency = true;
    }
  }

  /** The callback to wire into `new Channel<ArrayBuffer>(cb)`. */
  readonly onFrame = (data: ArrayBuffer): void => {
    if (this.destroyed) {
      if (this.diagDropCount++ < 3) {
        console.warn(`[RDP pipeline] onFrame called on DESTROYED pipeline (drop #${this.diagDropCount}, ${data.byteLength} bytes)`);
      }
      return;
    }
    if (data.byteLength < 8) return;
    this.queue.push(data);
    if (this.diagFrameCount++ < 5) {
      console.log(`[RDP pipeline] onFrame #${this.diagFrameCount}: ${data.byteLength} bytes, queue=${this.queue.length}, canvas=${!!this.canvas}, renderer=${this.renderer?.name ?? 'null'}, fb=${!!this.fb}`);
    }
    this.scheduleRender();
  };

  // ── Scheduling ────────────────────────────────────────────────────

  private scheduleRender(): void {
    if (this.pending) return;
    this.pending = true;

    if (this.usingLowLatency && this.msgChannel) {
      // Fire via MessageChannel — ~1ms latency, unbound from vsync
      this.msgChannel.port2.postMessage(null);
    } else {
      // Standard vsync-aligned scheduling
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  /** Adaptive mode: check queue pressure and switch scheduling strategy. */
  private adaptiveCheck(): void {
    if (this.scheduleMode !== 'adaptive') return;

    if (this.queue.length >= RdpFramePipeline.ADAPTIVE_ESCALATE_THRESHOLD) {
      // Queue is building up — require sustained pressure before escalating
      this.adaptiveEscalateCounter++;
      this.adaptiveRelaxCounter = 0;
      if (!this.usingLowLatency && this.adaptiveEscalateCounter >= RdpFramePipeline.ADAPTIVE_ESCALATE_COUNT) {
        this.usingLowLatency = true;
      }
    } else {
      // Queue is healthy — count towards relaxing back to vsync
      this.adaptiveEscalateCounter = 0;
      this.adaptiveRelaxCounter++;
      if (this.usingLowLatency && this.adaptiveRelaxCounter >= RdpFramePipeline.ADAPTIVE_RELAX_FRAMES) {
        this.usingLowLatency = false;
        this.adaptiveRelaxCounter = 0;
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /** Attach a visible canvas and create the renderer. */
  attach(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    rendererType: FrontendRendererType = 'auto',
  ): void {
    // Guard: if already attached with same canvas + dimensions + renderer type,
    // skip re-creation to prevent flickering from redundant attach() calls.
    if (
      this.canvas === canvas &&
      this.renderer !== null &&
      this.fb !== null &&
      canvas.width === width &&
      canvas.height === height
    ) {
      console.log(`[RDP pipeline] attach: already attached ${width}x${height} (${this.renderer.name}), skipping`);
      return;
    }

    // If we had a previous renderer, destroy it before creating a new one
    if (this.renderer) {
      console.log(`[RDP pipeline] attach: destroying previous renderer (${this.renderer.name}) before re-attach`);
      this.renderer.destroy();
      this.renderer = null;
    }

    console.log(`[RDP pipeline] attach: ${width}x${height}, type=${rendererType}, destroyed=${this.destroyed}, queuedFrames=${this.queue.length}`);
    this.canvas = canvas;
    canvas.width = width;
    canvas.height = height;
    this.fb = new FrameBuffer(width, height);
    this.renderer = createFrameRenderer(rendererType, canvas, this.rendererOpts);
    this.visCtx = null;
    console.log(`[RDP pipeline] attach complete: renderer=${this.renderer.name}, tripleBuffered=${this.renderer.tripleBuffered}, buffered=${this.preAttachBuffer.length} (${(this.preAttachBytes / 1024).toFixed(0)} KB)`);

    // Replay frames that arrived before the canvas was ready
    if (this.preAttachBuffer.length > 0) {
      console.log(`[RDP pipeline] replaying ${this.preAttachBuffer.length} buffered frames`);
      this.queue.unshift(...this.preAttachBuffer);
      this.preAttachBuffer = [];
      this.preAttachBytes = 0;
    }
    if (this.queue.length > 0 && !this.pending) {
      this.scheduleRender();
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

  /** Current scheduling mode being used (for diagnostics). */
  getActiveScheduling(): 'vsync' | 'low-latency' {
    return this.usingLowLatency ? 'low-latency' : 'vsync';
  }

  /** Tear down everything. */
  destroy(): void {
    this.destroyed = true;
    if (this.pending) {
      cancelAnimationFrame(this.rafId);
      this.pending = false;
    }
    if (this.msgChannel) {
      this.msgChannel.port1.close();
      this.msgChannel.port2.close();
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.fb = null;
    this.canvas = null;
    this.visCtx = null;
    this.queue.length = 0;
    this.preAttachBuffer = [];
    this.preAttachBytes = 0;
  }

  // ── Hot path ────────────────────────────────────────────────────────

  private renderFrames(): void {
    this.pending = false;
    const queue = this.queue;
    const fb = this.fb;
    const canvas = this.canvas;
    const renderer = this.renderer;

    // Adaptive scheduling decision (before we drain)
    this.adaptiveCheck();

    if (queue.length === 0) return;

    if (!fb || !canvas || !renderer) {
      // Not yet attached — buffer frames for replay after attach().
      for (const buf of queue) {
        if (this.preAttachBytes < RdpFramePipeline.MAX_PRE_ATTACH_BYTES) {
          this.preAttachBuffer.push(buf);
          this.preAttachBytes += buf.byteLength;
        }
      }
      if (this.diagRenderCount < 3) {
        console.warn(`[RDP pipeline] renderFrames: not attached yet, buffering ${queue.length} frames (total=${this.preAttachBuffer.length}, ${(this.preAttachBytes / 1024).toFixed(0)} KB)`);
      }
      queue.length = 0;
      return;
    }

    if (this.diagRenderCount++ < 5) {
      console.log(`[RDP pipeline] renderFrames #${this.diagRenderCount}: ${queue.length} buffers, renderer=${renderer.name}`);
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

    // In low-latency mode, if new frames arrived while we were rendering,
    // schedule another tick immediately instead of waiting for the next
    // onFrame call.  This keeps the pipeline drained.
    if (this.queue.length > 0 && !this.pending) {
      this.scheduleRender();
    }
  }
}
