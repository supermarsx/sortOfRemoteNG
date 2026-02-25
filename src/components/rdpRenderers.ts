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

// ─── Public Types ──────────────────────────────────────────────────────────

/** Identifiers for the available frontend renderers. */
export type FrontendRendererType =
  | 'auto'
  | 'canvas2d'
  | 'webgl'
  | 'webgpu'
  | 'offscreen-worker';

/** Feature-test results exposed for UI / diagnostics. */
export interface RendererCapabilities {
  canvas2d: boolean;
  webgl: boolean;
  webgpu: boolean;
  offscreenWorker: boolean;
}

/** Common interface that all renderers implement. */
export interface FrameRenderer {
  /** Human-readable name of the active backend (for UI / logging). */
  readonly name: string;
  /** The resolved renderer type identifier. */
  readonly type: FrontendRendererType;
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
  };
  return _caps;
}

// ═════════════════════════════════════════════════════════════════════════════
// Canvas 2D Renderer  —  putImageData (baseline, always works)
// ═════════════════════════════════════════════════════════════════════════════

class Canvas2DRenderer implements FrameRenderer {
  readonly name = 'Canvas 2D';
  readonly type: FrontendRendererType = 'canvas2d';
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    // Ensure a proper ArrayBuffer (not SharedArrayBuffer) for ImageData.
    const buf = new Uint8ClampedArray(rgba.buffer instanceof ArrayBuffer ? rgba : new Uint8ClampedArray(rgba));
    const img = new ImageData(buf, w, h);
    this.ctx.putImageData(img, x, y);
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    // Re-acquire context after resize (some browsers invalidate it).
    const ctx = this.canvas.getContext('2d', { desynchronized: true });
    if (ctx) this.ctx = ctx;
  }

  present(): void {
    /* putImageData is immediate — no flush needed */
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
  readonly name = 'WebGL';
  readonly type: FrontendRendererType = 'webgl';
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private tex: WebGLTexture;
  private texW = 0;
  private texH = 0;
  private dirty = false;
  private program: WebGLProgram;

  constructor(private canvas: HTMLCanvasElement) {
    const gl =
      (canvas.getContext('webgl2', {
        antialias: false,
        desynchronized: true,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl', {
        antialias: false,
        desynchronized: true,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null);
    if (!gl) throw new Error('WebGL context unavailable');
    this.gl = gl;

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

    // ── Fullscreen quad  (-1…1) ──
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    /* eslint-disable-next-line @typescript-eslint/no-loss-of-precision */
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // ── Texture ──
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.tex = tex;

    // Allocate at current canvas size
    this.allocTexture(canvas.width || 1920, canvas.height || 1080);
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

  private allocTexture(w: number, h: number): void {
    if (w === this.texW && h === this.texH) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // Allocate with zeroed RGBA data
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
    this.texW = w;
    this.texH = h;
  }

  paintRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    rgba: Uint8ClampedArray,
  ): void {
    if (w <= 0 || h <= 0 || rgba.length < w * h * 4) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
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

  /**
   * Draw the texture to the canvas.
   * Called once per rAF after all `paintRegion` calls for that frame.
   */
  present(): void {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.dirty = false;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.allocTexture(width, height);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
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
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private pipeline!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private tex!: GPUTexture;
  private bindGroup!: GPUBindGroup;
  private bindGroupLayout!: GPUBindGroupLayout;
  private texW = 0;
  private texH = 0;
  private dirty = false;
  private ready = false;
  // Queued paints that arrive before async init completes
  private pendingPaints: { x: number; y: number; w: number; h: number; rgba: Uint8ClampedArray }[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.initAsync().catch((e) => {
      console.error('WebGPU init failed:', e);
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

    // Flush any queued paints
    for (const p of this.pendingPaints) {
      this.paintRegion(p.x, p.y, p.w, p.h, p.rgba);
    }
    this.pendingPaints = [];
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
    if (!this.ready) {
      this.pendingPaints.push({ x, y, w, h, rgba: new Uint8ClampedArray(rgba) });
      return;
    }
    this.device.queue.writeTexture(
      { texture: this.tex, origin: [x, y] },
      rgba as Uint8ClampedArray<ArrayBuffer>,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h],
    );
    this.dirty = true;
  }

  present(): void {
    if (!this.dirty || !this.ready) return;
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
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.ready) {
      this.allocTexture(width, height);
    }
  }

  destroy(): void {
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
        ctx = canvas.getContext('2d', { desynchronized: true });
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
          const view = new DataView(data);
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
// Factory
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Auto-select the best available renderer.
 *
 * Priority: WebGPU → WebGL → Canvas 2D
 * (OffscreenWorker is intentionally not auto-selected because it has
 * limitations with canvas context ownership.)
 */
function autoSelect(caps: RendererCapabilities): FrontendRendererType {
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
): FrameRenderer {
  const caps = detectCapabilities();
  const resolved = requested === 'auto' ? autoSelect(caps) : requested;

  // Attempt in fallback order
  const order: FrontendRendererType[] = [];

  switch (resolved) {
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
        case 'webgpu':
          if (caps.webgpu) return new WebGPURenderer(canvas);
          break;
        case 'webgl':
          if (caps.webgl) return new WebGLRenderer(canvas);
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
