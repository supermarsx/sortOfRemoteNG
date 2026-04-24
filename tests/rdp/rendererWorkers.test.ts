import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameRenderer, type FrameRenderer } from '../../src/components/rdp/rdpRenderers';

type WorkerMessage = { data: unknown };
type WorkerMessageHandler = ((event: WorkerMessage) => void) | null;
type WorkerEventSink = { onmessage: WorkerMessageHandler };
type RawBufferRenderer = FrameRenderer & {
  pushRawBuffer: (data: ArrayBuffer) => void;
};

const workerBlobs = new Map<string, string>();
const workers: MockWorker[] = [];
const NAL_MAGIC = 0x4E414C48;

let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;
let originalTransferControlToOffscreen: HTMLCanvasElement['transferControlToOffscreen'] | undefined;
let hadTransferControlToOffscreen = false;

class MockImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height ?? dataOrWidth.length / (4 * widthOrHeight);
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
    this.source = parts.map((part) => String(part)).join('');
    this.type = options?.type ?? '';
  }
}

class MockEncodedVideoChunk {
  type: 'key' | 'delta';
  timestamp: number;
  data: Uint8Array;

  constructor(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.data = init.data;
  }
}

class MockVideoDecoder {
  constructor(_init: {
    output: (_frame: unknown) => void;
    error: (_error: unknown) => void;
  }) {}

  configure(_config: Record<string, unknown>): void {}

  decode(_chunk: MockEncodedVideoChunk): void {}

  close(): void {}
}

function create2dContext(canvas: MockOffscreenCanvas) {
  return {
    canvas,
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
    if (kind === '2d') {
      this.ctx2d ??= create2dContext(this);
      return this.ctx2d;
    }
    return null;
  }
}

class MockWorker implements WorkerEventSink {
  onmessage: WorkerMessageHandler = null;
  readonly errors: unknown[] = [];
  private readonly scope: WorkerEventSink & {
    postMessage: (data: unknown) => void;
  };
  private pending: Promise<void>;

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
            'self',
            'console',
            'ImageData',
            'VideoDecoder',
            'EncodedVideoChunk',
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
      : Promise.reject(new Error(`No worker blob registered for ${url}`))
      .catch((error) => {
        this.errors.push(error);
      });

    workers.push(this);
  }

  postMessage(data: unknown): void {
    this.pending = this.pending
      .then(() => {
        this.scope.onmessage?.({ data });
      })
      .catch((error) => {
        this.errors.push(error);
      });
  }

  terminate(): void {}

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

function buildNalBuffer(destW = 2, destH = 2): ArrayBuffer {
  const nalPayload = new Uint8Array([0x65, 0x88, 0x84, 0x21]);
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

function getWorker(renderer: unknown): MockWorker {
  const worker = (renderer as { worker?: MockWorker }).worker;
  if (!worker) {
    throw new Error('Expected renderer to expose a worker instance');
  }
  return worker;
}

async function waitForWorkersToDrain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.all(workers.map((worker) => worker.whenIdle()));
    await Promise.resolve();
  }
}

describe('rdp worker blobs', () => {
  beforeEach(() => {
    workerBlobs.clear();
    workers.length = 0;

    vi.stubGlobal('ImageData', MockImageData as typeof ImageData);
    vi.stubGlobal('Blob', MockBlob as unknown as typeof Blob);
    vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas as unknown as typeof OffscreenCanvas);
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    vi.stubGlobal('VideoDecoder', MockVideoDecoder as unknown as typeof VideoDecoder);
    vi.stubGlobal('EncodedVideoChunk', MockEncodedVideoChunk as unknown as typeof EncodedVideoChunk);

    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn((blob: MockBlob) => {
        const url = `blob:worker-${workerBlobs.size + 1}`;
        workerBlobs.set(url, blob.source);
        return url;
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    hadTransferControlToOffscreen = Object.prototype.hasOwnProperty.call(
      HTMLCanvasElement.prototype,
      'transferControlToOffscreen',
    );
    originalTransferControlToOffscreen = HTMLCanvasElement.prototype.transferControlToOffscreen;
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      writable: true,
      value(this: HTMLCanvasElement) {
        return new MockOffscreenCanvas(this.width, this.height);
      },
    });

    const getContextMock = ((kind: string) => {
      if (kind === '2d') {
        return {} as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContextMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    workerBlobs.clear();
    workers.length = 0;

    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
    } else {
      delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
    }

    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
    }

    if (hadTransferControlToOffscreen && originalTransferControlToOffscreen) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
        configurable: true,
        writable: true,
        value: originalTransferControlToOffscreen,
      });
    } else {
      delete (HTMLCanvasElement.prototype as { transferControlToOffscreen?: HTMLCanvasElement['transferControlToOffscreen'] }).transferControlToOffscreen;
    }
  });

  it('parses RGBA batches inside the offscreen paint worker blob without ReferenceError', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;

    const renderer = createFrameRenderer('offscreen-worker', canvas);
    expect(renderer.type).toBe('offscreen-worker');

    renderer.paintRegion(1, 2, 2, 2, new Uint8ClampedArray(16).fill(0xaa));
    renderer.present();
    await waitForWorkersToDrain();

    expect(getWorker(renderer).errors).toEqual([]);
  });

  it('parses RGBA and NAL buffers inside the WebCodecs worker blob without ReferenceError', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;

    const renderer = createFrameRenderer(
      'webcodecs-worker',
      canvas,
      { width: 16, height: 16 },
    ) as unknown as RawBufferRenderer;
    expect(renderer.type).toBe('webcodecs-worker');

    renderer.pushRawBuffer(buildRgbaRectBuffer());
    renderer.pushRawBuffer(buildNalBuffer());
    await waitForWorkersToDrain();

    renderer.pushRawBuffer(buildNalBuffer(4, 4));
    await waitForWorkersToDrain();

    expect(getWorker(renderer).errors).toEqual([]);
  });
});