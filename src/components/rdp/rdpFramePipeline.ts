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

import { FrameBuffer } from "./rdpCanvas";
import {
  createFrameRenderer,
  isNalPayload,
  type FrameRenderer,
  type FrontendRendererType,
  type RendererOptions,
} from "./rdpRenderers";
import type {
  RdpFramePipelineMetrics,
  RdpH264RecoveryEvent,
  RdpH264RecoveryReason,
  RdpH264RecoveryState,
} from "../../types/rdp/rdpEvents";
import {
  MAX_RDP_FRAME_PAYLOAD_BYTES,
  normalizeRdpFramePayload,
  RdpFramePayloadError,
} from "../../utils/rdp/rdpFramePayload";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FrameSchedulingMode = "vsync" | "low-latency" | "adaptive";

export interface PipelineOptions {
  scheduling?: FrameSchedulingMode;
  tripleBuffering?: boolean;
  onH264RecoveryStateChange?: (event: RdpH264RecoveryEvent) => void;
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export class RdpFramePipeline {
  // ── Queue & scheduling ──────────────────────────────────────────────
  private queue: ArrayBuffer[] = [];
  private queueBytes = 0;
  private rafId = 0;
  private pending = false;
  private destroyed = false;
  private diagFrameCount = 0;
  private diagRenderCount = 0;
  private diagDropCount = 0;
  private malformedPayloadCount = 0;
  private receivedFrameCount = 0;
  private presentedFrameCount = 0;
  private coalescedFrameCount = 0;
  private lastFrameRenderMs = 0;
  private averageFrameRenderMs = 0;
  private renderSampleCount = 0;
  private renderSamplesMs: number[] = [];
  private lastFrameReceivedAtMs: number | undefined;
  private lastFramePresentedAtMs: number | undefined;
  private static readonly MAX_RENDER_SAMPLES = 120;

  // ── Queue pressure management ─────────────────────────────────────
  // Prevent unbounded queue growth which adds latency (N frames × 16ms
  // at 60fps = seconds of accumulated lag).  When the queue exceeds
  // MAX_QUEUE_SIZE, the oldest frames are dropped to keep latency bounded.
  private static readonly MAX_QUEUE_SIZE = 12;
  private static readonly MAX_QUEUE_BYTES = MAX_RDP_FRAME_PAYLOAD_BYTES;
  private queueDropCount = 0;
  private queueDropBytes = 0;
  private lastQueueWarning = 0;

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
  private surfaceWidth = 0;
  private surfaceHeight = 0;
  private readonly rendererOpts: RendererOptions;
  // Frames that arrived before attach() — replayed once a renderer exists.
  private preAttachBuffer: ArrayBuffer[] = [];
  private static readonly MAX_PRE_ATTACH_FRAMES = 4;
  private static readonly MAX_PRE_ATTACH_BYTES = 16 * 1024 * 1024;
  private preAttachBytes = 0;
  private visible = true;
  private h264RecoveryState: RdpH264RecoveryState = "healthy";
  private h264RecoveryReason: RdpH264RecoveryReason | undefined;
  private h264RecoveryEpisode = 0;
  private recoveryNotifiedWhileVisible = false;
  private readonly onH264RecoveryStateChange?: (
    event: RdpH264RecoveryEvent,
  ) => void;

  // ── Magnifier mirror (optional) ─────────────────────────────────────
  private magnifierActive = false;
  private offImgCache: { img: ImageData; w: number; h: number } | null = null;

  // ── Bound callbacks (stable identity) ──────────────────────────────
  private readonly tick = () => this.renderFrames();

  constructor(opts?: PipelineOptions) {
    this.scheduleMode = opts?.scheduling ?? "vsync";
    this.onH264RecoveryStateChange = opts?.onH264RecoveryStateChange;
    this.rendererOpts = {
      tripleBuffering: opts?.tripleBuffering ?? false,
      onH264RecoveryStateChange: this.handleRendererRecoveryState,
    };

    // Create the MessageChannel for low-latency / adaptive scheduling.
    // The channel fires a micro-task on port1 when port2.postMessage() is
    // called — ~0.5-1ms latency vs rAF's ~16ms.
    if (this.scheduleMode !== "vsync") {
      this.msgChannel = new MessageChannel();
      this.msgChannel.port1.onmessage = this.tick;
    }

    if (this.scheduleMode === "low-latency") {
      this.usingLowLatency = true;
    }
  }

  /** The callback to wire into the raw Tauri frame channel. */
  readonly onFrame = (payload: unknown): void => {
    if (this.destroyed) {
      if (this.diagDropCount++ < 3) {
        console.warn(
          `[RDP pipeline] onFrame called on DESTROYED pipeline (drop #${this.diagDropCount})`,
        );
      }
      return;
    }

    this.receivedFrameCount++;
    this.lastFrameReceivedAtMs = performance.now();

    let data: ArrayBuffer;
    try {
      data = normalizeRdpFramePayload(
        payload,
        RdpFramePipeline.MAX_QUEUE_BYTES,
      );
    } catch (error) {
      const payloadError =
        error instanceof RdpFramePayloadError
          ? error
          : new RdpFramePayloadError(
              "unsupported",
              error instanceof Error ? error.message : String(error),
            );
      this.rejectFramePayload(
        payloadError.message,
        payloadError.observedByteLength,
      );
      return;
    }

    if (data.byteLength < 8) {
      this.rejectFramePayload(
        `expected at least 8 bytes, received ${data.byteLength}`,
        data.byteLength,
      );
      return;
    }

    if (!this.visible) {
      this.recordDroppedFrame(data, "background");
      if (isNalPayload(data)) this.enterH264Recovery("background");
      return;
    }
    if (!this.enqueueMainFrame(data)) return;
    if (this.diagFrameCount++ < 5) {
      console.log(
        `[RDP pipeline] onFrame #${this.diagFrameCount}: ${data.byteLength} bytes, queue=${this.queue.length}, canvas=${!!this.canvas}, renderer=${this.renderer?.name ?? "null"}, fb=${!!this.fb}`,
      );
    }
    this.scheduleRender();
  };

  private readonly handleRendererRecoveryState = (
    state: RdpH264RecoveryState,
    reason?: RdpH264RecoveryReason,
  ): void => {
    if (state === "healthy") {
      this.markH264RecoveryHealthy();
      return;
    }
    if (state === "awaitingRecovery") {
      this.enterH264Recovery(reason ?? "renderer-reset");
    }
  };

  private notifyH264Recovery(): void {
    if (
      !this.visible ||
      this.h264RecoveryState !== "awaitingRecovery" ||
      this.recoveryNotifiedWhileVisible
    ) {
      return;
    }
    this.recoveryNotifiedWhileVisible = true;
    this.onH264RecoveryStateChange?.({
      state: "awaitingRecovery",
      episode: this.h264RecoveryEpisode,
      reason: this.h264RecoveryReason,
    });
  }

  private enterH264Recovery(
    reason: RdpH264RecoveryReason,
    resetRenderer = false,
  ): void {
    if (this.h264RecoveryState === "terminal") return;
    if (this.h264RecoveryState !== "awaitingRecovery") {
      this.h264RecoveryEpisode += 1;
      this.recoveryNotifiedWhileVisible = false;
    }
    this.h264RecoveryState = "awaitingRecovery";
    this.h264RecoveryReason = reason;
    if (resetRenderer) this.renderer?.resetH264Recovery?.(reason);
    this.notifyH264Recovery();
  }

  private markH264RecoveryHealthy(): void {
    if (
      this.h264RecoveryState === "healthy" ||
      this.h264RecoveryState === "terminal"
    ) {
      return;
    }
    this.h264RecoveryState = "healthy";
    this.h264RecoveryReason = undefined;
    this.recoveryNotifiedWhileVisible = false;
    this.onH264RecoveryStateChange?.({
      state: "healthy",
      episode: this.h264RecoveryEpisode,
    });
  }

  private recordDroppedFrame(
    frame: ArrayBuffer,
    reason = "queue-pressure",
  ): void {
    this.recordDroppedBytes(frame.byteLength, reason);
  }

  private rejectFramePayload(message: string, byteLength: number): void {
    this.malformedPayloadCount += 1;
    this.recordDroppedBytes(byteLength, "malformed-payload");
    if (this.malformedPayloadCount <= 3) {
      console.error(
        `[RDP pipeline] Rejected malformed frame payload #${this.malformedPayloadCount}: ${message}`,
      );
    }
  }

  private recordDroppedBytes(byteLength: number, reason: string): void {
    this.queueDropCount += 1;
    this.queueDropBytes += byteLength;
    const now = performance.now();
    if (now - this.lastQueueWarning > 2000) {
      console.warn(
        `[RDP pipeline] Dropped ${this.queueDropCount} frames ` +
          `(${(this.queueDropBytes / 1024).toFixed(0)} KB total), reason=${reason}, queue=${this.queue.length}`,
      );
      this.lastQueueWarning = now;
    }
  }

  private clearMainQueue(): void {
    for (const frame of this.queue) this.recordDroppedFrame(frame);
    this.queue.length = 0;
    this.queueBytes = 0;
  }

  private clearPreAttachBuffer(): void {
    for (const frame of this.preAttachBuffer) this.recordDroppedFrame(frame);
    this.preAttachBuffer = [];
    this.preAttachBytes = 0;
  }

  /** Discard every queued H.264 access unit while retaining independent RGBA updates. */
  private discardQueuedNalChain(): boolean {
    let discarded = false;
    const retainedMain: ArrayBuffer[] = [];
    let retainedMainBytes = 0;
    for (const frame of this.queue) {
      if (isNalPayload(frame)) {
        discarded = true;
        this.recordDroppedFrame(frame);
      } else {
        retainedMain.push(frame);
        retainedMainBytes += frame.byteLength;
      }
    }
    this.queue = retainedMain;
    this.queueBytes = retainedMainBytes;

    const retainedPreAttach: ArrayBuffer[] = [];
    let retainedPreAttachBytes = 0;
    for (const frame of this.preAttachBuffer) {
      if (isNalPayload(frame)) {
        discarded = true;
        this.recordDroppedFrame(frame);
      } else {
        retainedPreAttach.push(frame);
        retainedPreAttachBytes += frame.byteLength;
      }
    }
    this.preAttachBuffer = retainedPreAttach;
    this.preAttachBytes = retainedPreAttachBytes;
    return discarded;
  }

  private enqueueMainFrame(data: ArrayBuffer): boolean {
    const tooLarge = data.byteLength > RdpFramePipeline.MAX_QUEUE_BYTES;
    if (tooLarge) {
      this.recordDroppedFrame(data, "oversized-frame");
      if (isNalPayload(data)) this.enterH264Recovery("queue-overflow", true);
      return false;
    }

    const exceedsBounds = () =>
      this.queue.length >= RdpFramePipeline.MAX_QUEUE_SIZE ||
      this.queueBytes + data.byteLength > RdpFramePipeline.MAX_QUEUE_BYTES;
    if (exceedsBounds()) {
      const breaksNalChain =
        isNalPayload(data) || this.queue.some((frame) => isNalPayload(frame));
      if (breaksNalChain) {
        this.clearMainQueue();
        this.enterH264Recovery("queue-overflow", true);
      } else {
        while (this.queue.length > 0 && exceedsBounds()) {
          const dropped = this.queue.shift();
          if (!dropped) break;
          this.queueBytes -= dropped.byteLength;
          this.recordDroppedFrame(dropped);
        }
      }
    }

    if (exceedsBounds()) {
      this.recordDroppedFrame(data);
      return false;
    }
    this.queue.push(data);
    this.queueBytes += data.byteLength;
    return true;
  }

  private bufferPreAttachFrame(data: ArrayBuffer): void {
    if (data.byteLength > RdpFramePipeline.MAX_PRE_ATTACH_BYTES) {
      this.recordDroppedFrame(data, "oversized-frame");
      if (isNalPayload(data)) {
        this.enterH264Recovery("pre-attach-overflow", true);
      }
      return;
    }

    const exceedsBounds = () =>
      this.preAttachBuffer.length >= RdpFramePipeline.MAX_PRE_ATTACH_FRAMES ||
      this.preAttachBytes + data.byteLength >
        RdpFramePipeline.MAX_PRE_ATTACH_BYTES;
    if (exceedsBounds()) {
      const breaksNalChain =
        isNalPayload(data) ||
        this.preAttachBuffer.some((frame) => isNalPayload(frame));
      if (breaksNalChain) {
        this.clearPreAttachBuffer();
        this.enterH264Recovery("pre-attach-overflow", true);
      } else {
        while (this.preAttachBuffer.length > 0 && exceedsBounds()) {
          const dropped = this.preAttachBuffer.shift();
          if (!dropped) break;
          this.preAttachBytes -= dropped.byteLength;
          this.recordDroppedFrame(dropped);
        }
      }
    }

    if (exceedsBounds()) {
      this.recordDroppedFrame(data);
      return;
    }
    this.preAttachBuffer.push(data);
    this.preAttachBytes += data.byteLength;
  }

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
    if (this.scheduleMode !== "adaptive") return;

    if (this.queue.length >= RdpFramePipeline.ADAPTIVE_ESCALATE_THRESHOLD) {
      // Queue is building up — require sustained pressure before escalating
      this.adaptiveEscalateCounter++;
      this.adaptiveRelaxCounter = 0;
      if (
        !this.usingLowLatency &&
        this.adaptiveEscalateCounter >= RdpFramePipeline.ADAPTIVE_ESCALATE_COUNT
      ) {
        this.usingLowLatency = true;
      }
    } else {
      // Queue is healthy — count towards relaxing back to vsync
      this.adaptiveEscalateCounter = 0;
      this.adaptiveRelaxCounter++;
      if (
        this.usingLowLatency &&
        this.adaptiveRelaxCounter >= RdpFramePipeline.ADAPTIVE_RELAX_FRAMES
      ) {
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
    rendererType: FrontendRendererType = "auto",
  ): void {
    const surfaceDimensionsChanged =
      this.surfaceWidth > 0 &&
      this.surfaceHeight > 0 &&
      (this.surfaceWidth !== width || this.surfaceHeight !== height);
    if (surfaceDimensionsChanged && this.discardQueuedNalChain()) {
      this.enterH264Recovery("resize", true);
    }
    this.surfaceWidth = width;
    this.surfaceHeight = height;

    const isReattach =
      this.canvas !== null || this.renderer !== null || this.fb !== null;
    // Guard: if already attached with same canvas + dimensions + renderer type,
    // skip re-creation to prevent flickering from redundant attach() calls.
    if (
      this.canvas === canvas &&
      this.renderer !== null &&
      this.fb !== null &&
      canvas.width === width &&
      canvas.height === height
    ) {
      console.log(
        `[RDP pipeline] attach: already attached ${width}x${height} (${this.renderer.name}), skipping`,
      );
      return;
    }

    // If we had a previous renderer, destroy it before creating a new one.
    const wasOurs = this.isCanvasTransferred();
    if (this.renderer) {
      console.log(
        `[RDP pipeline] attach: destroying previous renderer (${this.renderer.name}, transferred=${wasOurs}) before re-attach`,
      );
      this.renderer.destroy();
      this.renderer = null;
    }

    // Detect if the canvas was EVER transferred to an OffscreenCanvas
    // (by this pipeline or a previous one that was destroyed).  Once
    // transferred, the browser permanently forbids setting width/height
    // on the DOM element — we must replace it with a fresh canvas.
    // We detect this by trying a harmless property probe: if the canvas
    // has been transferred, any width/height set throws InvalidStateError.
    let canvasIsTransferred = wasOurs;
    if (!canvasIsTransferred) {
      try {
        // Read-then-write with same value — throws if transferred
        const w = canvas.width;
        canvas.width = w;
      } catch {
        canvasIsTransferred = true;
      }
    }

    if (canvasIsTransferred && canvas.parentElement) {
      console.log(
        "[RDP pipeline] attach: replacing transferred canvas with fresh element",
      );
      const fresh = document.createElement("canvas");
      for (const attr of Array.from(canvas.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      canvas.parentElement.replaceChild(fresh, canvas);
      canvas = fresh;
    }

    const bufferedFrames = isReattach
      ? []
      : [...this.preAttachBuffer, ...this.queue];
    const discardedNalChain =
      isReattach &&
      [...this.preAttachBuffer, ...this.queue].some((frame) =>
        isNalPayload(frame),
      );
    if (isReattach) {
      this.clearMainQueue();
      this.clearPreAttachBuffer();
      if (discardedNalChain) this.enterH264Recovery("renderer-reset");
    } else {
      this.queue.length = 0;
      this.queueBytes = 0;
      this.preAttachBuffer = [];
      this.preAttachBytes = 0;
    }

    console.log(
      `[RDP pipeline] attach: ${width}x${height}, type=${rendererType}, destroyed=${this.destroyed}, queuedFrames=${this.queue.length}`,
    );
    this.canvas = canvas;
    canvas.width = width;
    canvas.height = height;

    this.fb = new FrameBuffer(width, height);
    this.renderer = createFrameRenderer(rendererType, canvas, {
      ...this.rendererOpts,
      width,
      height,
    });
    this.visCtx = null;
    if (this.h264RecoveryState === "awaitingRecovery") {
      this.renderer.resetH264Recovery?.(
        this.h264RecoveryReason ?? "renderer-reset",
      );
    }
    console.log(
      `[RDP pipeline] attach complete: renderer=${this.renderer.name}, tripleBuffered=${this.renderer.tripleBuffered}, buffered=${bufferedFrames.length}`,
    );

    // Replay frames that arrived before the canvas was ready
    if (bufferedFrames.length > 0) {
      console.log(
        `[RDP pipeline] replaying ${bufferedFrames.length} buffered frames`,
      );
      for (const frame of bufferedFrames) this.enqueueMainFrame(frame);
    }
    if (this.queue.length > 0 && !this.pending) {
      this.scheduleRender();
    }
  }

  /** Resize the render surface (e.g. remote desktop resolution change). */
  resize(width: number, height: number): void {
    const dimensionsChanged =
      this.surfaceWidth !== width || this.surfaceHeight !== height;
    if (!dimensionsChanged) return;
    this.surfaceWidth = width;
    this.surfaceHeight = height;

    const isH264Renderer =
      this.renderer?.type === "webcodecs-worker" ||
      this.renderer?.type === "webcodecs-cpu";
    const discardedNalChain = this.discardQueuedNalChain();
    if (isH264Renderer || discardedNalChain) {
      // The renderer's resize resets pre-ready buffers, parameter sets and the
      // decoder. Enter recovery first so an asynchronous old-size output can
      // never make the new-size episode appear healthy.
      this.enterH264Recovery("resize");
    }

    if (!this.canvas) return;
    // Worker-based renderers transfer canvas control to an OffscreenCanvas —
    // setting width/height on the DOM element after that throws InvalidStateError.
    if (!this.isCanvasTransferred()) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.fb?.resize(
      width,
      height,
      this.isCanvasTransferred() ? undefined : this.canvas,
    );
    this.renderer?.resize(width, height);
  }

  /** Suspend local rendering without stopping the native RDP transport. */
  setVisibility(visible: boolean): void {
    if (this.destroyed || this.visible === visible) {
      if (visible) this.notifyH264Recovery();
      return;
    }
    this.visible = visible;
    if (!visible) {
      this.recoveryNotifiedWhileVisible = false;
      if (this.pending) {
        cancelAnimationFrame(this.rafId);
        this.pending = false;
      }
      const hasNalChain =
        this.queue.some((frame) => isNalPayload(frame)) ||
        this.preAttachBuffer.some((frame) => isNalPayload(frame));
      this.clearMainQueue();
      this.clearPreAttachBuffer();
      if (
        hasNalChain ||
        this.renderer?.type === "webcodecs-worker" ||
        this.renderer?.type === "webcodecs-cpu" ||
        this.h264RecoveryState === "awaitingRecovery"
      ) {
        this.enterH264Recovery("background", true);
      }
      return;
    }
    this.recoveryNotifiedWhileVisible = false;
    this.notifyH264Recovery();
  }

  isAwaitingH264Recovery(): boolean {
    return this.h264RecoveryState === "awaitingRecovery";
  }

  markH264RecoveryTerminal(reason?: RdpH264RecoveryReason): void {
    if (this.h264RecoveryState === "terminal") return;
    this.h264RecoveryState = "terminal";
    this.h264RecoveryReason = reason ?? this.h264RecoveryReason;
    this.recoveryNotifiedWhileVisible = true;
    this.onH264RecoveryStateChange?.({
      state: "terminal",
      episode: this.h264RecoveryEpisode,
      reason: this.h264RecoveryReason,
    });
  }

  /** Whether the current renderer has transferred the canvas to an offscreen context. */
  isCanvasTransferred(): boolean {
    const t = this.renderer?.type;
    return (
      t === "offscreen-worker" ||
      t === "webcodecs-worker" ||
      t === "webcodecs-cpu"
    );
  }

  /** Get the current canvas element (may differ from what was passed to attach
   *  if the canvas was replaced due to a prior OffscreenCanvas transfer). */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
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
  getActiveScheduling(): "vsync" | "low-latency" {
    return this.usingLowLatency ? "low-latency" : "vsync";
  }

  /** Queue stats for diagnostics / UI. */
  getQueueStats(): {
    depth: number;
    droppedFrames: number;
    droppedBytes: number;
  } {
    return {
      depth: this.queue.length,
      droppedFrames: this.queueDropCount,
      droppedBytes: this.queueDropBytes,
    };
  }

  /** Render and queue metrics for diagnostics / backpressure telemetry. */
  getMetrics(): RdpFramePipelineMetrics {
    const renderer = this.renderer;
    return {
      queuedFrames: this.queue.length,
      queuedBytes: this.getQueuedBytes(),
      preAttachFrames: this.preAttachBuffer.length,
      preAttachBytes: this.preAttachBytes,
      receivedFrames: this.receivedFrameCount,
      presentedFrames: this.presentedFrameCount,
      droppedFrames: this.queueDropCount,
      droppedBytes: this.queueDropBytes,
      coalescedFrames: this.coalescedFrameCount,
      lastFrameRenderMs: this.lastFrameRenderMs,
      averageRenderMs: this.averageFrameRenderMs,
      p95RenderMs: this.getRenderPercentile(95),
      activeScheduling: this.getActiveScheduling(),
      renderer: renderer?.name ?? "none",
      rendererType: renderer?.type,
      canvasAttached: !!this.canvas && !!this.fb && !!renderer,
      destroyed: this.destroyed,
      lastFrameReceivedAtMs: this.lastFrameReceivedAtMs,
      lastFramePresentedAtMs: this.lastFramePresentedAtMs,
      h264RecoveryState: this.h264RecoveryState,
      h264RecoveryEpisode: this.h264RecoveryEpisode,
      h264RecoveryReason: this.h264RecoveryReason,
    };
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
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;
    this.visCtx = null;
    this.queue.length = 0;
    this.queueBytes = 0;
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
      const pendingFrames = queue.splice(0);
      this.queueBytes = 0;
      for (const buf of pendingFrames) this.bufferPreAttachFrame(buf);
      if (this.diagRenderCount < 3) {
        console.warn(
          `[RDP pipeline] renderFrames: not attached yet, buffering ${pendingFrames.length} frames (total=${this.preAttachBuffer.length}, ${(this.preAttachBytes / 1024).toFixed(0)} KB)`,
        );
      }
      return;
    }

    if (this.diagRenderCount++ < 5) {
      console.log(
        `[RDP pipeline] renderFrames #${this.diagRenderCount}: ${queue.length} buffers, renderer=${renderer.name}`,
      );
    }

    const frameBatchSize = queue.length;
    const renderStartMs = performance.now();

    if (renderer) {
      // ── WebCodecs fast path: forward raw buffers directly to the worker ──
      const isWebCodecs =
        renderer.type === "webcodecs-worker" ||
        renderer.type === "webcodecs-cpu";
      const pushRaw = isWebCodecs
        ? (
            renderer as unknown as { pushRawBuffer(data: ArrayBuffer): void }
          ).pushRawBuffer.bind(renderer)
        : null;

      if (isWebCodecs && pushRaw) {
        for (let i = 0; i < queue.length; i++) {
          pushRaw(queue[i]);
        }
      } else {
        // ── Standard RGBA dirty-rect rendering path ──
        const needsOffscreen = this.magnifierActive;
        const offCtx = needsOffscreen ? fb.offscreen.getContext("2d") : null;

        for (let i = 0; i < queue.length; i++) {
          const data = queue[i];

          // Check if this is a NAL payload (shouldn't happen on non-WebCodecs
          // renderers, but skip gracefully if the backend sends one)
          if (isNalPayload(data)) continue;

          // Normalize: data may be a typed array from Tauri channel
          const buf =
            data instanceof ArrayBuffer ? data : ((data as any).buffer ?? data);
          const baseOff =
            data instanceof ArrayBuffer ? 0 : ((data as any).byteOffset ?? 0);
          const byteLen =
            data instanceof ArrayBuffer
              ? data.byteLength
              : ((data as any).byteLength ?? 0);
          const view = new DataView(buf, baseOff, byteLen);
          let offset = 0;
          while (offset + 8 <= byteLen) {
            const x = view.getUint16(offset, true);
            const y = view.getUint16(offset + 2, true);
            const w = view.getUint16(offset + 4, true);
            const h = view.getUint16(offset + 6, true);
            const pixelBytes = w * h * 4;
            if (offset + 8 + pixelBytes > byteLen) break;
            const rgba = new Uint8ClampedArray(
              buf,
              baseOff + offset + 8,
              pixelBytes,
            );
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
      }
    } else {
      // Canvas 2D fallback (no pluggable renderer)
      if (!this.visCtx) this.visCtx = canvas.getContext("2d");
      const ctx = this.visCtx;
      if (ctx) {
        for (let i = 0; i < queue.length; i++) {
          const data = queue[i];
          const _buf =
            data instanceof ArrayBuffer ? data : ((data as any).buffer ?? data);
          const _off =
            data instanceof ArrayBuffer ? 0 : ((data as any).byteOffset ?? 0);
          const _len =
            data instanceof ArrayBuffer
              ? data.byteLength
              : ((data as any).byteLength ?? 0);
          const view = new DataView(_buf, _off, _len);
          let offset = 0;
          while (offset + 8 <= _len) {
            const x = view.getUint16(offset, true);
            const y = view.getUint16(offset + 2, true);
            const w = view.getUint16(offset + 4, true);
            const h = view.getUint16(offset + 6, true);
            const pixelBytes = w * h * 4;
            if (offset + 8 + pixelBytes > _len) break;
            const rgba = new Uint8ClampedArray(
              _buf,
              _off + offset + 8,
              pixelBytes,
            );
            fb.paintDirect(ctx, x, y, w, h, rgba);
            offset += 8 + pixelBytes;
          }
        }
      }
    }

    const renderEndMs = performance.now();
    this.recordRenderDuration(renderEndMs - renderStartMs);
    this.presentedFrameCount += frameBatchSize;
    this.lastFramePresentedAtMs = renderEndMs;

    queue.length = 0;
    this.queueBytes = 0;

    // In low-latency mode, if new frames arrived while we were rendering,
    // schedule another tick immediately instead of waiting for the next
    // onFrame call.  This keeps the pipeline drained.
    if (this.queue.length > 0 && !this.pending) {
      this.scheduleRender();
    }
  }

  private getQueuedBytes(): number {
    return this.queueBytes;
  }

  private recordRenderDuration(durationMs: number): void {
    const safeDurationMs = Math.max(0, durationMs);
    this.lastFrameRenderMs = safeDurationMs;
    this.renderSampleCount++;
    this.averageFrameRenderMs +=
      (safeDurationMs - this.averageFrameRenderMs) / this.renderSampleCount;
    this.renderSamplesMs.push(safeDurationMs);
    if (this.renderSamplesMs.length > RdpFramePipeline.MAX_RENDER_SAMPLES) {
      this.renderSamplesMs.shift();
    }
  }

  private getRenderPercentile(percentile: number): number | undefined {
    if (this.renderSamplesMs.length === 0) return undefined;
    const sortedSamples = [...this.renderSamplesMs].sort(
      (left, right) => left - right,
    );
    const percentileIndex = Math.min(
      sortedSamples.length - 1,
      Math.max(0, Math.ceil((percentile / 100) * sortedSamples.length) - 1),
    );
    return sortedSamples[percentileIndex];
  }
}
