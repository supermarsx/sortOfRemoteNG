import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFrameRenderer,
  type FrameRenderer,
} from "../../src/components/rdp/rdpRenderers";
import { RdpFramePipeline } from "../../src/components/rdp/rdpFramePipeline";

type WorkerMessage = { data: unknown };
type WorkerMessageHandler = ((event: WorkerMessage) => void) | null;
type WorkerEventSink = { onmessage: WorkerMessageHandler };
type RawBufferRenderer = FrameRenderer & {
  pushRawBuffer: (data: ArrayBuffer) => void;
};
type BoundedRawBufferRenderer = RawBufferRenderer & {
  inFlightFrames: Map<number, { byteLength: number }>;
  inFlightBytes: number;
  deferredRgba: ArrayBuffer | null;
  flushDeferredRgba: () => void;
};
type BoundedOffscreenRenderer = FrameRenderer & {
  pendingFrames: ArrayBuffer[];
  pendingBytes: number;
  inFlightBatches: Map<
    number,
    { frameCount: number; byteLength: number; recoveryEpoch?: number }
  >;
  inFlightFrames: number;
  inFlightBytes: number;
  recoveryPending: boolean;
};

const workerBlobs = new Map<string, string>();
const workers: MockWorker[] = [];
const decodedChunks: MockEncodedVideoChunk[] = [];
const videoDecoders: MockVideoDecoder[] = [];
const NAL_MAGIC = 0x4e414c48;

let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;
let originalTransferControlToOffscreen:
  HTMLCanvasElement["transferControlToOffscreen"] | undefined;
let hadTransferControlToOffscreen = false;

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    height?: number,
  ) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
      if (this.data.length !== this.width * this.height * 4) {
        throw new Error(
          `Invalid ImageData payload length: ${this.data.length}`,
        );
      }
      return;
    }

    this.width = dataOrWidth;
    this.height = widthOrHeight;
    this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }
}

class MockBlob {
  readonly source: string;
  readonly type: string;

  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    this.source = parts.map((part) => String(part)).join("");
    this.type = options?.type ?? "";
  }
}

class MockEncodedVideoChunk {
  type: "key" | "delta";
  timestamp: number;
  data: Uint8Array;

  constructor(init: {
    type: "key" | "delta";
    timestamp: number;
    data: Uint8Array;
  }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.data = init.data;
  }
}

class MockVideoDecoder {
  readonly pendingChunks: MockEncodedVideoChunk[] = [];
  decodeQueueSize = 0;
  state: "unconfigured" | "configured" | "closed" = "unconfigured";
  private readonly dequeueListeners = new Set<() => void>();

  constructor(
    private readonly init: {
      output: (_frame: unknown) => void;
      error: (_error: unknown) => void;
    },
  ) {
    videoDecoders.push(this);
  }

  configure(_config: Record<string, unknown>): void {
    this.state = "configured";
  }

  decode(chunk: MockEncodedVideoChunk): void {
    if (this.state !== "configured") throw new Error("decoder unconfigured");
    decodedChunks.push(chunk);
    this.pendingChunks.push(chunk);
    this.decodeQueueSize += 1;
  }

  reset(): void {
    this.pendingChunks.length = 0;
    this.decodeQueueSize = 0;
    this.state = "unconfigured";
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === "dequeue") this.dequeueListeners.add(listener);
  }

  dequeue(output = true): void {
    const chunk = this.pendingChunks.shift();
    if (!chunk) return;
    this.decodeQueueSize -= 1;
    this.dequeueListeners.forEach((listener) => listener());
    if (output) {
      this.init.output({
        timestamp: chunk.timestamp,
        close: vi.fn(),
      });
    }
  }

  emitOutputForTimestamp(timestamp: number): void {
    this.init.output({
      timestamp,
      close: vi.fn(),
    });
  }

  fail(error: unknown): void {
    this.init.error(error);
  }

  close(): void {
    this.reset();
    this.state = "closed";
  }
}

function create2dContext(canvas: MockOffscreenCanvas) {
  return {
    canvas,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
  };
}

class MockOffscreenCanvas {
  width: number;
  height: number;
  private ctx2d: ReturnType<typeof create2dContext> | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string): ReturnType<typeof create2dContext> | null {
    if (kind === "2d") {
      this.ctx2d ??= create2dContext(this);
      return this.ctx2d;
    }
    return null;
  }
}

class MockWorker implements WorkerEventSink {
  onmessage: WorkerMessageHandler = null;
  readonly errors: unknown[] = [];
  readonly heldMessages: unknown[] = [];
  private readonly scope: WorkerEventSink & {
    postMessage: (data: unknown) => void;
  };
  private pending: Promise<void>;
  private processingPaused = false;

  constructor(url: string) {
    const source = workerBlobs.get(url);
    if (!source) {
      throw new Error(`No worker blob registered for ${url}`);
    }

    this.scope = {
      onmessage: null,
      postMessage: (data: unknown) => {
        queueMicrotask(() => {
          this.onmessage?.({ data });
        });
      },
    };

    this.pending = source
      ? Promise.resolve().then(() => {
          const run = new Function(
            "self",
            "console",
            "ImageData",
            "VideoDecoder",
            "EncodedVideoChunk",
            source,
          );
          run(
            this.scope,
            console,
            globalThis.ImageData,
            globalThis.VideoDecoder,
            globalThis.EncodedVideoChunk,
          );
        })
      : Promise.reject(new Error(`No worker blob registered for ${url}`)).catch(
          (error) => {
            this.errors.push(error);
          },
        );

    workers.push(this);
  }

  private enqueueMessage(data: unknown): void {
    this.pending = this.pending
      .then(() => {
        this.scope.onmessage?.({ data });
      })
      .catch((error) => {
        this.errors.push(error);
      });
  }

  postMessage(data: unknown): void {
    if (this.processingPaused) {
      this.heldMessages.push(data);
      return;
    }
    this.enqueueMessage(data);
  }

  pauseProcessing(): void {
    this.processingPaused = true;
  }

  resumeProcessing(): void {
    this.processingPaused = false;
    const held = this.heldMessages.splice(0);
    for (const message of held) this.enqueueMessage(message);
  }

  terminate(): void {
    this.heldMessages.length = 0;
  }

  async whenIdle(): Promise<void> {
    await this.pending;
  }
}

function buildRgbaRectBuffer(width = 2, height = 2): ArrayBuffer {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(0x7f);
  const buffer = new ArrayBuffer(8 + rgba.byteLength);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 2, true);
  view.setUint16(4, width, true);
  view.setUint16(6, height, true);
  new Uint8ClampedArray(buffer, 8).set(rgba);
  return buffer;
}

function buildFullRgbaFrameBuffer(width: number, height: number): ArrayBuffer {
  const buffer = buildRgbaRectBuffer(width, height);
  const view = new DataView(buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 0, true);
  return buffer;
}

function buildFullWidthRgbaTile(
  width: number,
  y: number,
  height: number,
): ArrayBuffer {
  const buffer = buildFullRgbaFrameBuffer(width, height);
  new DataView(buffer).setUint16(2, y, true);
  return buffer;
}

function annexB(...nalUnits: number[][]): Uint8Array {
  return new Uint8Array(
    nalUnits.flatMap((unit, index) => [
      ...(index % 2 === 0 ? [0, 0, 0, 1] : [0, 0, 1]),
      ...unit,
    ]),
  );
}

function buildNalBuffer(
  destW = 2,
  destH = 2,
  nalPayload = annexB(
    [0x67, 0x42, 0x00, 0x1f],
    [0x68, 0xce, 0x06, 0xe2],
    [0x65, 0x88, 0x84, 0x21],
  ),
): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + nalPayload.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, NAL_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, destW, true);
  view.setUint16(12, destH, true);
  view.setUint16(14, 0, true);
  new Uint8Array(buffer, 16).set(nalPayload);
  return buffer;
}

function asOffsetUint8View(buffer: ArrayBuffer): Uint8Array {
  const source = new Uint8Array(buffer);
  const outer = new Uint8Array(source.byteLength + 11);
  outer.fill(0xee);
  outer.set(source, 5);
  return outer.subarray(5, 5 + source.byteLength);
}

function getWorker(renderer: unknown): MockWorker {
  const worker = (renderer as { worker?: MockWorker }).worker;
  if (!worker) {
    throw new Error("Expected renderer to expose a worker instance");
  }
  return worker;
}

async function waitForWorkersToDrain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.all(workers.map((worker) => worker.whenIdle()));
    await Promise.resolve();
  }
}

describe("rdp worker blobs", () => {
  beforeEach(() => {
    workerBlobs.clear();
    workers.length = 0;
    decodedChunks.length = 0;
    videoDecoders.length = 0;

    vi.stubGlobal("ImageData", MockImageData as typeof ImageData);
    vi.stubGlobal("Blob", MockBlob as unknown as typeof Blob);
    vi.stubGlobal(
      "OffscreenCanvas",
      MockOffscreenCanvas as unknown as typeof OffscreenCanvas,
    );
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "VideoDecoder",
      MockVideoDecoder as unknown as typeof VideoDecoder,
    );
    vi.stubGlobal(
      "EncodedVideoChunk",
      MockEncodedVideoChunk as unknown as typeof EncodedVideoChunk,
    );

    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: MockBlob) => {
        const url = `blob:worker-${workerBlobs.size + 1}`;
        workerBlobs.set(url, blob.source);
        return url;
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    hadTransferControlToOffscreen = Object.prototype.hasOwnProperty.call(
      HTMLCanvasElement.prototype,
      "transferControlToOffscreen",
    );
    originalTransferControlToOffscreen =
      HTMLCanvasElement.prototype.transferControlToOffscreen;
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "transferControlToOffscreen",
      {
        configurable: true,
        writable: true,
        value(this: HTMLCanvasElement) {
          return new MockOffscreenCanvas(this.width, this.height);
        },
      },
    );

    const getContextMock = ((kind: string) => {
      if (kind === "2d") {
        return {} as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      getContextMock,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    workerBlobs.clear();
    workers.length = 0;
    decodedChunks.length = 0;
    videoDecoders.length = 0;

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
    } else {
      delete (URL as { createObjectURL?: typeof URL.createObjectURL })
        .createObjectURL;
    }

    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL })
        .revokeObjectURL;
    }

    if (hadTransferControlToOffscreen && originalTransferControlToOffscreen) {
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        "transferControlToOffscreen",
        {
          configurable: true,
          writable: true,
          value: originalTransferControlToOffscreen,
        },
      );
    } else {
      delete (
        HTMLCanvasElement.prototype as {
          transferControlToOffscreen?: HTMLCanvasElement["transferControlToOffscreen"];
        }
      ).transferControlToOffscreen;
    }
  });

  it("probes mutually exclusive 2D and WebGL contexts on fresh canvases", async () => {
    const contextModes = new WeakMap<HTMLCanvasElement, "2d" | "webgl">();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      function (this: HTMLCanvasElement, kind: string) {
        const requestedMode = kind === "2d" ? "2d" : "webgl";
        const existingMode = contextModes.get(this);
        if (existingMode && existingMode !== requestedMode) return null;
        contextModes.set(this, requestedMode);
        return {} as RenderingContext;
      } as typeof HTMLCanvasElement.prototype.getContext,
    );

    vi.resetModules();
    const { detectCapabilities } =
      await import("../../src/components/rdp/rdpRenderers");
    expect(detectCapabilities()).toMatchObject({
      canvas2d: true,
      webgl: true,
    });
  });

  it("transfers the target canvas before acquiring any mutually exclusive context", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    let targetContextAcquired = false;
    const targetGetContext = vi.fn(() => {
      targetContextAcquired = true;
      return {} as CanvasRenderingContext2D;
    });
    const transfer = vi.fn(() => {
      if (targetContextAcquired) {
        throw new DOMException(
          "Canvas already has a rendering context",
          "InvalidStateError",
        );
      }
      return new MockOffscreenCanvas(canvas.width, canvas.height);
    });
    Object.defineProperty(canvas, "getContext", {
      configurable: true,
      value: targetGetContext,
    });
    Object.defineProperty(canvas, "transferControlToOffscreen", {
      configurable: true,
      value: transfer,
    });

    const pipeline = new RdpFramePipeline({ scheduling: "vsync" });
    pipeline.attach(canvas, 16, 16, "webcodecs-worker");

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(targetGetContext).not.toHaveBeenCalled();
    expect(pipeline.getRenderer()?.type).toBe("webcodecs-worker");
    pipeline.destroy();
  });

  it("parses RGBA batches inside the offscreen paint worker blob without ReferenceError", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;

    const renderer = createFrameRenderer(
      "offscreen-worker",
      canvas,
    ) as unknown as BoundedOffscreenRenderer;
    expect(renderer.type).toBe("offscreen-worker");

    renderer.paintRegion(1, 2, 2, 2, new Uint8ClampedArray(16).fill(0xaa));
    renderer.present();
    await waitForWorkersToDrain();

    expect(getWorker(renderer).errors).toEqual([]);
    expect(renderer.inFlightBatches.size).toBe(0);
    expect(renderer.inFlightFrames).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
  });

  it("parses view-like RGBA batches inside the offscreen paint worker blob", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;

    const renderer = createFrameRenderer("offscreen-worker", canvas);
    expect(renderer.type).toBe("offscreen-worker");

    getWorker(renderer).postMessage({
      type: "frames",
      batchId: 99,
      buffers: [asOffsetUint8View(buildRgbaRectBuffer())],
    });
    await waitForWorkersToDrain();

    expect(getWorker(renderer).errors).toEqual([]);
  });

  it("bounds a hung offscreen inbox, drops stale pending snapshots, and recovers after ACK drain", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("offscreen-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedOffscreenRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();

    const dirty = new Uint8ClampedArray(2 * 2 * 4).fill(0x44);
    for (let index = 0; index < 4; index += 1) {
      renderer.paintRegion(0, 0, 2, 2, dirty);
      renderer.present();
    }
    expect(renderer.inFlightBatches.size).toBe(4);

    // This complete but undispatched snapshot predates the subsequent loss.
    // It must be discarded rather than being re-epoched and declaring the
    // renderer healthy after the worker resumes.
    renderer.paintRegion(0, 0, 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    renderer.present();
    expect(renderer.pendingFrames).toHaveLength(1);
    renderer.paintRegion(0, 0, 65_535, 65_535, new Uint8ClampedArray(0));
    expect(renderer.pendingFrames).toHaveLength(0);
    expect(renderer.pendingBytes).toBe(0);

    for (let index = 0; index < 1_000; index += 1) {
      renderer.paintRegion(0, 0, 2, 2, dirty);
      renderer.present();
    }

    const heldFrames = worker.heldMessages.filter(
      (message) => (message as { type?: string }).type === "frames",
    );
    expect(heldFrames).toHaveLength(4);
    expect(renderer.inFlightBatches.size).toBeLessThanOrEqual(4);
    expect(renderer.inFlightFrames).toBeLessThanOrEqual(1_024);
    expect(renderer.inFlightBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(renderer.pendingFrames.length).toBeLessThanOrEqual(256);
    expect(renderer.pendingBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);

    worker.resumeProcessing();
    await waitForWorkersToDrain();

    expect(worker.errors).toEqual([]);
    expect(renderer.pendingFrames).toHaveLength(0);
    expect(renderer.pendingBytes).toBe(0);
    expect(renderer.inFlightBatches.size).toBe(0);
    expect(renderer.inFlightFrames).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(recoveryStates).toHaveLength(1);

    // An intervening non-full-width update breaks contiguous tile coverage.
    renderer.paintRegion(0, 0, 16, 8, new Uint8ClampedArray(16 * 8 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    renderer.paintRegion(0, 8, 2, 2, dirty);
    renderer.present();
    await waitForWorkersToDrain();
    renderer.paintRegion(0, 8, 16, 8, new Uint8ClampedArray(16 * 8 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates).toHaveLength(1);

    renderer.paintRegion(0, 0, 16, 8, new Uint8ClampedArray(16 * 8 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    renderer.paintRegion(0, 8, 16, 8, new Uint8ClampedArray(16 * 8 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
      { state: "healthy", reason: undefined },
    ]);
    renderer.destroy();
  });

  it("restarts native offscreen recovery and accepts only fresh acknowledged 4K tiles", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 3_840;
    canvas.height = 2_160;
    const renderer = createFrameRenderer("offscreen-worker", canvas, {
      width: 3_840,
      height: 2_160,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedOffscreenRenderer;
    const topTile = new Uint8ClampedArray(3_840 * 1_080 * 4);
    const bottomTile = new Uint8ClampedArray(3_840 * 1_080 * 4);

    await waitForWorkersToDrain();
    renderer.resetH264Recovery?.("queue-overflow");
    renderer.paintRegion(0, 0, 3_840, 1_080, topTile);
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);

    // A second native loss restarts coverage without opening a duplicate
    // awaiting-recovery episode. The old top tile cannot combine with this
    // newer bottom tile.
    renderer.resetH264Recovery?.("queue-overflow");
    renderer.paintRegion(0, 1_080, 3_840, 1_080, bottomTile);
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates).toHaveLength(1);

    renderer.paintRegion(0, 0, 3_840, 1_080, topTile);
    renderer.present();
    await waitForWorkersToDrain();
    renderer.paintRegion(0, 1_080, 3_840, 1_080, bottomTile);
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
      { state: "healthy", reason: undefined },
    ]);
    expect(getWorker(renderer).errors).toEqual([]);
    renderer.destroy();
  });

  it("rolls back failed offscreen posts, contains resize errors, and clears retained state", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("offscreen-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedOffscreenRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const postSpy = vi.spyOn(worker, "postMessage");
    postSpy.mockImplementationOnce(() => {
      throw new DOMException("Worker transfer failed", "DataCloneError");
    });

    renderer.paintRegion(0, 0, 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    expect(() => renderer.present()).not.toThrow();
    expect(renderer.pendingFrames).toHaveLength(0);
    expect(renderer.pendingBytes).toBe(0);
    expect(renderer.inFlightBatches.size).toBe(0);
    expect(renderer.inFlightFrames).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);

    renderer.paintRegion(0, 0, 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]).toEqual({
      state: "healthy",
      reason: undefined,
    });

    postSpy.mockImplementationOnce(() => {
      throw new DOMException("Worker resize failed", "DataCloneError");
    });
    expect(() => renderer.resize(16, 16)).not.toThrow();
    expect(recoveryStates[recoveryStates.length - 1]).toEqual({
      state: "awaitingRecovery",
      reason: "resize",
    });

    renderer.paintRegion(0, 0, 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    renderer.present();
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]?.state).toBe("healthy");
    expect(worker.errors).toEqual([]);

    renderer.destroy();
    expect(renderer.pendingFrames).toHaveLength(0);
    expect(renderer.pendingBytes).toBe(0);
    expect(renderer.inFlightBatches.size).toBe(0);
    expect(renderer.inFlightFrames).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(renderer.recoveryPending).toBe(false);
    errorSpy.mockRestore();
  });

  it("acknowledges failed offscreen batches when the worker has no 2D context", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    Object.defineProperty(canvas, "transferControlToOffscreen", {
      configurable: true,
      value: () => ({
        width: 16,
        height: 16,
        getContext: () => null,
      }),
    });
    const renderer = createFrameRenderer("offscreen-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedOffscreenRenderer;

    await waitForWorkersToDrain();
    renderer.paintRegion(0, 0, 16, 16, new Uint8ClampedArray(16 * 16 * 4));
    renderer.present();
    await waitForWorkersToDrain();

    expect(getWorker(renderer).errors).toEqual([]);
    expect(renderer.inFlightBatches.size).toBe(0);
    expect(renderer.inFlightFrames).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);
    renderer.destroy();
  });

  it("parses RGBA and NAL buffers inside the WebCodecs worker blob without ReferenceError", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;

      const renderer = createFrameRenderer("webcodecs-worker", canvas, {
        width: 16,
        height: 16,
      }) as unknown as RawBufferRenderer;
      expect(renderer.type).toBe("webcodecs-worker");

      renderer.pushRawBuffer(buildRgbaRectBuffer());
      renderer.pushRawBuffer(buildNalBuffer());
      await waitForWorkersToDrain();

      renderer.pushRawBuffer(buildNalBuffer(4, 4));
      await waitForWorkersToDrain();

      expect(getWorker(renderer).errors).toEqual([]);
      expect(warningSpy.mock.calls).toEqual([
        ["[WebCodecs worker] WebGL2 unavailable, falling back to Canvas2D"],
      ]);
    } finally {
      warningSpy.mockRestore();
    }
  });

  it("parses view-like RGBA and NAL buffers inside the WebCodecs worker blob", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;

      const renderer = createFrameRenderer("webcodecs-worker", canvas, {
        width: 16,
        height: 16,
      });
      expect(renderer.type).toBe("webcodecs-worker");

      const worker = getWorker(renderer);
      worker.postMessage({
        type: "frame",
        data: asOffsetUint8View(buildRgbaRectBuffer()),
      });
      worker.postMessage({
        type: "frame",
        data: asOffsetUint8View(buildNalBuffer()),
      });
      await waitForWorkersToDrain();

      expect(worker.errors).toEqual([]);
      expect(decodedChunks).toHaveLength(1);
      expect(decodedChunks[0].type).toBe("key");
      expect(Array.from(decodedChunks[0].data)).toEqual(
        Array.from(
          annexB(
            [0x67, 0x42, 0x00, 0x1f],
            [0x68, 0xce, 0x06, 0xe2],
            [0x65, 0x88, 0x84, 0x21],
          ),
        ),
      );
      expect(warningSpy.mock.calls).toEqual([
        ["[WebCodecs worker] WebGL2 unavailable, falling back to Canvas2D"],
      ]);
    } finally {
      warningSpy.mockRestore();
    }
  });

  it.each([100, 500, 1_000])(
    "bounds %i pre-ready frames without overshoot",
    (frameCount) => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const renderer = createFrameRenderer("webcodecs-worker", canvas, {
        width: 16,
        height: 16,
      }) as unknown as RawBufferRenderer & {
        pendingBuffers: ArrayBuffer[];
        pendingBytes: number;
      };

      for (let index = 0; index < frameCount; index += 1) {
        renderer.pushRawBuffer(buildRgbaRectBuffer());
      }

      expect(renderer.pendingBuffers.length).toBeLessThanOrEqual(4);
      expect(renderer.pendingBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      renderer.destroy();
    },
  );

  it("deduplicates pre-ready H264 resets while worker initialization is hung", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as RawBufferRenderer & {
      pendingBuffers: ArrayBuffer[];
      pendingBytes: number;
    };
    const worker = getWorker(renderer);
    worker.pauseProcessing();

    for (let index = 0; index < 100; index += 1) {
      renderer.pushRawBuffer(buildNalBuffer(16, 16));
    }

    const heldResets = worker.heldMessages.filter(
      (message) => (message as { type?: string }).type === "reset-h264",
    );
    expect(heldResets).toHaveLength(1);
    expect(renderer.pendingBuffers.length).toBeLessThanOrEqual(4);
    expect(renderer.pendingBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(
      recoveryStates.filter((event) => event.reason === "pre-ready-overflow"),
    ).toEqual([{ state: "awaitingRecovery", reason: "pre-ready-overflow" }]);

    worker.resumeProcessing();
    await waitForWorkersToDrain();
    expect(worker.errors).toEqual([]);
    renderer.destroy();
  });

  it("bounds a hung ready WebCodecs inbox until consumed acknowledgements arrive", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();

    for (let index = 0; index < 1_000; index += 1) {
      renderer.pushRawBuffer(buildRgbaRectBuffer(16, 16));
    }

    const heldFrames = worker.heldMessages.filter(
      (message) => (message as { type?: string }).type === "frame",
    );
    const deferredBytes = renderer.deferredRgba?.byteLength ?? 0;
    expect(heldFrames).toHaveLength(5);
    expect(renderer.inFlightFrames.size).toBeLessThanOrEqual(5);
    expect(renderer.inFlightBytes + deferredBytes).toBeLessThanOrEqual(
      32 * 1024 * 1024,
    );
    expect(renderer.deferredRgba).not.toBeNull();

    worker.resumeProcessing();
    await waitForWorkersToDrain();

    expect(worker.errors).toEqual([]);
    expect(renderer.inFlightFrames.size).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(renderer.deferredRgba).toBeNull();
    renderer.destroy();
  });

  it("replaces deferred RGBA without posting a newer dirty update ahead of it", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();

    const olderDeferred = buildRgbaRectBuffer(16, 16);
    new Uint8Array(olderDeferred, 8)[0] = 0x11;
    renderer.deferredRgba = olderDeferred;
    const newestDeferred = buildRgbaRectBuffer(16, 16);
    new Uint8Array(newestDeferred, 8)[0] = 0x22;
    renderer.pushRawBuffer(newestDeferred);

    const heldFrames = () =>
      worker.heldMessages.filter(
        (message) => (message as { type?: string }).type === "frame",
      ) as Array<{ data: ArrayBuffer }>;
    expect(heldFrames()).toHaveLength(0);
    expect(new Uint8Array(renderer.deferredRgba!, 8)[0]).toBe(0x22);

    renderer.flushDeferredRgba();
    expect(heldFrames()).toHaveLength(1);
    expect(new Uint8Array(heldFrames()[0].data, 8)[0]).toBe(0x22);
    expect(renderer.deferredRgba).toBeNull();

    worker.resumeProcessing();
    await waitForWorkersToDrain();
    expect(worker.errors).toEqual([]);
    expect(renderer.inFlightFrames.size).toBe(0);
    renderer.destroy();
  });

  it("requests one full refresh after RGBA dirty updates are superseded", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();
    for (let index = 0; index < 5; index += 1) {
      renderer.pushRawBuffer(buildRgbaRectBuffer());
    }

    renderer.pushRawBuffer(buildRgbaRectBuffer());
    renderer.pushRawBuffer(buildRgbaRectBuffer());
    renderer.pushRawBuffer(buildRgbaRectBuffer());
    renderer.pushRawBuffer(buildFullRgbaFrameBuffer(16, 16));

    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);
    expect(renderer.deferredRgba).not.toBeNull();
    expect(new DataView(renderer.deferredRgba!).getUint16(0, true)).toBe(0);
    expect(new DataView(renderer.deferredRgba!).getUint16(2, true)).toBe(0);

    worker.resumeProcessing();
    await waitForWorkersToDrain();

    expect(worker.errors).toEqual([]);
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
      { state: "healthy", reason: undefined },
    ]);
    expect(renderer.inFlightFrames.size).toBe(0);
    renderer.destroy();
  });

  it("leaves RGBA recovery only after acknowledged full-width tiles cover the desktop", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();
    for (let index = 0; index < 5; index += 1) {
      renderer.pushRawBuffer(buildRgbaRectBuffer());
    }
    renderer.pushRawBuffer(buildRgbaRectBuffer());
    renderer.pushRawBuffer(buildRgbaRectBuffer());
    worker.resumeProcessing();
    await waitForWorkersToDrain();

    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);

    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 0, 8));
    await waitForWorkersToDrain();
    expect(recoveryStates).toHaveLength(1);

    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 8, 8));
    await waitForWorkersToDrain();
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
      { state: "healthy", reason: undefined },
    ]);
    renderer.destroy();
  });

  it("rolls back ready accounting and requests recovery when frame transfer throws", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(worker, "postMessage").mockImplementationOnce(() => {
      throw new DOMException("Worker transfer failed", "DataCloneError");
    });

    expect(() => renderer.pushRawBuffer(buildRgbaRectBuffer())).not.toThrow();
    expect(renderer.inFlightFrames.size).toBe(0);
    expect(renderer.inFlightBytes).toBe(0);
    expect(recoveryStates).toEqual([
      { state: "awaitingRecovery", reason: "queue-overflow" },
    ]);

    renderer.destroy();
    errorSpy.mockRestore();
  });

  it("recovers pure RGBA resize with acknowledged tiles but never lets RGBA recover a NAL stream", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    renderer.resize(16, 16);
    await waitForWorkersToDrain();
    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 0, 8));
    await waitForWorkersToDrain();
    expect(recoveryStates.filter(({ state }) => state === "healthy")).toEqual(
      [],
    );
    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 8, 8));
    await waitForWorkersToDrain();
    expect(recoveryStates.filter(({ state }) => state === "healthy")).toEqual([
      { state: "healthy", reason: undefined },
    ]);

    renderer.pushRawBuffer(buildNalBuffer(16, 16));
    await waitForWorkersToDrain();
    renderer.resize(16, 16);
    await waitForWorkersToDrain();
    const healthyBeforeRgbaFallback = recoveryStates.filter(
      ({ state }) => state === "healthy",
    ).length;
    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 0, 8));
    renderer.pushRawBuffer(buildFullWidthRgbaTile(16, 8, 8));
    await waitForWorkersToDrain();
    expect(
      recoveryStates.filter(({ state }) => state === "healthy"),
    ).toHaveLength(healthyBeforeRgbaFallback);

    renderer.destroy();
  });

  it("fails a hung stateful NAL inbox into one bounded recovery reset", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as BoundedRawBufferRenderer;

    await waitForWorkersToDrain();
    const worker = getWorker(renderer);
    worker.pauseProcessing();

    for (let index = 0; index < 100; index += 1) {
      renderer.pushRawBuffer(buildNalBuffer(16, 16));
    }

    const heldFrames = worker.heldMessages.filter(
      (message) => (message as { type?: string }).type === "frame",
    );
    const heldResets = worker.heldMessages.filter(
      (message) => (message as { type?: string }).type === "reset-h264",
    );
    expect(heldFrames).toHaveLength(5);
    expect(heldResets).toHaveLength(1);
    expect(renderer.inFlightFrames.size).toBe(5);
    expect(renderer.inFlightBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(
      recoveryStates.filter((event) => event.reason === "queue-overflow"),
    ).toEqual([{ state: "awaitingRecovery", reason: "queue-overflow" }]);

    worker.resumeProcessing();
    await waitForWorkersToDrain();
    expect(worker.errors).toEqual([]);
    expect(renderer.inFlightFrames.size).toBe(0);
    renderer.destroy();
  });

  it("keeps decoder input ordered, uniquely timestamped, and bounded to four pending chunks", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as RawBufferRenderer;

    renderer.pushRawBuffer(buildNalBuffer(16, 16));
    await waitForWorkersToDrain();
    expect(decodedChunks.map((chunk) => chunk.type)).toEqual(["key"]);
    expect(videoDecoders).toHaveLength(1);
    videoDecoders[0].dequeue();
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]).toEqual({
      state: "healthy",
      reason: undefined,
    });

    const delta = annexB([0x41, 0x9a, 0x22]);
    for (let index = 0; index < 5; index += 1) {
      renderer.pushRawBuffer(buildNalBuffer(16, 16, delta));
    }
    await waitForWorkersToDrain();

    expect(decodedChunks.map((chunk) => chunk.type)).toEqual([
      "key",
      "delta",
      "delta",
      "delta",
      "delta",
    ]);
    expect(decodedChunks.map((chunk) => chunk.timestamp)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(new Set(decodedChunks.map((chunk) => chunk.timestamp)).size).toBe(
      decodedChunks.length,
    );
    expect(videoDecoders[0].decodeQueueSize).toBe(0);
    expect(recoveryStates).toContainEqual({
      state: "awaitingRecovery",
      reason: "decoder-overflow",
    });
  });

  it("requires cached SPS and PPS plus IDR to leave recovery; RGBA and deltas cannot", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as RawBufferRenderer;

    renderer.pushRawBuffer(buildNalBuffer(16, 16, annexB([0x41, 0x01, 0x02])));
    renderer.pushRawBuffer(buildRgbaRectBuffer());
    await waitForWorkersToDrain();
    expect(decodedChunks).toHaveLength(0);
    expect(recoveryStates).toContainEqual({
      state: "awaitingRecovery",
      reason: "missing-keyframe",
    });
    expect(recoveryStates).not.toContainEqual({
      state: "healthy",
      reason: undefined,
    });

    renderer.pushRawBuffer(
      buildNalBuffer(16, 16, annexB([0x67, 0x42, 0x00, 0x1f])),
    );
    renderer.pushRawBuffer(
      buildNalBuffer(16, 16, annexB([0x68, 0xce, 0x06, 0xe2])),
    );
    renderer.pushRawBuffer(
      buildNalBuffer(16, 16, annexB([0x65, 0x88, 0x84, 0x21])),
    );
    await waitForWorkersToDrain();
    expect(decodedChunks).toHaveLength(1);
    expect(decodedChunks[0].type).toBe("key");
    expect(Array.from(decodedChunks[0].data)).toEqual(
      Array.from(
        new Uint8Array([
          ...annexB([0x67, 0x42, 0x00, 0x1f]),
          ...annexB([0x68, 0xce, 0x06, 0xe2]),
          ...annexB([0x65, 0x88, 0x84, 0x21]),
        ]),
      ),
    );
    expect(recoveryStates[recoveryStates.length - 1]?.state).toBe(
      "awaitingRecovery",
    );

    videoDecoders[0].dequeue();
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]).toEqual({
      state: "healthy",
      reason: undefined,
    });
  });

  it("clears pre-ready and decoder chains on resize and accepts only the new recovery key output", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as RawBufferRenderer & {
      pendingBuffers: ArrayBuffer[];
      resize(width: number, height: number): void;
    };

    renderer.pushRawBuffer(buildNalBuffer(16, 16));
    expect(renderer.pendingBuffers).toHaveLength(1);
    renderer.resize(32, 24);
    expect(renderer.pendingBuffers).toHaveLength(0);
    await waitForWorkersToDrain();
    expect(decodedChunks).toHaveLength(0);

    renderer.pushRawBuffer(buildNalBuffer(32, 24));
    await waitForWorkersToDrain();
    expect(decodedChunks).toHaveLength(1);
    const oldKeyTimestamp = decodedChunks[0].timestamp;
    videoDecoders[0].emitOutputForTimestamp(oldKeyTimestamp);
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]?.state).toBe("healthy");

    renderer.resize(48, 36);
    await waitForWorkersToDrain();
    renderer.pushRawBuffer(buildNalBuffer(48, 36));
    await waitForWorkersToDrain();
    expect(decodedChunks).toHaveLength(2);
    const newKeyTimestamp = decodedChunks[1].timestamp;
    expect(recoveryStates).toContainEqual({
      state: "awaitingRecovery",
      reason: "resize",
    });

    videoDecoders[0].emitOutputForTimestamp(oldKeyTimestamp);
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]?.state).toBe(
      "awaitingRecovery",
    );

    videoDecoders[0].emitOutputForTimestamp(newKeyTimestamp);
    await waitForWorkersToDrain();
    expect(recoveryStates[recoveryStates.length - 1]).toEqual({
      state: "healthy",
      reason: undefined,
    });
  });

  it("rejects malformed Annex-B units and parameter-set caches above 256 KiB", async () => {
    const recoveryStates: Array<{ state: string; reason?: string }> = [];
    const canvas = document.createElement("canvas");
    const renderer = createFrameRenderer("webcodecs-worker", canvas, {
      width: 16,
      height: 16,
      onH264RecoveryStateChange: (state, reason) => {
        recoveryStates.push({ state, reason });
      },
    }) as unknown as RawBufferRenderer;

    renderer.pushRawBuffer(
      buildNalBuffer(16, 16, new Uint8Array([0x65, 0x01, 0x02])),
    );
    await waitForWorkersToDrain();
    expect(recoveryStates).toContainEqual({
      state: "awaitingRecovery",
      reason: "malformed-access-unit",
    });

    const oversizedSps = new Uint8Array(256 * 1024 + 5);
    oversizedSps.set([0, 0, 0, 1, 0x67]);
    renderer.pushRawBuffer(buildNalBuffer(16, 16, oversizedSps));
    await waitForWorkersToDrain();
    expect(recoveryStates).toContainEqual({
      state: "awaitingRecovery",
      reason: "parameter-set-overflow",
    });
    expect(decodedChunks).toHaveLength(0);
  });
});
