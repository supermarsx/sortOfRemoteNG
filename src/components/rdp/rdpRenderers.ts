/**
 * RDP Frame Renderers
 *
 * Pluggable GPU/CPU rendering backends for painting dirty-region RGBA frames
 * onto a visible `<canvas>`.  Each renderer targets a different browser API:
 *
 * | Renderer             | API              | Upload              | Scaling    | Thread |
 * |----------------------|------------------|---------------------|------------|--------|
 * | `Canvas2DRenderer`   | Canvas 2D        | `putImageData`      | CPU        | main   |
 * | `WebGLRenderer`      | WebGL 2 / 1      | `texSubImage2D`     | GPU        | main   |
 * | `WebGPURenderer`     | WebGPU           | `writeTexture`      | GPU        | main   |
 * | `OffscreenWorkerRenderer` | OffscreenCanvas  | any (in Worker) | varies     | worker |
 *
 * Usage
 * -----
 * ```ts
 * const renderer = createFrameRenderer('webgl', canvas);
 * // ... per frame:
 * renderer.paintRegion(x, y, w, h, rgbaBytes);
 * // ... on desktop resize:
 * renderer.resize(newW, newH);
 * // ... on cleanup:
 * renderer.destroy();
 * ```
 */

import type {
  RdpH264RecoveryReason,
  RdpH264RecoveryState,
} from "../../types/rdp/rdpEvents";

// ─── ArrayBuffer normalization ─────────────────────────────────────────────
// Tauri channels may deliver typed arrays (Uint8Array) instead of raw ArrayBuffer.
// This helper normalizes to a DataView regardless of input type.

function toDataView(data: ArrayBuffer | ArrayBufferView): DataView {
  if (data instanceof ArrayBuffer) return new DataView(data);
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function toByteLength(data: ArrayBuffer | ArrayBufferView): number {
  return data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
}

function toUint8Array(
  data: ArrayBuffer | ArrayBufferView,
  offset = 0,
  length = toByteLength(data) - offset,
): Uint8Array {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const base = (data instanceof ArrayBuffer ? 0 : data.byteOffset) + offset;
  return new Uint8Array(buffer, base, length);
}

// ─── Public Types ──────────────────────────────────────────────────────────

/** Identifiers for the available frontend renderers. */
export type FrontendRendererType =
  | "auto"
  | "canvas2d"
  | "webgl"
  | "webgpu"
  | "offscreen-worker"
  | "webcodecs-worker"
  | "webcodecs-cpu";

/** Feature-test results exposed for UI / diagnostics. */
export interface RendererCapabilities {
  canvas2d: boolean;
  webgl: boolean;
  webgpu: boolean;
  offscreenWorker: boolean;
  webcodecs: boolean;
}

/** Common interface that all renderers implement. */
export interface FrameRenderer {
  /** Human-readable name of the active backend (for UI / logging). */
  readonly name: string;
  /** The resolved renderer type identifier. */
  readonly type: FrontendRendererType;
  /** Whether this renderer uses triple buffering (for diagnostics). */
  readonly tripleBuffered: boolean;
  /** Paint a dirty rectangle of RGBA data onto the canvas. */
  paintRegion(
    x: number,
    y: number,
    width: number,
    height: number,
    rgba: Uint8ClampedArray,
  ): void;
  /** Resize the render surface (e.g. when the remote desktop changes resolution). */
  resize(width: number, height: number): void;
  /**
   * Flush all queued paints to the display.
   * For Canvas 2D this is a no-op (putImageData is immediate), but WebGL /
   * WebGPU / Worker renderers need an explicit present step after the
   * paint-region loop so they can issue a single draw-call per vsync.
   */
  present(): void;
  /** Reset any stateful H.264 decoder after transport discontinuity. */
  resetH264Recovery?(reason: RdpH264RecoveryReason): void;
  /** Release all GPU / worker resources. */
  destroy(): void;
}

/** Options for renderer creation. */
export interface RendererOptions {
  tripleBuffering?: boolean;
  onH264RecoveryStateChange?: (
    state: RdpH264RecoveryState,
    reason?: RdpH264RecoveryReason,
  ) => void;
}

export type AnnexBNalKind = "sps" | "pps" | "idr" | "delta" | "other";

export interface AnnexBNalUnit {
  type: number;
  kind: AnnexBNalKind;
  /** The complete Annex-B NAL, including its three- or four-byte start code. */
  data: Uint8Array;
}

export interface AnnexBAccessUnit {
  valid: boolean;
  malformedReason?: string;
  nalUnits: AnnexBNalUnit[];
  hasSps: boolean;
  hasPps: boolean;
  hasIdr: boolean;
  hasDelta: boolean;
}

interface AnnexBStartCode {
  index: number;
  length: 3 | 4;
}

function findAnnexBStartCode(
  bytes: Uint8Array,
  from: number,
): AnnexBStartCode | null {
  for (let index = Math.max(0, from); index + 2 < bytes.length; index += 1) {
    if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue;
    if (
      index + 3 < bytes.length &&
      bytes[index + 2] === 0 &&
      bytes[index + 3] === 1
    ) {
      return { index, length: 4 };
    }
    if (bytes[index + 2] === 1) return { index, length: 3 };
  }
  return null;
}

function invalidAnnexB(reason: string): AnnexBAccessUnit {
  return {
    valid: false,
    malformedReason: reason,
    nalUnits: [],
    hasSps: false,
    hasPps: false,
    hasIdr: false,
    hasDelta: false,
  };
}

/** Parse one bounded Annex-B access unit without copying its NAL payloads. */
export function parseAnnexBAccessUnit(
  data: ArrayBuffer | ArrayBufferView,
): AnnexBAccessUnit {
  const bytes = toUint8Array(data);
  const first = findAnnexBStartCode(bytes, 0);
  if (!first) return invalidAnnexB("missing Annex-B start code");
  for (let index = 0; index < first.index; index += 1) {
    if (bytes[index] !== 0) {
      return invalidAnnexB("non-zero data before first Annex-B start code");
    }
  }

  const nalUnits: AnnexBNalUnit[] = [];
  let start: AnnexBStartCode | null = first;
  while (start) {
    const payloadStart = start.index + start.length;
    const next = findAnnexBStartCode(bytes, payloadStart);
    const end = next?.index ?? bytes.length;
    if (payloadStart >= end) return invalidAnnexB("empty Annex-B NAL unit");

    const header = bytes[payloadStart];
    const type = header & 0x1f;
    if ((header & 0x80) !== 0 || type === 0 || type > 23) {
      return invalidAnnexB("invalid H.264 NAL header");
    }

    const kind: AnnexBNalKind =
      type === 7
        ? "sps"
        : type === 8
          ? "pps"
          : type === 5
            ? "idr"
            : type >= 1 && type <= 4
              ? "delta"
              : "other";
    nalUnits.push({ type, kind, data: bytes.subarray(start.index, end) });
    start = next;
  }

  if (nalUnits.length === 0) return invalidAnnexB("empty Annex-B access unit");
  return {
    valid: true,
    nalUnits,
    hasSps: nalUnits.some((unit) => unit.kind === "sps"),
    hasPps: nalUnits.some((unit) => unit.kind === "pps"),
    hasIdr: nalUnits.some((unit) => unit.kind === "idr"),
    hasDelta: nalUnits.some((unit) => unit.kind === "delta"),
  };
}

// ─── Feature Detection ─────────────────────────────────────────────────────

let _caps: RendererCapabilities | null = null;

/** Probe which renderers the current browser supports. */
export function detectCapabilities(): RendererCapabilities {
  if (_caps) return _caps;

  const createProbe = (): HTMLCanvasElement => {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    return probe;
  };

  // A canvas is permanently bound to its first context mode. Probing 2D and
  // WebGL on the same element therefore produces a false negative for WebGL
  // in conforming browsers.
  const canvas2d = !!createProbe().getContext("2d");
  const webgl2 = !!createProbe().getContext("webgl2");
  const webgl = webgl2 || !!createProbe().getContext("webgl");

  _caps = {
    canvas2d,
    webgl,
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    offscreenWorker:
      typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined",
    webcodecs:
      typeof OffscreenCanvas !== "undefined" &&
      typeof Worker !== "undefined" &&
      typeof VideoDecoder !== "undefined",
  };
  return _caps;
}

// ═════════════════════════════════════════════════════════════════════════════
// Canvas 2D Renderer  —  putImageData (baseline, always works)
// ═════════════════════════════════════════════════════════════════════════════

class Canvas2DRenderer implements FrameRenderer {
  readonly name = "Canvas 2D";
  readonly type: FrontendRendererType = "canvas2d";
  readonly tripleBuffered = false;
  private visCtx: CanvasRenderingContext2D;
  /** Off-screen back-buffer (null when OffscreenCanvas is unavailable). */
  private backBuffer: OffscreenCanvas | null = null;
  private backCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** Cached ImageData to avoid per-frame allocation. Reused when (w,h) matches. */
  private cachedImg: ImageData | null = null;
  private cachedW = 0;
  private cachedH = 0;
  private dirty = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { desynchronized: false });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.visCtx = ctx;

    // Double-buffer: paint dirty regions to an OffscreenCanvas, then blit
    // to the visible canvas in present() via a single drawImage() call.
    // This prevents the compositor from snapshotting the canvas mid-paint
    // during large putImageData writes (which causes scanline artifacts).
    // Falls back to direct putImageData when OffscreenCanvas is unavailable
    // (e.g. test environments).
    if (typeof OffscreenCanvas !== "undefined") {
      try {
        this.backBuffer = new OffscreenCanvas(
          canvas.width || 1920,
          canvas.height || 1080,
        );
        this.backCtx = this.backBuffer.getContext("2d") ?? null;
      } catch {
        // OffscreenCanvas may exist but fail in some environments.
      }
    }
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    // Reuse cached ImageData when dimensions match (avoids allocation per frame).
    if (!this.cachedImg || this.cachedW !== w || this.cachedH !== h) {
      this.cachedImg = new ImageData(w, h);
      this.cachedW = w;
      this.cachedH = h;
    }
    this.cachedImg.data.set(rgba.subarray(0, w * h * 4));
    if (this.backCtx) {
      // Write to the back-buffer — not the visible canvas.
      this.backCtx.putImageData(this.cachedImg, x, y);
    } else {
      // No back-buffer: write directly (no double-buffering).
      this.visCtx.putImageData(this.cachedImg, x, y);
    }
    this.dirty = true;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    // Re-acquire visible context after resize.
    const ctx = this.canvas.getContext("2d", { desynchronized: false });
    if (ctx) this.visCtx = ctx;

    if (this.backBuffer && this.backCtx) {
      // Capture current back-buffer content before resizing.
      const oldW = this.backBuffer.width;
      const oldH = this.backBuffer.height;
      if (width === oldW && height === oldH) return;

      const tmp = new OffscreenCanvas(oldW, oldH);
      const tmpCtx = tmp.getContext("2d");
      if (tmpCtx && this.dirty) {
        tmpCtx.drawImage(this.backBuffer, 0, 0);
      }
      this.backBuffer.width = width;
      this.backBuffer.height = height;
      // Re-acquire back-buffer context (resize invalidates it).
      const bCtx = this.backBuffer.getContext("2d");
      if (bCtx) {
        this.backCtx = bCtx;
        if (tmpCtx && this.dirty) {
          this.backCtx.drawImage(tmp, 0, 0, oldW, oldH, 0, 0, width, height);
        }
      }
    }
  }

  present(): void {
    if (!this.dirty) return;
    if (this.backBuffer) {
      // Single, atomic blit from back-buffer to visible canvas.
      // drawImage is composited as one operation by the browser, so the
      // compositor never sees a partially-written frame.
      this.visCtx.drawImage(this.backBuffer, 0, 0);
    }
    this.dirty = false;
  }

  destroy(): void {
    /* nothing to release */
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WebGL Renderer  —  texSubImage2D (GPU texture upload + fullscreen quad)
// ═════════════════════════════════════════════════════════════════════════════

const GL_VERT = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;          // flip Y for canvas coordinates
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const GL_FRAG = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  void main() {
    gl_FragColor = texture2D(u_tex, v_uv);
  }
`;

class WebGLRenderer implements FrameRenderer {
  readonly name: string;
  readonly type: FrontendRendererType = "webgl";
  readonly tripleBuffered: boolean;
  private static readonly INIT_TIMEOUT_MS = 2000;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private program: WebGLProgram;
  private dirty = false;

  // ── Single-buffer mode ──
  private tex: WebGLTexture;
  private texW = 0;
  private texH = 0;

  // ── Triple-buffer (ping-pong) mode ──
  private texPair: [WebGLTexture, WebGLTexture] | null = null;
  private fboPair: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private writeIdx = 0; // index into texPair: which texture receives uploads
  private isWebGL2 = false;

  constructor(
    private canvas: HTMLCanvasElement,
    opts?: RendererOptions,
  ) {
    // preserveDrawingBuffer MUST be true for dirty-rect rendering: we only
    // update changed regions via texSubImage2D, so the browser must not clear
    // unchanged areas between compositing frames.
    //
    // desynchronized MUST be false: dirty-rect rendering paints multiple
    // sub-regions per frame via texSubImage2D before a single present().
    // With desynchronized=true, the browser can display the canvas mid-paint,
    // showing a mix of old and new regions — classic ghosting artifacts.
    const gl2 = canvas.getContext("webgl2", {
      desynchronized: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    const gl =
      gl2 ??
      (canvas.getContext("webgl", {
        antialias: false,
        desynchronized: false,
        preserveDrawingBuffer: true,
      }) as WebGLRenderingContext | null);
    if (!gl) throw new Error("WebGL context unavailable");
    this.gl = gl;
    this.isWebGL2 = !!gl2;

    // ── Compile shader program ──
    const vs = this.compileShader(gl.VERTEX_SHADER, GL_VERT);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, GL_FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("WebGL program link: " + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    gl.useProgram(prog);

    // ── Fullscreen quad (-1…1) ──
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // ── Determine triple-buffer eligibility ──
    const wantTriple = opts?.tripleBuffering ?? false;
    this.tripleBuffered = wantTriple && this.isWebGL2;

    if (this.tripleBuffered) {
      // Create two textures + two FBOs for ping-pong
      const tA = this.createTex(gl);
      const tB = this.createTex(gl);
      this.texPair = [tA, tB];
      this.fboPair = [this.createFbo(gl, tA), this.createFbo(gl, tB)];
      this.tex = tA; // alias for alloc helper
      this.name = "WebGL (triple-buffered)";
    } else {
      this.tex = this.createTex(gl);
      this.name = "WebGL";
    }

    // Allocate at current canvas size
    const w = canvas.width || 1920;
    const h = canvas.height || 1080;
    this.allocTextures(w, h);
  }

  // ── Helpers ──

  private createTex(gl: WebGLRenderingContext): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private createFbo(
    gl: WebGLRenderingContext,
    tex: WebGLTexture,
  ): WebGLFramebuffer {
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("Shader compile: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  private allocTextures(w: number, h: number): void {
    if (w === this.texW && h === this.texH) return;
    const gl = this.gl;
    if (this.tripleBuffered && this.texPair) {
      for (const t of this.texPair) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          w,
          h,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
      }
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    this.texW = w;
    this.texH = h;
  }

  // ── FrameRenderer interface ──

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    const gl = this.gl;

    if (this.tripleBuffered && this.texPair) {
      // Upload to the WRITE texture only — the display texture is untouched,
      // so the GPU can present it without stalling on our upload.
      gl.bindTexture(gl.TEXTURE_2D, this.texPair[this.writeIdx]);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      w,
      h,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );
    this.dirty = true;
  }

  present(): void {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.tripleBuffered && this.texPair && this.fboPair) {
      const gl2 = gl as WebGL2RenderingContext;

      // 1. Draw the WRITE texture (has latest dirty rects) to the canvas
      gl.bindTexture(gl.TEXTURE_2D, this.texPair[this.writeIdx]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 2. Swap: the current write becomes the display, the old display
      //    becomes the new write target.
      const prevWrite = this.writeIdx;
      this.writeIdx = 1 - this.writeIdx;

      // 3. Blit prevWrite → newWrite so the new write texture starts with
      //    the full current desktop state (needed for incremental dirty rects).
      //    This is a pure GPU-to-GPU copy — no CPU involvement.
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, this.fboPair[prevWrite]);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, this.fboPair[this.writeIdx]);
      gl2.blitFramebuffer(
        0,
        0,
        this.texW,
        this.texH,
        0,
        0,
        this.texW,
        this.texH,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      gl2.bindFramebuffer(gl2.READ_FRAMEBUFFER, null);
      gl2.bindFramebuffer(gl2.DRAW_FRAMEBUFFER, null);

      // Ensure the blit completes before the next paintRegion() uploads to
      // writeIdx.  Without this, the GPU may still be reading from the blit
      // source while the CPU uploads dirty rects to the same texture, causing
      // ghosting/trails from mixed old+new pixel data.
      gl.flush();
    } else {
      // Single-buffer: draw directly
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.dirty = false;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.allocTextures(width, height);
  }

  destroy(): void {
    const gl = this.gl;
    if (this.tripleBuffered && this.texPair && this.fboPair) {
      gl.deleteTexture(this.texPair[0]);
      gl.deleteTexture(this.texPair[1]);
      gl.deleteFramebuffer(this.fboPair[0]);
      gl.deleteFramebuffer(this.fboPair[1]);
    } else {
      gl.deleteTexture(this.tex);
    }
    gl.deleteProgram(this.program);
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WebGPU Renderer  —  writeTexture → render pass (latest browser API)
// ═════════════════════════════════════════════════════════════════════════════

const WGPU_VERT = /* wgsl */ `
  struct Out {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
  };
  @vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
    var p = array<vec2f, 4>(
      vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1)
    );
    var out: Out;
    out.pos = vec4f(p[i], 0, 1);
    let uv = p[i] * 0.5 + 0.5;
    out.uv = vec2f(uv.x, 1.0 - uv.y);
    return out;
  }
`;

const WGPU_FRAG = /* wgsl */ `
  @group(0) @binding(0) var s: sampler;
  @group(0) @binding(1) var t: texture_2d<f32>;
  @fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(t, s, uv);
  }
`;

const WEBGPU_INIT_TIMEOUT_MS = 2000;
const WEBGPU_MAX_PENDING_PAINTS = 4;
const WEBGPU_MAX_PENDING_PAINT_BYTES = 16 * 1024 * 1024;

class WebGPURenderer implements FrameRenderer {
  readonly name = "WebGPU";
  readonly type: FrontendRendererType = "webgpu";
  readonly tripleBuffered = false; // WebGPU manages its own swap chain
  private device: GPUDevice | null = null;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private tex: GPUTexture | null = null;
  private bindGroup!: GPUBindGroup;
  private diagPaintCount = 0;
  private diagPresentCount = 0;
  private bindGroupLayout!: GPUBindGroupLayout;
  private texW = 0;
  private texH = 0;
  private dirty = false;
  private ready = false;
  private initFailed = false;
  private initCancelled = false;
  // Fallback renderer used when async init fails
  private fallback: Canvas2DRenderer | null = null;
  // Paints copied while async initialization is pending. A hung adapter must
  // never turn this into an unbounded full-frame retention queue.
  private pendingPaints: {
    x: number;
    y: number;
    w: number;
    h: number;
    rgba: Uint8Array;
  }[] = [];
  private pendingPaintBytes = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const timeoutHandle = window.setTimeout(() => {
      this.initCancelled = true;
      this.activateFallback(
        new Error(`WebGPU init timed out after ${WEBGPU_INIT_TIMEOUT_MS}ms`),
        "timeout",
      );
    }, WEBGPU_INIT_TIMEOUT_MS);

    this.initAsync()
      .then(() => {
        window.clearTimeout(timeoutHandle);
      })
      .catch((e) => {
        window.clearTimeout(timeoutHandle);
        this.activateFallback(e, "error");
      });
  }

  private releaseGpuResources(): void {
    const texture = this.tex;
    this.tex = null;
    if (texture) {
      try {
        texture.destroy();
      } catch {
        // The device may already have invalidated its resources.
      }
    }

    const device = this.device;
    this.device = null;
    if (device) {
      try {
        device.destroy();
      } catch {
        // Destruction is best-effort and must remain idempotent.
      }
    }
    this.ready = false;
    this.dirty = false;
  }

  private activateFallback(
    error: unknown,
    reason: "timeout" | "error" | "queue-overflow",
  ): Canvas2DRenderer | null {
    if (this.initFailed) return this.fallback;

    console.error("WebGPU init failed, falling back to Canvas2D:", error);
    this.initFailed = true;
    this.initCancelled = true;
    const pendingPaints = this.pendingPaints;
    this.pendingPaints = [];
    this.pendingPaintBytes = 0;
    try {
      // Unconfigure WebGPU context if it was acquired, so Canvas2D can work
      if (this.ctx) {
        try {
          this.ctx.unconfigure();
        } catch {
          /* ignore */
        }
      }
      this.releaseGpuResources();
      // Force a fresh context by resetting canvas dimensions
      const w = this.canvas.width;
      const h = this.canvas.height;
      this.canvas.width = 0;
      this.canvas.width = w;
      this.canvas.height = h;
      this.fallback = new Canvas2DRenderer(this.canvas);
      for (const p of pendingPaints) {
        this.fallback.paintRegion(
          p.x,
          p.y,
          p.w,
          p.h,
          new Uint8ClampedArray(
            p.rgba.buffer,
            p.rgba.byteOffset,
            p.rgba.byteLength,
          ),
        );
      }
      this.fallback.present();
      window.dispatchEvent(
        new CustomEvent("rdp:webgpu-fallback", {
          detail: {
            reason,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    } catch (e2) {
      console.error("Canvas2D fallback also failed:", e2);
    }
    return this.fallback;
  }

  private async initAsync(): Promise<void> {
    if (!navigator.gpu) throw new Error("WebGPU: navigator.gpu not available");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU: no adapter");
    if (this.initCancelled) return;
    const device = await adapter.requestDevice();
    if (this.initCancelled) {
      device.destroy();
      return;
    }
    this.device = device;

    const ctx = this.canvas.getContext("webgpu");
    if (!ctx) {
      throw new Error(
        'WebGPU: getContext("webgpu") returned null — the canvas may already ' +
          'have a different context type (e.g. "2d" or "webgl").',
      );
    }
    this.ctx = ctx as GPUCanvasContext;
    if (this.initCancelled) return;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    // Shader module
    const shaderModule = device.createShaderModule({
      code: WGPU_VERT + "\n" + WGPU_FRAG,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: shaderModule, entryPoint: "vs" },
      fragment: {
        module: shaderModule,
        entryPoint: "fs",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-strip" },
    });

    this.sampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "linear",
    });

    this.allocTexture(this.canvas.width || 1920, this.canvas.height || 1080);
    if (this.initCancelled) return;
    this.ready = true;
    console.log(
      `[WebGPU] initAsync OK: tex=${this.texW}x${this.texH}, canvas=${this.canvas.width}x${this.canvas.height}, pending=${this.pendingPaints.length}, format=${format}`,
    );

    // Flush any queued paints and present immediately. Clear the retained-work
    // counters first so re-entrant paints cannot observe stale capacity.
    const pendingPaints = this.pendingPaints;
    this.pendingPaints = [];
    this.pendingPaintBytes = 0;
    for (const p of pendingPaints) {
      this.paintRegion(
        p.x,
        p.y,
        p.w,
        p.h,
        new Uint8ClampedArray(
          p.rgba.buffer,
          p.rgba.byteOffset,
          p.rgba.byteLength,
        ),
      );
    }
    const hadPending = pendingPaints.length;
    if (hadPending > 0) {
      this.present();
      console.log(
        `[WebGPU] flushed ${hadPending} pending paints, dirty=${this.dirty}`,
      );
    }
  }

  private allocTexture(w: number, h: number): void {
    if (w === this.texW && h === this.texH) return;
    const device = this.device;
    if (!device) throw new Error("WebGPU device unavailable");
    if (this.tex) this.tex.destroy();
    const texture = device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.tex = texture;
    this.texW = w;
    this.texH = h;

    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: texture.createView() },
      ],
    });
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    if (this.fallback) {
      this.fallback.paintRegion(x, y, w, h, rgba);
      return;
    }
    if (!this.ready) {
      const exceedsPendingBounds =
        this.pendingPaints.length >= WEBGPU_MAX_PENDING_PAINTS ||
        rgba.byteLength > WEBGPU_MAX_PENDING_PAINT_BYTES ||
        this.pendingPaintBytes + rgba.byteLength >
          WEBGPU_MAX_PENDING_PAINT_BYTES;
      if (exceedsPendingBounds) {
        const fallback = this.activateFallback(
          new Error(
            `WebGPU pre-init paint queue exceeded ${WEBGPU_MAX_PENDING_PAINTS} paints or ${WEBGPU_MAX_PENDING_PAINT_BYTES} bytes`,
          ),
          "queue-overflow",
        );
        fallback?.paintRegion(x, y, w, h, rgba);
        return;
      }

      // Copy because the source may be a view into a reused channel buffer.
      const copy = new Uint8Array(rgba);
      this.pendingPaints.push({ x, y, w, h, rgba: copy });
      this.pendingPaintBytes += copy.byteLength;
      return;
    }
    // writeTexture needs the data as a contiguous buffer.  The incoming rgba
    // is often a Uint8ClampedArray *view* with a non-zero byteOffset into a
    // larger ArrayBuffer.  Some WebGPU implementations don't correctly handle
    // the view's byteOffset, so we ensure a zero-offset buffer.
    const data: Uint8Array =
      rgba.byteOffset === 0
        ? new Uint8Array(rgba.buffer, 0, rgba.byteLength)
        : new Uint8Array(rgba);
    if (this.diagPaintCount++ < 5) {
      // Sample first 16 bytes to verify non-zero pixel data
      const sample = Array.from(data.subarray(0, Math.min(16, data.length)));
      console.log(
        `[WebGPU] paintRegion #${this.diagPaintCount}: (${x},${y}) ${w}x${h}, ${data.length} bytes, offset=${rgba.byteOffset}, texSize=${this.texW}x${this.texH}, sample=${sample.join(",")}`,
      );
    }
    const device = this.device;
    const texture = this.tex;
    if (!device || !texture) {
      this.activateFallback(
        new Error("WebGPU resources disappeared before paint"),
        "error",
      )?.paintRegion(x, y, w, h, rgba);
      return;
    }
    device.queue.writeTexture(
      { texture, origin: [x, y] },
      data,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h],
    );
    this.dirty = true;
  }

  present(): void {
    if (this.fallback) {
      this.fallback.present();
      return;
    }
    if (!this.dirty || !this.ready) return;
    const device = this.device;
    if (!device) return;
    if (this.diagPresentCount++ < 5) {
      console.log(
        `[WebGPU] present #${this.diagPresentCount}: canvas=${this.canvas.width}x${this.canvas.height}, tex=${this.texW}x${this.texH}`,
      );
    }
    try {
      const target = this.ctx.getCurrentTexture().createView();
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(4);
      pass.end();
      device.queue.submit([enc.finish()]);
      this.dirty = false;
    } catch (e) {
      console.error("WebGPU present failed:", e);
    }
  }

  resize(width: number, height: number): void {
    if (this.fallback) {
      this.fallback.resize(width, height);
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.ready) {
      this.allocTexture(width, height);
    }
  }

  destroy(): void {
    this.initCancelled = true;
    this.initFailed = true;
    this.pendingPaints = [];
    this.pendingPaintBytes = 0;
    if (this.fallback) {
      this.fallback.destroy();
    }
    this.fallback = null;
    if (this.ctx) {
      try {
        this.ctx.unconfigure();
      } catch {
        // Context may already be unconfigured by fallback activation.
      }
    }
    this.releaseGpuResources();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// OffscreenCanvas + Worker Renderer  —  moves paint off main thread
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Creates a Worker from an inline function (no separate file needed).
 * The worker receives `ArrayBuffer` messages from the main thread,
 * decodes the 8-byte header, and paints via OffscreenCanvas 2D.
 */
function createPaintWorkerBlob(): Blob {
  const code = `
    let ctx = null;
    let w = 0, h = 0;

    function toDataView(data) {
      if (data instanceof ArrayBuffer) return new DataView(data);
      return new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    function toByteLength(data) {
      return data.byteLength;
    }

    function toUint8ClampedArray(data, offset, length) {
      const base = data instanceof ArrayBuffer ? 0 : data.byteOffset;
      return new Uint8ClampedArray(data instanceof ArrayBuffer ? data : data.buffer, base + offset, length);
    }

    self.onmessage = (e) => {
      const msg = e.data;

      // Init message: { type: 'init', canvas: OffscreenCanvas }
      if (msg.type === 'init') {
        const canvas = msg.canvas;
        w = canvas.width;
        h = canvas.height;
        ctx = canvas.getContext('2d', { desynchronized: false });
        return;
      }

      // Resize message: { type: 'resize', width, height }
      if (msg.type === 'resize') {
        w = msg.width;
        h = msg.height;
        // The OffscreenCanvas dimensions must be set from this thread
        if (ctx) {
          ctx.canvas.width = w;
          ctx.canvas.height = h;
        }
        return;
      }

      // Frame batch: { type: 'frames', batchId, buffers: ArrayBuffer[] }
      if (msg.type === 'frames') {
        const buffers = msg.buffers;
        let failed = !ctx;
        try {
          if (ctx) {
            for (let i = 0; i < buffers.length; i++) {
              const data = buffers[i];
              const dataLen = toByteLength(data);
              if (dataLen < 8) continue;
              const view = toDataView(data);
              const x = view.getUint16(0, true);
              const y = view.getUint16(2, true);
              const rw = view.getUint16(4, true);
              const rh = view.getUint16(6, true);
              if (rw <= 0 || rh <= 0) continue;
              const pixelBytes = rw * rh * 4;
              if (dataLen < 8 + pixelBytes) continue;
              const rgba = toUint8ClampedArray(data, 8, pixelBytes);
              const imgData = new ImageData(rgba, rw, rh);
              ctx.putImageData(imgData, x, y);
            }
          }
        } catch (error) {
          failed = true;
          console.error('[Offscreen paint worker] frame batch failed:', error);
        } finally {
          self.postMessage({ type: 'frames-consumed', batchId: msg.batchId, failed });
        }
      }
    };
  `;
  return new Blob([code], { type: "application/javascript" });
}

class OffscreenWorkerRenderer implements FrameRenderer {
  private static readonly MAX_PENDING_FRAMES = 256;
  private static readonly MAX_PENDING_BYTES = 16 * 1024 * 1024;
  private static readonly MAX_IN_FLIGHT_BATCHES = 4;
  private static readonly MAX_IN_FLIGHT_FRAMES =
    OffscreenWorkerRenderer.MAX_PENDING_FRAMES *
    OffscreenWorkerRenderer.MAX_IN_FLIGHT_BATCHES;
  private static readonly MAX_IN_FLIGHT_BYTES = 32 * 1024 * 1024;
  readonly name = "OffscreenCanvas Worker";
  readonly type: FrontendRendererType = "offscreen-worker";
  readonly tripleBuffered = false;
  private worker: Worker;
  private ready = false;
  private pendingFrames: ArrayBuffer[] = [];
  private pendingBytes = 0;
  private inFlightBatches = new Map<
    number,
    { frameCount: number; byteLength: number; recoveryEpoch?: number }
  >();
  private inFlightFrames = 0;
  private inFlightBytes = 0;
  private nextBatchId = 1;
  private recoveryPending = false;
  private recoveryEpoch = 0;
  private recoveryNextY = 0;
  private surfaceWidth: number;
  private surfaceHeight: number;
  private destroyed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private readonly options?: RendererOptions,
  ) {
    this.surfaceWidth = canvas.width;
    this.surfaceHeight = canvas.height;
    const offscreen = canvas.transferControlToOffscreen();
    const blob = createPaintWorkerBlob();
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    this.worker.onmessage = (event) => {
      if (this.destroyed || event.data?.type !== "frames-consumed") return;
      this.handleBatchConsumed(event.data.batchId, event.data.failed === true);
    };

    try {
      this.worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
      this.ready = true;
    } catch (error) {
      console.error("Offscreen worker initialization failed:", error);
      this.requestFullRefreshAfterLoss();
    }
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (this.destroyed || w <= 0 || h <= 0) return;
    const pixelBytes = w * h * 4;
    const byteLen = 8 + pixelBytes;
    if (
      !Number.isSafeInteger(pixelBytes) ||
      !Number.isSafeInteger(byteLen) ||
      byteLen > OffscreenWorkerRenderer.MAX_PENDING_BYTES
    ) {
      this.requestFullRefreshAfterLoss();
      return;
    }
    if (rgba.length < pixelBytes) return;

    // Check both count and bytes before allocating/copying the region. A busy
    // or hung worker therefore cannot turn native frame delivery into heap
    // growth on the main thread.
    if (
      this.pendingFrames.length >= OffscreenWorkerRenderer.MAX_PENDING_FRAMES ||
      this.pendingBytes + byteLen > OffscreenWorkerRenderer.MAX_PENDING_BYTES
    ) {
      this.requestFullRefreshAfterLoss();
      return;
    }
    // Build the same 8-byte header + RGBA format the Channel uses
    const buf = new ArrayBuffer(byteLen);
    const view = new DataView(buf);
    view.setUint16(0, x, true);
    view.setUint16(2, y, true);
    view.setUint16(4, w, true);
    view.setUint16(6, h, true);
    new Uint8ClampedArray(buf, 8).set(rgba.subarray(0, pixelBytes));
    this.pendingFrames.push(buf);
    this.pendingBytes += byteLen;
  }

  /** Flush all queued paints to the worker (called once per rAF). */
  present(): void {
    this.dispatchPendingBatch();
  }

  private dispatchPendingBatch(): void {
    if (
      this.destroyed ||
      this.pendingFrames.length === 0 ||
      !this.ready ||
      this.inFlightBatches.size >=
        OffscreenWorkerRenderer.MAX_IN_FLIGHT_BATCHES ||
      this.inFlightFrames + this.pendingFrames.length >
        OffscreenWorkerRenderer.MAX_IN_FLIGHT_FRAMES ||
      this.inFlightBytes + this.pendingBytes >
        OffscreenWorkerRenderer.MAX_IN_FLIGHT_BYTES
    ) {
      return;
    }

    const bufs = this.pendingFrames;
    const frameCount = bufs.length;
    const byteLength = this.pendingBytes;
    this.pendingFrames = [];
    this.pendingBytes = 0;
    const batchId = this.nextBatchId;
    this.nextBatchId += 1;
    const recoveryEpoch = this.trackRecoveryCoverage(bufs);
    this.inFlightBatches.set(batchId, {
      frameCount,
      byteLength,
      recoveryEpoch,
    });
    this.inFlightFrames += frameCount;
    this.inFlightBytes += byteLength;

    // Transfer ownership of the ArrayBuffers for zero-copy
    try {
      this.worker.postMessage({ type: "frames", batchId, buffers: bufs }, bufs);
    } catch (error) {
      this.inFlightBatches.delete(batchId);
      this.inFlightFrames = Math.max(0, this.inFlightFrames - frameCount);
      this.inFlightBytes = Math.max(0, this.inFlightBytes - byteLength);
      console.error("Offscreen worker frame transfer failed:", error);
      this.requestFullRefreshAfterLoss();
    }
  }

  private trackRecoveryCoverage(buffers: ArrayBuffer[]): number | undefined {
    if (!this.recoveryPending) return undefined;

    let completedEpoch: number | undefined;
    for (const buffer of buffers) {
      const coverage = fullWidthRgbaCoverage(
        buffer,
        this.surfaceWidth,
        this.surfaceHeight,
      );
      if (!coverage) {
        this.recoveryNextY = 0;
        continue;
      }
      if (coverage.startY === 0) this.recoveryNextY = 0;
      if (coverage.startY !== this.recoveryNextY) {
        this.recoveryNextY = 0;
        continue;
      }
      this.recoveryNextY = coverage.endY;
      if (coverage.endY === this.surfaceHeight) {
        this.recoveryNextY = 0;
        completedEpoch = this.recoveryEpoch;
      }
    }
    return completedEpoch;
  }

  private handleBatchConsumed(batchId: unknown, failed: boolean): void {
    if (!Number.isSafeInteger(batchId)) return;
    const batch = this.inFlightBatches.get(batchId as number);
    if (!batch) return;
    this.inFlightBatches.delete(batchId as number);
    this.inFlightFrames = Math.max(0, this.inFlightFrames - batch.frameCount);
    this.inFlightBytes = Math.max(0, this.inFlightBytes - batch.byteLength);

    if (failed) {
      this.requestFullRefreshAfterLoss();
    } else if (
      this.recoveryPending &&
      batch.recoveryEpoch !== undefined &&
      batch.recoveryEpoch === this.recoveryEpoch
    ) {
      this.recoveryPending = false;
      this.recoveryNextY = 0;
      this.options?.onH264RecoveryStateChange?.("healthy");
    }

    // A consumed batch opens bounded worker capacity. Progress any batch that
    // was retained while the worker was saturated without waiting for another
    // native frame or animation tick.
    this.dispatchPendingBatch();
  }

  private requestFullRefreshAfterLoss(
    reason: RdpH264RecoveryReason = "queue-overflow",
  ): void {
    this.recoveryEpoch += 1;
    this.recoveryNextY = 0;
    // Work retained before the loss cannot prove recovery: it predates the
    // update that was dropped (or the worker failure). In-flight batches are
    // invalidated by the epoch; pre-dispatch buffers must be discarded now.
    this.pendingFrames = [];
    this.pendingBytes = 0;
    if (this.recoveryPending) return;
    this.recoveryPending = true;
    this.options?.onH264RecoveryStateChange?.("awaitingRecovery", reason);
  }

  private postControlMessage(
    message: Record<string, unknown>,
    operation: string,
  ): boolean {
    try {
      this.worker.postMessage(message);
      return true;
    } catch (error) {
      console.error(`Offscreen worker ${operation} failed:`, error);
      this.requestFullRefreshAfterLoss();
      return false;
    }
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return;
    if (this.pendingFrames.length > 0) {
      this.pendingFrames = [];
      this.pendingBytes = 0;
    }
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.requestFullRefreshAfterLoss("resize");
    // OffscreenCanvas must be resized from the worker thread
    this.postControlMessage({ type: "resize", width, height }, "resize");
  }

  resetH264Recovery(reason: RdpH264RecoveryReason): void {
    if (this.destroyed) return;
    // Native delivery pressure is detected before the missing rectangle ever
    // reaches this renderer. Arm the same acknowledged full-snapshot coverage
    // used for local queue loss, while leaving the callback edge deduplicated
    // when the pipeline is already in this recovery episode.
    this.requestFullRefreshAfterLoss(reason);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ready = false;
    this.pendingFrames = [];
    this.pendingBytes = 0;
    this.inFlightBatches.clear();
    this.inFlightFrames = 0;
    this.inFlightBytes = 0;
    this.recoveryPending = false;
    this.recoveryNextY = 0;
    this.worker.onmessage = null;
    this.worker.terminate();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// WebCodecs Worker Renderer — H.264 GPU decode + WebGL2 present in a Worker
// ═════════════════════════════════════════════════════════════════════════════

/**
 * NAL magic prefix (little-endian u32 0x4E414C48 = "NALH").
 * The Rust backend prefixes H.264 NAL payloads with this magic so the
 * frontend can distinguish them from standard RGBA dirty-rect frames.
 */
const NAL_MAGIC = 0x4e414c48;

/** NAL header size: magic(4) + surface_id(2) + screen_x(2) + screen_y(2) + dest_w(2) + dest_h(2) + reserved(2) = 16 */
const NAL_HEADER_SIZE = 16;

/** Check if an ArrayBuffer starts with the NAL magic prefix. */
export function isNalPayload(data: ArrayBuffer | ArrayBufferView): boolean {
  if (toByteLength(data) < NAL_HEADER_SIZE) return false;
  return toDataView(data).getUint32(0, true) === NAL_MAGIC;
}

function fullWidthRgbaCoverage(
  data: ArrayBuffer,
  desktopWidth: number,
  desktopHeight: number,
): { startY: number; endY: number } | null {
  if (desktopWidth <= 0 || desktopHeight <= 0 || data.byteLength < 8) {
    return null;
  }
  const view = new DataView(data);
  let offset = 0;
  let startY: number | undefined;
  let endY = 0;
  while (offset + 8 <= data.byteLength) {
    const x = view.getUint16(offset, true);
    const y = view.getUint16(offset + 2, true);
    const width = view.getUint16(offset + 4, true);
    const height = view.getUint16(offset + 6, true);
    const pixelBytes = width * height * 4;
    if (
      x !== 0 ||
      width !== desktopWidth ||
      height === 0 ||
      y + height > desktopHeight ||
      offset + 8 + pixelBytes > data.byteLength ||
      (startY !== undefined && y !== endY)
    ) {
      return null;
    }
    startY ??= y;
    endY = y + height;
    offset += 8 + pixelBytes;
  }
  if (startY === undefined || offset !== data.byteLength) return null;
  return { startY, endY };
}

/** Parse NAL header fields from an ArrayBuffer. */
export function parseNalHeader(data: ArrayBuffer | ArrayBufferView): {
  surfaceId: number;
  screenX: number;
  screenY: number;
  destW: number;
  destH: number;
  nalData: Uint8Array;
} {
  const view = toDataView(data);
  return {
    surfaceId: view.getUint16(4, true),
    screenX: view.getUint16(6, true),
    screenY: view.getUint16(8, true),
    destW: view.getUint16(10, true),
    destH: view.getUint16(12, true),
    nalData: toUint8Array(data, NAL_HEADER_SIZE),
  };
}

/**
 * Create the inline Worker blob for WebCodecs H.264 decode + WebGL2 present.
 *
 * The worker owns:
 * - A VideoDecoder (WebCodecs) for hardware H.264 decode
 * - A WebGL2 context on an OffscreenCanvas for GPU presentation
 * - Fallback to Canvas2D for RGBA dirty-rect frames that arrive on the same channel
 */
function createWebCodecsWorkerBlob(
  hwAccel: "prefer-hardware" | "prefer-software" = "prefer-hardware",
): Blob {
  const code = `
    'use strict';

    // ── State ──────────────────────────────────────────────────────────
    let canvas = null;
    let gl = null;           // WebGL2RenderingContext
    let ctx2d = null;        // fallback Canvas2D (for RGBA rects when WebGL unavailable)
    let decoder = null;      // VideoDecoder
    let program = null;
    let texture = null;
    let vao = null;
    let w = 0, h = 0;
    let decoderConfigured = false;
    let decoderWidth = 0;
    let decoderHeight = 0;
    let nextInputTimestamp = 0;
    let acceptedTimestampFloor = 0;
    let awaitingRecovery = true;
    let recoveryKeyTimestamp = null;
    let recoveryNotified = false;
    let recoveryReason = null;
    let cachedSps = null;
    let cachedPps = null;
    const HW_ACCEL = '${hwAccel}';
    const NAL_MAGIC = 0x4E414C48;
    const NAL_HEADER_SIZE = 16;
    const MAX_DECODER_PENDING = 4;
    const MAX_PARAMETER_SET_BYTES = 256 * 1024;

    function toDataView(data) {
      if (data instanceof ArrayBuffer) return new DataView(data);
      return new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    function toByteLength(data) {
      return data.byteLength;
    }

    function toUint8Array(data, offset, length) {
      const base = data instanceof ArrayBuffer ? 0 : data.byteOffset;
      const dataLen = toByteLength(data);
      return new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, base + offset, length ?? dataLen - offset);
    }

    function toUint8ClampedArray(data, offset, length) {
      const base = data instanceof ArrayBuffer ? 0 : data.byteOffset;
      return new Uint8ClampedArray(data instanceof ArrayBuffer ? data : data.buffer, base + offset, length);
    }

    function findStartCode(bytes, from) {
      for (let index = Math.max(0, from); index + 2 < bytes.length; index++) {
        if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue;
        if (index + 3 < bytes.length && bytes[index + 2] === 0 && bytes[index + 3] === 1) {
          return { index, length: 4 };
        }
        if (bytes[index + 2] === 1) return { index, length: 3 };
      }
      return null;
    }

    function parseAccessUnit(bytes) {
      const first = findStartCode(bytes, 0);
      if (!first) return { valid: false, reason: 'missing-start-code', units: [] };
      for (let index = 0; index < first.index; index++) {
        if (bytes[index] !== 0) {
          return { valid: false, reason: 'leading-data', units: [] };
        }
      }

      const units = [];
      let start = first;
      while (start) {
        const payloadStart = start.index + start.length;
        const next = findStartCode(bytes, payloadStart);
        const end = next ? next.index : bytes.length;
        if (payloadStart >= end) {
          return { valid: false, reason: 'empty-nal', units: [] };
        }
        const header = bytes[payloadStart];
        const type = header & 0x1f;
        if ((header & 0x80) !== 0 || type === 0 || type > 23) {
          return { valid: false, reason: 'invalid-nal-header', units: [] };
        }
        units.push({
          type,
          data: bytes.subarray(start.index, end),
        });
        start = next;
      }

      return {
        valid: units.length > 0,
        units,
        hasSps: units.some((unit) => unit.type === 7),
        hasPps: units.some((unit) => unit.type === 8),
        hasIdr: units.some((unit) => unit.type === 5),
        hasDelta: units.some((unit) => unit.type >= 1 && unit.type <= 4),
      };
    }

    function concatenate(parts) {
      let total = 0;
      for (const part of parts) total += part.byteLength;
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.byteLength;
      }
      return combined;
    }

    // ── WebGL2 setup ───────────────────────────────────────────────────
    const VS = \`#version 300 es
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        v_uv.y = 1.0 - v_uv.y;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    \`;
    const FS = \`#version 300 es
      precision mediump float;
      in vec2 v_uv;
      uniform sampler2D u_tex;
      out vec4 fragColor;
      void main() {
        fragColor = texture(u_tex, v_uv);
      }
    \`;

    function initGL(offscreen) {
      gl = offscreen.getContext('webgl2', { alpha: false, desynchronized: false, antialias: false });
      if (!gl) return false;

      // Compile shaders
      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      }
      const vs = compile(gl.VERTEX_SHADER, VS);
      const fs = compile(gl.FRAGMENT_SHADER, FS);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.useProgram(program);

      // Fullscreen quad VAO
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      // Texture
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Allocate initial texture
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.viewport(0, 0, w, h);
      return true;
    }

    function presentGL() {
      if (!gl || !program) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ── VideoDecoder (WebCodecs) ───────────────────────────────────────
    function publishRecovery(state, reason) {
      self.postMessage({ type: 'h264-recovery', state, reason });
    }

    function clearParameterSets() {
      cachedSps = null;
      cachedPps = null;
    }

    function enterRecovery(reason, clearCache = true) {
      if (decoder && decoder.state !== 'closed') {
        try {
          decoder.reset();
        } catch (_) {
          // Decoder may already be unconfigured after an asynchronous error.
        }
      }
      decoderConfigured = false;
      decoderWidth = 0;
      decoderHeight = 0;
      acceptedTimestampFloor = nextInputTimestamp;
      awaitingRecovery = true;
      recoveryKeyTimestamp = null;
      if (clearCache) clearParameterSets();
      if (!recoveryNotified || recoveryReason !== reason) {
        recoveryNotified = true;
        recoveryReason = reason;
        publishRecovery('awaitingRecovery', reason);
      }
    }

    function initDecoder() {
      if (typeof VideoDecoder === 'undefined') {
        console.warn('[WebCodecs worker] VideoDecoder not available');
        return;
      }

      decoder = new VideoDecoder({
        output: (frame) => {
          const outputTimestamp = Number(frame.timestamp);
          if (
            !Number.isFinite(outputTimestamp) ||
            outputTimestamp < acceptedTimestampFloor
          ) {
            frame.close();
            return;
          }
          if (gl) {
            // Upload VideoFrame directly as WebGL texture (GPU→GPU, zero CPU copy)
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            presentGL();
          } else if (ctx2d) {
            ctx2d.drawImage(frame, 0, 0);
          }
          frame.close();
          if (
            recoveryKeyTimestamp !== null &&
            outputTimestamp === recoveryKeyTimestamp
          ) {
            recoveryKeyTimestamp = null;
            awaitingRecovery = false;
            recoveryNotified = false;
            recoveryReason = null;
            publishRecovery('healthy');
          }
        },
        error: (e) => {
          console.error('[WebCodecs worker] decode error:', e);
          enterRecovery('decoder-error');
        },
      });
      if (typeof decoder.addEventListener === 'function') {
        decoder.addEventListener('dequeue', () => {
          self.postMessage({
            type: 'h264-dequeue',
            pending: Number(decoder.decodeQueueSize) || 0,
          });
        });
      }
    }

    function configureDecoder(width, height) {
      if (!decoder || width <= 0 || height <= 0) return false;
      if (decoderConfigured && decoderWidth === width && decoderHeight === height) {
        return true;
      }
      if (decoderConfigured) {
        try {
          decoder.reset();
        } catch (_) {
          // Reconfiguration below is authoritative.
        }
      }
      decoder.configure({
        codec: 'avc1.42001f', // Baseline profile, level 3.1
        codedWidth: width,
        codedHeight: height,
        hardwareAcceleration: HW_ACCEL,
        optimizeForLatency: true,
      });
      decoderConfigured = true;
      decoderWidth = width;
      decoderHeight = height;
      console.log('[WebCodecs worker] decoder configured:', width, 'x', height);
      return true;
    }

    function cacheParameterSets(parsed) {
      let nextSps = cachedSps;
      let nextPps = cachedPps;
      for (const unit of parsed.units) {
        if (unit.type === 7) nextSps = new Uint8Array(unit.data);
        if (unit.type === 8) nextPps = new Uint8Array(unit.data);
      }
      const total = (nextSps ? nextSps.byteLength : 0) + (nextPps ? nextPps.byteLength : 0);
      if (total > MAX_PARAMETER_SET_BYTES) {
        enterRecovery('parameter-set-overflow');
        return false;
      }
      cachedSps = nextSps;
      cachedPps = nextPps;
      return true;
    }

    function submitChunk(type, data) {
      if (!decoder || !decoderConfigured) {
        enterRecovery(decoder ? 'missing-parameter-sets' : 'decoder-unavailable', false);
        return false;
      }
      const pending = Number(decoder.decodeQueueSize) || 0;
      if (pending >= MAX_DECODER_PENDING) {
        enterRecovery('decoder-overflow');
        return false;
      }

      const timestamp = nextInputTimestamp++;
      const completesRecovery = type === 'key' && awaitingRecovery;
      if (completesRecovery) recoveryKeyTimestamp = timestamp;
      const chunk = new EncodedVideoChunk({
        type,
        timestamp,
        data,
      });
      try {
        decoder.decode(chunk);
        return true;
      } catch (error) {
        console.error('[WebCodecs worker] decode submission failed:', error);
        enterRecovery('decoder-error');
        return false;
      }
    }

    function processNalPayload(data) {
      if (!decoder) {
        enterRecovery('decoder-unavailable');
        return;
      }
      if (toByteLength(data) <= NAL_HEADER_SIZE) {
        enterRecovery('malformed-access-unit');
        return;
      }

      const view = toDataView(data);
      const destW = view.getUint16(10, true);
      const destH = view.getUint16(12, true);
      const nalData = toUint8Array(data, NAL_HEADER_SIZE);
      const parsed = parseAccessUnit(nalData);
      if (!parsed.valid || (parsed.hasIdr && parsed.hasDelta)) {
        enterRecovery('malformed-access-unit');
        return;
      }
      if (
        decoderConfigured &&
        (decoderWidth !== destW || decoderHeight !== destH)
      ) {
        enterRecovery('resize');
      }
      if (!cacheParameterSets(parsed)) return;

      if (!parsed.hasIdr && !parsed.hasDelta) return;
      if (!configureDecoder(destW, destH)) {
        enterRecovery('malformed-access-unit');
        return;
      }

      if (parsed.hasIdr) {
        if (!cachedSps || !cachedPps) {
          enterRecovery('missing-parameter-sets', false);
          return;
        }
        const parts = [];
        if (!parsed.hasSps) parts.push(cachedSps);
        if (!parsed.hasPps) parts.push(cachedPps);
        parts.push(nalData);
        submitChunk('key', parts.length === 1 ? nalData : concatenate(parts));
        return;
      }

      if (awaitingRecovery) {
        if (!recoveryNotified || recoveryReason !== 'missing-keyframe') {
          recoveryNotified = true;
          recoveryReason = 'missing-keyframe';
          publishRecovery('awaitingRecovery', 'missing-keyframe');
        }
        return;
      }
      submitChunk('delta', nalData);
    }

    // ── RGBA dirty-rect fallback (for uncompressed/bitmap frames) ─────
    let rgbaImgCache = null;

    function paintRgbaRect(data) {
      const view = toDataView(data);
      const dataLen = toByteLength(data);
      let offset = 0;
      while (offset + 8 <= dataLen) {
        const x = view.getUint16(offset, true);
        const y = view.getUint16(offset + 2, true);
        const rw = view.getUint16(offset + 4, true);
        const rh = view.getUint16(offset + 6, true);
        const pixelBytes = rw * rh * 4;
        if (offset + 8 + pixelBytes > dataLen) break;
        const rgba = toUint8ClampedArray(data, offset + 8, pixelBytes);

        if (gl) {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
        } else if (ctx2d && rw > 0 && rh > 0) {
          if (!rgbaImgCache || rgbaImgCache.width !== rw || rgbaImgCache.height !== rh) {
            rgbaImgCache = new ImageData(rw, rh);
          }
          rgbaImgCache.data.set(rgba);
          ctx2d.putImageData(rgbaImgCache, x, y);
        }
        offset += 8 + pixelBytes;
      }
      if (gl) presentGL();
    }

    function processFrameBuffer(data) {
      if (toByteLength(data) < 4) return;
      const magic = toDataView(data).getUint32(0, true);
      if (magic === NAL_MAGIC) {
        processNalPayload(data);
      } else {
        // RGBA is an independent fallback path. It must never complete an
        // H.264 recovery episode.
        paintRgbaRect(data);
      }
    }

    function acknowledgeFrame(frameId) {
      if (!Number.isSafeInteger(frameId)) return;
      self.postMessage({ type: 'frame-consumed', frameId });
    }

    // ── Message handler ────────────────────────────────────────────────

    self.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === 'init') {
        canvas = msg.canvas;
        w = msg.width;
        h = msg.height;
        canvas.width = w;
        canvas.height = h;

        if (!initGL(canvas)) {
          console.warn('[WebCodecs worker] WebGL2 unavailable, falling back to Canvas2D');
          ctx2d = canvas.getContext('2d');
        }

        initDecoder();
        self.postMessage({ type: 'ready' });
        return;
      }

      if (msg.type === 'resize') {
        w = msg.width;
        h = msg.height;
        canvas.width = w;
        canvas.height = h;
        if (gl) {
          gl.viewport(0, 0, w, h);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        enterRecovery('resize');
        return;
      }

      if (msg.type === 'reset-h264') {
        const reason = msg.reason || 'renderer-reset';
        enterRecovery(reason);
        self.postMessage({ type: 'h264-reset-consumed', reason });
        return;
      }

      if (msg.type === 'frame') {
        try {
          processFrameBuffer(msg.data);
        } finally {
          acknowledgeFrame(msg.frameId);
        }
        return;
      }

      if (msg.type === 'frames') {
        // Batch of frame ArrayBuffers
        const buffers = msg.buffers;
        for (let i = 0; i < buffers.length; i++) {
          try {
            processFrameBuffer(buffers[i]);
          } finally {
            acknowledgeFrame(msg.frameIds && msg.frameIds[i]);
          }
        }
        return;
      }
    };
  `;
  return new Blob([code], { type: "application/javascript" });
}

/**
 * WebCodecs Worker Renderer
 *
 * Sends raw IPC frame buffers (both RGBA dirty-rects and H.264 NAL payloads)
 * to a Web Worker that uses WebCodecs VideoDecoder for GPU H.264 decode
 * and WebGL2 on an OffscreenCanvas for presentation.
 *
 * This renderer bypasses the normal paintRegion() hot path — instead,
 * raw ArrayBuffers from the Tauri Channel are forwarded directly to the worker
 * via `pushRawBuffer()`, avoiding any main-thread parsing or copying.
 */
class WebCodecsWorkerRenderer implements FrameRenderer {
  private static readonly MAX_PRE_READY_FRAMES = 4;
  private static readonly MAX_PRE_READY_BYTES = 16 * 1024 * 1024;
  private static readonly MAX_READY_IN_FLIGHT_FRAMES = 5;
  private static readonly MAX_READY_RETAINED_BYTES = 32 * 1024 * 1024;
  readonly name: string;
  readonly type: FrontendRendererType;
  readonly tripleBuffered = false;
  private worker: Worker;
  private ready = false;
  private pendingBuffers: ArrayBuffer[] = [];
  private pendingBytes = 0;
  private inFlightFrames = new Map<
    number,
    { byteLength: number; rgbaRefreshEpoch?: number }
  >();
  private inFlightBytes = 0;
  private deferredRgba: ArrayBuffer | null = null;
  private nextFrameId = 1;
  private queueOverflowResetPending = false;
  private preReadyOverflowResetPending = false;
  private sawNalPayload = false;
  private rgbaRefreshPending = false;
  private rgbaRefreshEpoch = 0;
  private rgbaRefreshNextY = 0;
  private surfaceWidth: number;
  private surfaceHeight: number;
  private destroyed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    width: number,
    height: number,
    hwAccel: "prefer-hardware" | "prefer-software" = "prefer-hardware",
    private readonly options?: RendererOptions,
  ) {
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.name =
      hwAccel === "prefer-hardware"
        ? "WebCodecs Worker (H.264 GPU)"
        : "WebCodecs Worker (H.264 CPU)";
    this.type =
      hwAccel === "prefer-hardware" ? "webcodecs-worker" : "webcodecs-cpu";
    const offscreen = canvas.transferControlToOffscreen();
    const blob = createWebCodecsWorkerBlob(hwAccel);
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    this.worker.onmessage = (e) => {
      if (this.destroyed) return;
      if (e.data.type === "ready") {
        this.ready = true;
        // Feed pre-ready work through the same acknowledged, bounded path.
        if (this.pendingBuffers.length > 0) {
          const bufs = this.pendingBuffers;
          this.pendingBuffers = [];
          this.pendingBytes = 0;
          for (const buffer of bufs) this.enqueueReadyBuffer(buffer);
        }
        return;
      }
      if (e.data.type === "frame-consumed") {
        this.handleFrameConsumed(e.data.frameId);
        return;
      }
      if (e.data.type === "h264-reset-consumed") {
        if (e.data.reason === "queue-overflow") {
          this.queueOverflowResetPending = false;
        }
        if (e.data.reason === "pre-ready-overflow") {
          this.preReadyOverflowResetPending = false;
        }
        return;
      }
      if (e.data.type === "h264-recovery") {
        this.options?.onH264RecoveryStateChange?.(
          e.data.state as RdpH264RecoveryState,
          e.data.reason as RdpH264RecoveryReason | undefined,
        );
      }
    };

    this.worker.postMessage(
      { type: "init", canvas: offscreen, width, height },
      [offscreen],
    );
  }

  /**
   * Push a raw IPC ArrayBuffer directly to the worker.
   * This is the fast path — the pipeline calls this instead of paintRegion()
   * when using the WebCodecs renderer, avoiding main-thread RGBA parsing.
   */
  pushRawBuffer(data: ArrayBuffer): void {
    if (this.destroyed) return;
    const nalPayload = isNalPayload(data);
    if (nalPayload) {
      this.sawNalPayload = true;
      this.rgbaRefreshPending = false;
      this.rgbaRefreshNextY = 0;
    }
    if (!this.ready) {
      if (data.byteLength > WebCodecsWorkerRenderer.MAX_PRE_READY_BYTES) {
        if (nalPayload) {
          this.requestPreReadyOverflowRecovery();
        } else {
          this.requestFullRefreshAfterRgbaLoss();
        }
        return;
      }

      const exceedsBounds = () =>
        this.pendingBuffers.length >=
          WebCodecsWorkerRenderer.MAX_PRE_READY_FRAMES ||
        this.pendingBytes + data.byteLength >
          WebCodecsWorkerRenderer.MAX_PRE_READY_BYTES;
      if (exceedsBounds()) {
        const wouldBreakNalChain =
          nalPayload || this.pendingBuffers.some(isNalPayload);
        if (wouldBreakNalChain) {
          this.requestPreReadyOverflowRecovery();
        } else {
          let droppedRgba = false;
          while (this.pendingBuffers.length > 0 && exceedsBounds()) {
            const dropped = this.pendingBuffers.shift();
            if (dropped) {
              this.pendingBytes -= dropped.byteLength;
              droppedRgba = true;
            }
          }
          if (droppedRgba) this.requestFullRefreshAfterRgbaLoss();
        }
      }

      // A deduplicated H.264 reset may still be waiting behind a hung init.
      // Never make room by discarding part of that stateful pending chain.
      if (exceedsBounds()) return;
      this.pendingBuffers.push(data);
      this.pendingBytes += data.byteLength;
      return;
    }
    this.enqueueReadyBuffer(data);
  }

  private enqueueReadyBuffer(data: ArrayBuffer): void {
    const nalPayload = isNalPayload(data);
    if (nalPayload) {
      this.sawNalPayload = true;
      this.rgbaRefreshPending = false;
      this.rgbaRefreshNextY = 0;
    }
    if (nalPayload && this.deferredRgba) {
      this.deferredRgba = null;
      this.requestFullRefreshAfterRgbaLoss();
    }
    if (!nalPayload && this.deferredRgba) {
      // A dirty-rect payload is not necessarily an independent full frame.
      // Never post a newer update ahead of deferred work: replace the single
      // deferred slot (latest-wins) when the replacement remains bounded.
      this.deferredRgba = null;
      const replacementFits =
        data.byteLength <= WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES &&
        this.inFlightBytes + data.byteLength <=
          WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES;
      if (replacementFits) {
        this.deferredRgba = data;
      }
      // Replacing any dirty update loses display state, including one tile of
      // a larger full-desktop refresh. Restart bounded coverage accounting and
      // wait for a fresh, contiguous snapshot sequence.
      this.requestFullRefreshAfterRgbaLoss();
      return;
    }

    const canDispatch =
      data.byteLength <= WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES &&
      this.inFlightFrames.size <
        WebCodecsWorkerRenderer.MAX_READY_IN_FLIGHT_FRAMES &&
      this.inFlightBytes +
        (this.deferredRgba?.byteLength ?? 0) +
        data.byteLength <=
        WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES;
    if (canDispatch) {
      this.dispatchReadyBuffer(data);
      return;
    }

    if (nalPayload) {
      // NAL access units are stateful: never coalesce or silently skip one.
      // Reset once and wait for a fresh recovery chain from the backend.
      this.requestQueueOverflowRecovery();
      return;
    }

    // RGBA dirty-region payloads have no decoder-chain dependency, but are not
    // globally independent full frames. Keep one bounded deferred update and
    // use latest-wins replacement above while the worker remains saturated.
    if (
      data.byteLength <= WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES &&
      this.inFlightBytes + data.byteLength <=
        WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES
    ) {
      this.deferredRgba = data;
      return;
    }
    this.requestFullRefreshAfterRgbaLoss();
  }

  private dispatchReadyBuffer(data: ArrayBuffer): void {
    const frameId = this.nextFrameId++;
    const byteLength = data.byteLength;
    const nalPayload = isNalPayload(data);
    const rgbaRefreshEpoch = this.trackRgbaRefreshDispatch(data);
    this.inFlightFrames.set(frameId, {
      byteLength,
      rgbaRefreshEpoch,
    });
    this.inFlightBytes += byteLength;
    // Transfer ownership for zero-copy. The worker returns a consumed ack only
    // after parsing/painting or submitting the encoded access unit.
    try {
      this.worker.postMessage({ type: "frame", frameId, data }, [data]);
    } catch (error) {
      this.inFlightFrames.delete(frameId);
      this.inFlightBytes = Math.max(0, this.inFlightBytes - byteLength);
      console.error("WebCodecs worker frame transfer failed:", error);
      if (nalPayload) {
        this.requestQueueOverflowRecovery();
      } else {
        this.requestFullRefreshAfterRgbaLoss();
      }
    }
  }

  private trackRgbaRefreshDispatch(data: ArrayBuffer): number | undefined {
    if (this.sawNalPayload || !this.rgbaRefreshPending || isNalPayload(data)) {
      return undefined;
    }

    const coverage = fullWidthRgbaCoverage(
      data,
      this.surfaceWidth,
      this.surfaceHeight,
    );
    if (!coverage) {
      this.rgbaRefreshNextY = 0;
      return undefined;
    }

    if (coverage.startY === 0) this.rgbaRefreshNextY = 0;
    if (coverage.startY !== this.rgbaRefreshNextY) {
      this.rgbaRefreshNextY = 0;
      return undefined;
    }
    this.rgbaRefreshNextY = coverage.endY;
    if (coverage.endY !== this.surfaceHeight) return undefined;

    this.rgbaRefreshNextY = 0;
    return this.rgbaRefreshEpoch;
  }

  private handleFrameConsumed(frameId: unknown): void {
    if (!Number.isSafeInteger(frameId)) return;
    const frame = this.inFlightFrames.get(frameId as number);
    if (!frame) return;
    this.inFlightFrames.delete(frameId as number);
    this.inFlightBytes = Math.max(0, this.inFlightBytes - frame.byteLength);
    if (
      this.rgbaRefreshPending &&
      frame.rgbaRefreshEpoch !== undefined &&
      frame.rgbaRefreshEpoch === this.rgbaRefreshEpoch
    ) {
      this.rgbaRefreshPending = false;
      this.options?.onH264RecoveryStateChange?.("healthy");
    }
    this.flushDeferredRgba();
  }

  private requestPreReadyOverflowRecovery(): void {
    if (this.preReadyOverflowResetPending) return;
    this.preReadyOverflowResetPending = true;
    this.resetH264Recovery("pre-ready-overflow");
  }

  private requestQueueOverflowRecovery(): void {
    if (this.queueOverflowResetPending) return;
    this.queueOverflowResetPending = true;
    this.resetH264Recovery("queue-overflow");
  }

  private requestFullRefreshAfterRgbaLoss(): void {
    if (this.sawNalPayload) {
      // Once NAL passthrough is active, only decoder/keyframe recovery may
      // declare the stream healthy; an RGBA fallback must never do so.
      this.requestQueueOverflowRecovery();
      return;
    }

    this.rgbaRefreshEpoch += 1;
    this.rgbaRefreshNextY = 0;
    if (this.rgbaRefreshPending) return;
    this.rgbaRefreshPending = true;
    // The pipeline maps this recovery edge to the existing active-session
    // refresh path. Native activity reconciliation sends a full RGBA snapshot.
    this.options?.onH264RecoveryStateChange?.(
      "awaitingRecovery",
      "queue-overflow",
    );
  }

  private flushDeferredRgba(): void {
    const deferred = this.deferredRgba;
    if (!deferred) return;
    if (
      this.inFlightFrames.size >=
        WebCodecsWorkerRenderer.MAX_READY_IN_FLIGHT_FRAMES ||
      this.inFlightBytes + deferred.byteLength >
        WebCodecsWorkerRenderer.MAX_READY_RETAINED_BYTES
    ) {
      return;
    }
    this.deferredRgba = null;
    this.dispatchReadyBuffer(deferred);
  }

  /** Legacy paintRegion — used for any RGBA rects that bypass the raw path. */
  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    const byteLen = 8 + rgba.byteLength;
    const buf = new ArrayBuffer(byteLen);
    const view = new DataView(buf);
    view.setUint16(0, x, true);
    view.setUint16(2, y, true);
    view.setUint16(4, w, true);
    view.setUint16(6, h, true);
    new Uint8ClampedArray(buf, 8).set(rgba);
    this.pushRawBuffer(buf);
  }

  present(): void {
    /* Worker presents after each frame decode / RGBA paint */
  }

  resize(width: number, height: number): void {
    // Clear pre-ready buffers immediately and enqueue a decoder reset before
    // the worker changes dimensions. No access unit from the previous surface
    // may complete recovery for the new surface.
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.rgbaRefreshNextY = 0;
    this.resetH264Recovery("resize");
    this.postWorkerControlMessage({ type: "resize", width, height }, "resize");
  }

  resetH264Recovery(reason: RdpH264RecoveryReason): void {
    this.pendingBuffers = [];
    this.pendingBytes = 0;
    this.deferredRgba = null;
    this.rgbaRefreshNextY = 0;
    if (!this.sawNalPayload) {
      // Pure RGBA streams also require an acknowledged, contiguous full
      // snapshot after resize/reset before the display can be healthy again.
      this.rgbaRefreshEpoch += 1;
      this.rgbaRefreshPending = true;
    }
    this.options?.onH264RecoveryStateChange?.("awaitingRecovery", reason);
    const posted = this.postWorkerControlMessage(
      { type: "reset-h264", reason },
      `H.264 reset (${reason})`,
    );
    if (!posted && reason === "queue-overflow") {
      this.queueOverflowResetPending = false;
    }
    if (!posted && reason === "pre-ready-overflow") {
      this.preReadyOverflowResetPending = false;
    }
  }

  private postWorkerControlMessage(
    message: Record<string, unknown>,
    operation: string,
  ): boolean {
    try {
      this.worker.postMessage(message);
      return true;
    } catch (error) {
      console.error(`WebCodecs worker ${operation} post failed:`, error);
      return false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingBuffers = [];
    this.pendingBytes = 0;
    this.inFlightFrames.clear();
    this.inFlightBytes = 0;
    this.deferredRgba = null;
    this.queueOverflowResetPending = false;
    this.preReadyOverflowResetPending = false;
    this.rgbaRefreshPending = false;
    this.rgbaRefreshNextY = 0;
    this.worker.terminate();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Factory
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Auto-select the best available renderer.
 *
 * Priority: WebCodecs GPU → WebCodecs CPU → WebGPU → WebGL → Canvas 2D
 * (OffscreenWorker is intentionally not auto-selected because it has
 * limitations with canvas context ownership.)
 */
function autoSelect(caps: RendererCapabilities): FrontendRendererType {
  if (caps.webcodecs) return "webcodecs-worker";
  if (caps.webgpu) return "webgpu";
  if (caps.webgl) return "webgl";
  return "canvas2d";
}

/**
 * Create a `FrameRenderer` for the given canvas.
 *
 * If the requested type is not supported, falls back through the
 * chain until a working renderer is found.
 *
 * @returns The renderer and its resolved type (may differ from requested
 *          if a fallback was used).
 */
export function createFrameRenderer(
  requested: FrontendRendererType,
  canvas: HTMLCanvasElement,
  opts?: RendererOptions & { width?: number; height?: number },
): FrameRenderer {
  const caps = detectCapabilities();
  const resolved = requested === "auto" ? autoSelect(caps) : requested;

  // Attempt in fallback order
  const order: FrontendRendererType[] = [];

  switch (resolved) {
    case "webcodecs-worker":
      order.push("webcodecs-worker", "webcodecs-cpu", "webgl", "canvas2d");
      break;
    case "webcodecs-cpu":
      order.push("webcodecs-cpu", "webgl", "canvas2d");
      break;
    case "webgpu":
      order.push("webgpu", "webgl", "canvas2d");
      break;
    case "webgl":
      order.push("webgl", "canvas2d");
      break;
    case "offscreen-worker":
      order.push("offscreen-worker", "canvas2d");
      break;
    case "canvas2d":
    default:
      order.push("canvas2d");
      break;
  }

  for (const t of order) {
    try {
      switch (t) {
        case "webcodecs-worker":
          if (caps.webcodecs)
            return new WebCodecsWorkerRenderer(
              canvas,
              opts?.width ?? canvas.width,
              opts?.height ?? canvas.height,
              "prefer-hardware",
              opts,
            );
          break;
        case "webcodecs-cpu":
          if (caps.webcodecs)
            return new WebCodecsWorkerRenderer(
              canvas,
              opts?.width ?? canvas.width,
              opts?.height ?? canvas.height,
              "prefer-software",
              opts,
            );
          break;
        case "webgpu":
          if (caps.webgpu) return new WebGPURenderer(canvas);
          break;
        case "webgl":
          if (caps.webgl) return new WebGLRenderer(canvas, opts);
          break;
        case "offscreen-worker":
          if (caps.offscreenWorker)
            return new OffscreenWorkerRenderer(canvas, opts);
          break;
        case "canvas2d":
          return new Canvas2DRenderer(canvas);
      }
    } catch (e) {
      console.warn(`Renderer '${t}' init failed, trying next:`, e);
    }
  }

  // Ultimate fallback — Canvas 2D should always work
  return new Canvas2DRenderer(canvas);
}
