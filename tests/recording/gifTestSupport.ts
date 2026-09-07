import { vi } from "vitest";
import { IncrementalGifEncoder } from "../../src/utils/recording/gifEncodingCore";
import type {
  GifRequest,
  GifResponse,
} from "../../src/utils/recording/gifProtocol";

export const pixels = (
  width = 2,
  height = 2,
  color = [255, 0, 0, 255],
): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return { width, height, data, colorSpace: "srgb" };
};

/** Deterministic worker transport using the actual codec; can hold a busy worker. */
export class TestGifWorker {
  static instances: TestGifWorker[] = [];
  static automatic = true;
  static responseDelay = 1;
  onmessage: ((event: MessageEvent<GifResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  queue: GifRequest[] = [];
  messages: GifRequest[] = [];
  terminated = false;
  private encoder: IncrementalGifEncoder | null = null;
  constructor() {
    TestGifWorker.instances.push(this);
  }
  postMessage(message: GifRequest, transfer?: Transferable[]) {
    // Transfer semantics catch use-after-detach errors while avoiding retained RGBA history.
    const cloned = structuredClone(message, { transfer });
    this.queue.push(cloned);
    this.messages.push(
      message.type === "frame"
        ? { ...message, rgba: new ArrayBuffer(0) }
        : message,
    );
    if (TestGifWorker.automatic)
      setTimeout(() => this.flush(), TestGifWorker.responseDelay);
  }
  flush() {
    if (this.terminated) return;
    const message = this.queue.shift();
    if (!message) return;
    let response: GifResponse;
    try {
      if (message.type === "init") {
        this.encoder = new IncrementalGifEncoder(message.options);
        response = { type: "ready" };
      } else {
        const result =
          message.type === "frame"
            ? this.encoder!.addFrame(message.rgba, message.timestampMs)
            : this.encoder!.finish(message.timestampMs);
        response = result ? { type: "done", result } : { type: "frame" };
      }
    } catch (error) {
      response = { type: "error", message: String(error) };
    }
    this.onmessage?.({ data: response } as MessageEvent<GifResponse>);
  }
  terminate() {
    this.terminated = true;
    this.queue = [];
    this.encoder = null;
  }
}

export function installGifWorker() {
  TestGifWorker.instances = [];
  TestGifWorker.automatic = true;
  TestGifWorker.responseDelay = 1;
  vi.stubGlobal("Worker", TestGifWorker);
}

export function mockCaptureCanvas() {
  const drawImage = vi.fn();
  const getImageData = vi.fn(
    (_x: number, _y: number, width: number, height: number) =>
      pixels(width, height),
  );
  const fillText = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      drawImage,
      getImageData,
      fillText,
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      measureText: () => ({ width: 8 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  return { drawImage, getImageData, fillText };
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (blob.arrayBuffer) return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

/** Parse the GIF container, palettes, frame boundaries and delays independently of gifenc. */
export function parseGif(bytes: Uint8Array) {
  const u16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
  if (String.fromCharCode(...bytes.subarray(0, 6)) !== "GIF89a")
    throw new Error("Invalid GIF header");
  const width = u16(6),
    height = u16(8);
  let offset = 13;
  let palette = new Uint8Array();
  if (bytes[10] & 0x80) {
    const size = 3 * (2 << (bytes[10] & 7));
    palette = bytes.slice(offset, offset + size);
    offset += size;
  }
  let delay = 0;
  const frames: {
    width: number;
    height: number;
    delay: number;
    palette: Uint8Array;
    compressed: Uint8Array;
    minCodeSize: number;
  }[] = [];
  const subBlocks = () => {
    const data: number[] = [];
    while (bytes[offset]) {
      const size = bytes[offset++];
      data.push(...bytes.subarray(offset, offset + size));
      offset += size;
      if (offset >= bytes.length) throw new Error("Truncated GIF");
    }
    offset++;
    return Uint8Array.from(data);
  };
  while (offset < bytes.length) {
    const type = bytes[offset++];
    if (type === 0x3b) {
      if (offset !== bytes.length) throw new Error("Trailing GIF garbage");
      return { width, height, frames };
    }
    if (type === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) delay = u16(offset + 2) * 10;
      subBlocks();
    } else if (type === 0x2c) {
      const frameWidth = u16(offset + 4),
        frameHeight = u16(offset + 6),
        packed = bytes[offset + 8];
      offset += 9;
      let localPalette = palette;
      if (packed & 0x80) {
        const size = 3 * (2 << (packed & 7));
        localPalette = bytes.slice(offset, offset + size);
        offset += size;
      }
      const minCodeSize = bytes[offset++];
      frames.push({
        width: frameWidth,
        height: frameHeight,
        delay,
        palette: localPalette,
        compressed: subBlocks(),
        minCodeSize,
      });
    } else throw new Error(`Invalid GIF block ${type}`);
  }
  throw new Error("Missing GIF trailer");
}

/** Independent GIF LZW decoder for pixel round-trip assertions. */
export function decodeIndices(
  frame: ReturnType<typeof parseGif>["frames"][number],
) {
  const clear = 1 << frame.minCodeSize,
    end = clear + 1;
  let dictionary: number[][] = [],
    bits = frame.minCodeSize + 1,
    position = 0;
  let previous: number[] | null = null;
  const output: number[] = [];
  const reset = () => {
    dictionary = Array.from({ length: clear }, (_, i) => [i]);
    dictionary.push([], []);
    bits = frame.minCodeSize + 1;
    previous = null;
  };
  reset();
  for (;;) {
    if (position + bits > frame.compressed.length * 8)
      throw new Error("Truncated LZW data");
    let code = 0;
    for (let i = 0; i < bits; i++, position++)
      code |= ((frame.compressed[position >> 3] >> (position & 7)) & 1) << i;
    if (code === clear) {
      reset();
      continue;
    }
    if (code === end) return output;
    const value: number[] | null =
      dictionary[code] ??
      (previous && code === dictionary.length
        ? [...previous, previous[0]]
        : null);
    if (!value) throw new Error("Invalid LZW code");
    output.push(...value);
    if (previous) {
      dictionary.push([...previous, value[0]]);
      if (dictionary.length === 1 << bits && bits < 12) bits++;
    }
    previous = value;
  }
}
