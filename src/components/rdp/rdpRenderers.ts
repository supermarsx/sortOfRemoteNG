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

function toUint8Array(data: ArrayBuffer | ArrayBufferView, offset?: number): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data, offset ?? 0);
  const base = data.byteOffset + (offset ?? 0);
  return new Uint8Array(data.buffer, base);
}

// ─── Public Types ──────────────────────────────────────────────────────────

/** Identifiers for the available frontend renderers. */
export type FrontendRendererType =
  | 'auto'
  | 'canvas2d'
  | 'webgl'
  | 'webgpu'
  | 'offscreen-worker'
  | 'webcodecs-worker'
  | 'webcodecs-cpu';

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
  /** Release all GPU / worker resources. */
  destroy(): void;
}

/** Options for renderer creation. */
export interface RendererOptions {
  tripleBuffering?: boolean;
}

// ─── Feature Detection ─────────────────────────────────────────────────────

let _caps: RendererCapabilities | null = null;

/** Probe which renderers the current browser supports. */
export function detectCapabilities(): RendererCapabilities {
  if (_caps) return _caps;
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;

  _caps = {
    canvas2d: !!probe.getContext('2d'),
    webgl: !!(probe.getContext('webgl2') || probe.getContext('webgl')),
    webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    offscreenWorker:
      typeof OffscreenCanvas !== 'undefined' &&
      typeof Worker !== 'undefined',
    webcodecs:
      typeof OffscreenCanvas !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof VideoDecoder !== 'undefined',
  };
  return _caps;
}

// ═════════════════════════════════════════════════════════════════════════════
// Canvas 2D Renderer  —  putImageData (baseline, always works)
// ═════════════════════════════════════════════════════════════════════════════

class Canvas2DRenderer implements FrameRenderer {
  readonly name = 'Canvas 2D';
  readonly type: FrontendRendererType = 'canvas2d';
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
    const ctx = canvas.getContext('2d', { desynchronized: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.visCtx = ctx;

    // Double-buffer: paint dirty regions to an OffscreenCanvas, then blit
    // to the visible canvas in present() via a single drawImage() call.
    // This prevents the compositor from snapshotting the canvas mid-paint
    // during large putImageData writes (which causes scanline artifacts).
    // Falls back to direct putImageData when OffscreenCanvas is unavailable
    // (e.g. test environments).
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        this.backBuffer = new OffscreenCanvas(canvas.width || 1920, canvas.height || 1080);
        this.backCtx = this.backBuffer.getContext('2d') ?? null;
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
    const ctx = this.canvas.getContext('2d', { desynchronized: false });
    if (ctx) this.visCtx = ctx;

    if (this.backBuffer && this.backCtx) {
      // Capture current back-buffer content before resizing.
      const oldW = this.backBuffer.width;
      const oldH = this.backBuffer.height;
      if (width === oldW && height === oldH) return;

      const tmp = new OffscreenCanvas(oldW, oldH);
      const tmpCtx = tmp.getContext('2d');
      if (tmpCtx && this.dirty) {
        tmpCtx.drawImage(this.backBuffer, 0, 0);
      }
      this.backBuffer.width = width;
      this.backBuffer.height = height;
      // Re-acquire back-buffer context (resize invalidates it).
      const bCtx = this.backBuffer.getContext('2d');
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
  readonly type: FrontendRendererType = 'webgl';
  readonly tripleBuffered: boolean;
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

  constructor(private canvas: HTMLCanvasElement, opts?: RendererOptions) {
    // preserveDrawingBuffer MUST be true for dirty-rect rendering: we only
    // update changed regions via texSubImage2D, so the browser must not clear
    // unchanged areas between compositing frames.
    //
    // desynchronized MUST be false: dirty-rect rendering paints multiple
    // sub-regions per frame via texSubImage2D before a single present().
    // With desynchronized=true, the browser can display the canvas mid-paint,
    // showing a mix of old and new regions — classic ghosting artifacts.
    const gl2 = canvas.getContext('webgl2', {
      antialias: false,
      desynchronized: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    const gl = gl2 ?? (canvas.getContext('webgl', {
      antialias: false,
      desynchronized: false,
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null);
    if (!gl) throw new Error('WebGL context unavailable');
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
      throw new Error('WebGL program link: ' + gl.getProgramInfoLog(prog));
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
    const loc = gl.getAttribLocation(prog, 'a_pos');
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
      this.name = 'WebGL (triple-buffered)';
    } else {
      this.tex = this.createTex(gl);
      this.name = 'WebGL';
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

  private createFbo(gl: WebGLRenderingContext, tex: WebGLTexture): WebGLFramebuffer {
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  private allocTextures(w: number, h: number): void {
    if (w === this.texW && h === this.texH) return;
    const gl = this.gl;
    if (this.tripleBuffered && this.texPair) {
      for (const t of this.texPair) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
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
        0, 0, this.texW, this.texH,
        0, 0, this.texW, this.texH,
        gl.COLOR_BUFFER_BIT, gl.NEAREST,
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
    const ext = gl.getExtension('WEBGL_lose_context');
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

class WebGPURenderer implements FrameRenderer {
  readonly name = 'WebGPU';
  readonly type: FrontendRendererType = 'webgpu';
  readonly tripleBuffered = false; // WebGPU manages its own swap chain
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private tex!: GPUTexture;
  private bindGroup!: GPUBindGroup;
  private diagPaintCount = 0;
  private diagPresentCount = 0;
  private bindGroupLayout!: GPUBindGroupLayout;
  private texW = 0;
  private texH = 0;
  private dirty = false;
  private ready = false;
  private initFailed = false;
  // Fallback renderer used when async init fails
  private fallback: Canvas2DRenderer | null = null;
  // Queued paints that arrive before async init completes (no cap — init
  // takes ~50-200ms so the queue stays small)
  private pendingPaints: { x: number; y: number; w: number; h: number; rgba: Uint8Array }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.initAsync().catch((e) => {
      console.error('WebGPU init failed, falling back to Canvas2D:', e);
      this.initFailed = true;
      try {
        // Unconfigure WebGPU context if it was acquired, so Canvas2D can work
        if (this.ctx) {
          try { this.ctx.unconfigure(); } catch { /* ignore */ }
        }
        // Force a fresh context by resetting canvas dimensions
        const w = canvas.width;
        const h = canvas.height;
        canvas.width = 0;
        canvas.width = w;
        canvas.height = h;
        this.fallback = new Canvas2DRenderer(canvas);
        // Flush pending paints to the fallback
        for (const p of this.pendingPaints) {
          this.fallback.paintRegion(p.x, p.y, p.w, p.h, new Uint8ClampedArray(p.rgba.buffer, p.rgba.byteOffset, p.rgba.byteLength));
        }
        this.fallback.present();
      } catch (e2) {
        console.error('Canvas2D fallback also failed:', e2);
      }
      this.pendingPaints = [];
    });
  }

  private async initAsync(): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU: navigator.gpu not available');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU: no adapter');
    this.device = await adapter.requestDevice();

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      throw new Error(
        'WebGPU: getContext("webgpu") returned null — the canvas may already ' +
        'have a different context type (e.g. "2d" or "webgl").',
      );
    }
    this.ctx = ctx as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({
      device: this.device,
      format,
      alphaMode: 'opaque',
    });

    // Shader module
    const shaderModule = this.device.createShaderModule({
      code: WGPU_VERT + '\n' + WGPU_FRAG,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: shaderModule, entryPoint: 'vs' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    this.sampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'linear',
    });

    this.allocTexture(this.canvas.width || 1920, this.canvas.height || 1080);
    this.ready = true;
    console.log(`[WebGPU] initAsync OK: tex=${this.texW}x${this.texH}, canvas=${this.canvas.width}x${this.canvas.height}, pending=${this.pendingPaints.length}, format=${format}`);

    // Flush any queued paints and present immediately
    for (const p of this.pendingPaints) {
      this.paintRegion(p.x, p.y, p.w, p.h, new Uint8ClampedArray(p.rgba.buffer, p.rgba.byteOffset, p.rgba.byteLength));
    }
    const hadPending = this.pendingPaints.length;
    this.pendingPaints = [];
    if (hadPending > 0) {
      this.present();
      console.log(`[WebGPU] flushed ${hadPending} pending paints, dirty=${this.dirty}`);
    }
  }

  private allocTexture(w: number, h: number): void {
    if (w === this.texW && h === this.texH) return;
    if (this.tex) this.tex.destroy();
    this.tex = this.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.texW = w;
    this.texH = h;

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.tex.createView() },
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
      // Queue all paints until async init completes (no cap — init is fast,
      // ~50-200ms, so the queue stays small).  We copy to a fresh Uint8Array
      // since the source view may be into a shared ArrayBuffer that gets reused.
      this.pendingPaints.push({ x, y, w, h, rgba: new Uint8Array(rgba) });
      return;
    }
    // writeTexture needs the data as a contiguous buffer.  The incoming rgba
    // is often a Uint8ClampedArray *view* with a non-zero byteOffset into a
    // larger ArrayBuffer.  Some WebGPU implementations don't correctly handle
    // the view's byteOffset, so we ensure a zero-offset buffer.
    const data: Uint8Array = rgba.byteOffset === 0
      ? new Uint8Array(rgba.buffer, 0, rgba.byteLength)
      : new Uint8Array(rgba);
    if (this.diagPaintCount++ < 5) {
      // Sample first 16 bytes to verify non-zero pixel data
      const sample = Array.from(data.subarray(0, Math.min(16, data.length)));
      console.log(`[WebGPU] paintRegion #${this.diagPaintCount}: (${x},${y}) ${w}x${h}, ${data.length} bytes, offset=${rgba.byteOffset}, texSize=${this.texW}x${this.texH}, sample=${sample.join(',')}`);
    }
    this.device.queue.writeTexture(
      { texture: this.tex, origin: [x, y] },
      data,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h],
    );
    this.dirty = true;
  }

  present(): void {
    if (this.fallback) { this.fallback.present(); return; }
    if (!this.dirty || !this.ready) return;
    if (this.diagPresentCount++ < 5) {
      console.log(`[WebGPU] present #${this.diagPresentCount}: canvas=${this.canvas.width}x${this.canvas.height}, tex=${this.texW}x${this.texH}`);
    }
    try {
      const target = this.ctx.getCurrentTexture().createView();
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(4);
      pass.end();
      this.device.queue.submit([enc.finish()]);
      this.dirty = false;
    } catch (e) {
      console.error('WebGPU present failed:', e);
    }
  }

  resize(width: number, height: number): void {
    if (this.fallback) { this.fallback.resize(width, height); return; }
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.ready) {
      this.allocTexture(width, height);
    }
  }

  destroy(): void {
    if (this.fallback) { this.fallback.destroy(); return; }
    if (this.tex) this.tex.destroy();
    if (this.device) this.device.destroy();
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

      // Frame batch: { type: 'frames', buffers: ArrayBuffer[] }
      if (msg.type === 'frames' && ctx) {
        const buffers = msg.buffers;
        for (let i = 0; i < buffers.length; i++) {
          const data = buffers[i];
          if (data.byteLength < 8) continue;
          const view = toDataView(data);
          const x = view.getUint16(0, true);
          const y = view.getUint16(2, true);
          const rw = view.getUint16(4, true);
          const rh = view.getUint16(6, true);
          if (rw <= 0 || rh <= 0) continue;
          const rgba = new Uint8ClampedArray(data, 8);
          if (rgba.length < rw * rh * 4) continue;
          const imgData = new ImageData(rgba, rw, rh);
          ctx.putImageData(imgData, x, y);
        }
      }
    };
  `;
  return new Blob([code], { type: 'application/javascript' });
}

class OffscreenWorkerRenderer implements FrameRenderer {
  readonly name = 'OffscreenCanvas Worker';
  readonly type: FrontendRendererType = 'offscreen-worker';
  readonly tripleBuffered = false;
  private worker: Worker;
  private ready = false;
  private pendingFrames: ArrayBuffer[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    const offscreen = canvas.transferControlToOffscreen();
    const blob = createPaintWorkerBlob();
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    this.worker.postMessage(
      { type: 'init', canvas: offscreen },
      [offscreen],
    );
    this.ready = true;
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    // Build the same 8-byte header + RGBA format the Channel uses
    const byteLen = 8 + rgba.byteLength;
    const buf = new ArrayBuffer(byteLen);
    const view = new DataView(buf);
    view.setUint16(0, x, true);
    view.setUint16(2, y, true);
    view.setUint16(4, w, true);
    view.setUint16(6, h, true);
    new Uint8ClampedArray(buf, 8).set(rgba);
    this.pendingFrames.push(buf);
  }

  /** Flush all queued paints to the worker (called once per rAF). */
  present(): void {
    if (this.pendingFrames.length === 0 || !this.ready) return;
    const bufs = this.pendingFrames;
    this.pendingFrames = [];
    // Transfer ownership of the ArrayBuffers for zero-copy
    this.worker.postMessage(
      { type: 'frames', buffers: bufs },
      bufs,
    );
  }

  resize(width: number, height: number): void {
    // OffscreenCanvas must be resized from the worker thread
    this.worker.postMessage({ type: 'resize', width, height });
  }

  destroy(): void {
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
const NAL_MAGIC = 0x4E414C48;

/** NAL header size: magic(4) + surface_id(2) + screen_x(2) + screen_y(2) + dest_w(2) + dest_h(2) + reserved(2) = 16 */
const NAL_HEADER_SIZE = 16;

/** Check if an ArrayBuffer starts with the NAL magic prefix. */
export function isNalPayload(data: ArrayBuffer | ArrayBufferView): boolean {
  if (toByteLength(data) < NAL_HEADER_SIZE) return false;
  return toDataView(data).getUint32(0, true) === NAL_MAGIC;
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
function createWebCodecsWorkerBlob(hwAccel: 'prefer-hardware' | 'prefer-software' = 'prefer-hardware'): Blob {
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
    let frameCount = 0;
    const HW_ACCEL = '${hwAccel}';

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
    function initDecoder() {
      if (typeof VideoDecoder === 'undefined') {
        console.warn('[WebCodecs worker] VideoDecoder not available');
        return;
      }

      decoder = new VideoDecoder({
        output: (frame) => {
          frameCount++;
          if (gl) {
            // Upload VideoFrame directly as WebGL texture (GPU→GPU, zero CPU copy)
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            presentGL();
          } else if (ctx2d) {
            ctx2d.drawImage(frame, 0, 0);
          }
          frame.close();
        },
        error: (e) => {
          console.error('[WebCodecs worker] decode error:', e);
        },
      });
    }

    function configureDecoder(width, height) {
      if (!decoder || decoderConfigured) return;
      decoder.configure({
        codec: 'avc1.42001f', // Baseline profile, level 3.1
        codedWidth: width,
        codedHeight: height,
        hardwareAcceleration: HW_ACCEL,
        optimizeForLatency: true,
      });
      decoderConfigured = true;
      console.log('[WebCodecs worker] decoder configured:', width, 'x', height);
    }

    // ── RGBA dirty-rect fallback (for uncompressed/bitmap frames) ─────
    let rgbaImgCache = null;

    function paintRgbaRect(data) {
      const view = toDataView(data);
      let offset = 0;
      while (offset + 8 <= data.byteLength) {
        const x = view.getUint16(offset, true);
        const y = view.getUint16(offset + 2, true);
        const rw = view.getUint16(offset + 4, true);
        const rh = view.getUint16(offset + 6, true);
        const pixelBytes = rw * rh * 4;
        if (offset + 8 + pixelBytes > data.byteLength) break;
        const rgba = new Uint8ClampedArray(data, offset + 8, pixelBytes);

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

    // ── Message handler ────────────────────────────────────────────────
    const NAL_MAGIC = 0x4E414C48;

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
        // Reset decoder for new resolution
        if (decoder && decoderConfigured) {
          decoderConfigured = false;
        }
        return;
      }

      if (msg.type === 'frame') {
        const data = msg.data; // ArrayBuffer
        if (data.byteLength < 4) return;

        const magic = toDataView(data).getUint32(0, true);
        if (magic === NAL_MAGIC && decoder) {
          // H.264 NAL passthrough
          const view = toDataView(data);
          const destW = view.getUint16(10, true);
          const destH = view.getUint16(12, true);
          const nalData = new Uint8Array(data, 16);

          if (!decoderConfigured && destW > 0 && destH > 0) {
            configureDecoder(destW, destH);
          }

          const chunk = new EncodedVideoChunk({
            type: frameCount === 0 ? 'key' : 'delta',
            timestamp: frameCount * 33333,  // ~30fps timing
            data: nalData,
          });
          decoder.decode(chunk);
        } else {
          // Standard RGBA dirty-rect
          paintRgbaRect(data);
        }
        return;
      }

      if (msg.type === 'frames') {
        // Batch of frame ArrayBuffers
        const buffers = msg.buffers;
        for (let i = 0; i < buffers.length; i++) {
          const data = buffers[i];
          if (data.byteLength < 4) continue;
          const magic = toDataView(data).getUint32(0, true);
          if (magic === NAL_MAGIC && decoder) {
            const view = toDataView(data);
            const destW = view.getUint16(10, true);
            const destH = view.getUint16(12, true);
            const nalData = new Uint8Array(data, 16);
            if (!decoderConfigured && destW > 0 && destH > 0) {
              configureDecoder(destW, destH);
            }
            const chunk = new EncodedVideoChunk({
              type: frameCount === 0 ? 'key' : 'delta',
              timestamp: frameCount * 33333,
              data: nalData,
            });
            decoder.decode(chunk);
          } else {
            paintRgbaRect(data);
          }
        }
        return;
      }
    };
  `;
  return new Blob([code], { type: 'application/javascript' });
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
  readonly name: string;
  readonly type: FrontendRendererType;
  readonly tripleBuffered = false;
  private worker: Worker;
  private ready = false;
  private pendingBuffers: ArrayBuffer[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    width: number,
    height: number,
    hwAccel: 'prefer-hardware' | 'prefer-software' = 'prefer-hardware',
  ) {
    this.name = hwAccel === 'prefer-hardware'
      ? 'WebCodecs Worker (H.264 GPU)'
      : 'WebCodecs Worker (H.264 CPU)';
    this.type = hwAccel === 'prefer-hardware'
      ? 'webcodecs-worker'
      : 'webcodecs-cpu';
    const offscreen = canvas.transferControlToOffscreen();
    const blob = createWebCodecsWorkerBlob(hwAccel);
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);

    this.worker.onmessage = (e) => {
      if (e.data.type === 'ready') {
        this.ready = true;
        // Flush any buffers that arrived before worker was ready
        if (this.pendingBuffers.length > 0) {
          const bufs = this.pendingBuffers;
          this.pendingBuffers = [];
          this.worker.postMessage(
            { type: 'frames', buffers: bufs },
            bufs,
          );
        }
      }
    };

    this.worker.postMessage(
      { type: 'init', canvas: offscreen, width, height },
      [offscreen],
    );
  }

  /**
   * Push a raw IPC ArrayBuffer directly to the worker.
   * This is the fast path — the pipeline calls this instead of paintRegion()
   * when using the WebCodecs renderer, avoiding main-thread RGBA parsing.
   */
  pushRawBuffer(data: ArrayBuffer): void {
    if (!this.ready) {
      this.pendingBuffers.push(data);
      return;
    }
    // Transfer ownership for zero-copy
    this.worker.postMessage({ type: 'frame', data }, [data]);
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
    this.worker.postMessage({ type: 'resize', width, height });
  }

  destroy(): void {
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
  if (caps.webcodecs) return 'webcodecs-worker';
  if (caps.webgpu) return 'webgpu';
  if (caps.webgl) return 'webgl';
  return 'canvas2d';
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
  const resolved = requested === 'auto' ? autoSelect(caps) : requested;

  // Attempt in fallback order
  const order: FrontendRendererType[] = [];

  switch (resolved) {
    case 'webcodecs-worker':
      order.push('webcodecs-worker', 'webcodecs-cpu', 'webgl', 'canvas2d');
      break;
    case 'webcodecs-cpu':
      order.push('webcodecs-cpu', 'webgl', 'canvas2d');
      break;
    case 'webgpu':
      order.push('webgpu', 'webgl', 'canvas2d');
      break;
    case 'webgl':
      order.push('webgl', 'canvas2d');
      break;
    case 'offscreen-worker':
      order.push('offscreen-worker', 'canvas2d');
      break;
    case 'canvas2d':
    default:
      order.push('canvas2d');
      break;
  }

  for (const t of order) {
    try {
      switch (t) {
        case 'webcodecs-worker':
          if (caps.webcodecs)
            return new WebCodecsWorkerRenderer(canvas, opts?.width ?? canvas.width, opts?.height ?? canvas.height, 'prefer-hardware');
          break;
        case 'webcodecs-cpu':
          if (caps.webcodecs)
            return new WebCodecsWorkerRenderer(canvas, opts?.width ?? canvas.width, opts?.height ?? canvas.height, 'prefer-software');
          break;
        case 'webgpu':
          if (caps.webgpu) return new WebGPURenderer(canvas);
          break;
        case 'webgl':
          if (caps.webgl) return new WebGLRenderer(canvas, opts);
          break;
        case 'offscreen-worker':
          if (caps.offscreenWorker)
            return new OffscreenWorkerRenderer(canvas);
          break;
        case 'canvas2d':
          return new Canvas2DRenderer(canvas);
      }
    } catch (e) {
      console.warn(`Renderer '${t}' init failed, trying next:`, e);
    }
  }

  // Ultimate fallback — Canvas 2D should always work
  return new Canvas2DRenderer(canvas);
}
