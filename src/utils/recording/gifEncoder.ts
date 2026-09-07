import { GifWorkerClient } from "./gifWorkerClient";
import {
  GIF_LIMITS,
  validateGifOptions,
  type GifEncoderOptions,
  type GifResult,
} from "./gifProtocol";
export { GIF_LIMITS, type GifEncoderOptions } from "./gifProtocol";

/** Sequential worker export; caller-owned frames are not detached or copied as a batch. */
export async function encodeGifFromFrames(
  frames: ImageData[],
  options: GifEncoderOptions,
  signal?: AbortSignal,
): Promise<Blob> {
  validateGifOptions(options);
  if (!frames.length) throw new Error("No GIF frames were captured.");
  const delay = options.delayMs ?? 100;
  if (
    frames.length * delay >
    (options.maxDurationMs ?? GIF_LIMITS.maxDurationMs)
  )
    throw new Error(
      "GIF export exceeds the duration limit. Choose WebM or MP4.",
    );
  if (signal?.aborted)
    throw new DOMException("GIF encoding cancelled.", "AbortError");
  const client = new GifWorkerClient(options);
  const cancel = () => client.close();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await client.ready;
    for (let i = 0; i < frames.length; i++) {
      if (
        frames[i].width !== options.width ||
        frames[i].height !== options.height
      )
        throw new Error("GIF frame dimensions changed.");
      const result = await client.addFrame(frames[i], i * delay);
      if (result)
        throw new Error(
          "GIF export exceeds the size limit. Choose WebM or MP4.",
        );
    }
    const result = await client.finish(frames.length * delay);
    if (result.durationMs < frames.length * delay)
      throw new Error("GIF export exceeds the size limit. Choose WebM or MP4.");
    return result.blob;
  } finally {
    signal?.removeEventListener("abort", cancel);
    client.close();
  }
}

function captureSize(canvas: HTMLCanvasElement) {
  const scale = Math.min(
    1,
    GIF_LIMITS.maxWidth / canvas.width,
    GIF_LIMITS.maxHeight / canvas.height,
  );
  return {
    width: Math.max(1, Math.floor(canvas.width * scale)),
    height: Math.max(1, Math.floor(canvas.height * scale)),
  };
}

/** The source can be WebGL or worker-owned: never change its rendering context. */
export function captureCanvasFrame(
  canvas: HTMLCanvasElement,
  staging?: HTMLCanvasElement,
): ImageData | null {
  if (!canvas.width || !canvas.height) return null;
  const target = staging ?? document.createElement("canvas");
  if (!staging) Object.assign(target, captureSize(canvas));
  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Unable to create the GIF capture canvas.");
  ctx.drawImage(canvas, 0, 0, target.width, target.height);
  return ctx.getImageData(0, 0, target.width, target.height);
}

export interface GifFrameCollector {
  /** Busy captures allocate no pixels. */
  captureFrame: (timestampMs?: number) => boolean;
  encode: (timestampMs?: number) => Promise<Blob>;
  frameCount: () => number;
  durationMs: () => number | undefined;
  details: () =>
    | { width: number; height: number; durationMs: number; limit?: string }
    | undefined;
  clear: () => void;
}

export function createGifFrameCollector(
  canvas: HTMLCanvasElement,
  options: Omit<GifEncoderOptions, "width" | "height"> & {
    onError?: (error: Error) => void;
    onLimit?: (result: GifResult) => void;
  } = {},
): GifFrameCollector {
  const size = captureSize(canvas);
  validateGifOptions({ ...options, ...size });
  if (!canvas.width || !canvas.height)
    throw new Error("Cannot record an empty canvas.");
  const staging = document.createElement("canvas");
  Object.assign(staging, size);
  const client = new GifWorkerClient({
    ...size,
    delayMs: options.delayMs,
    maxColors: options.maxColors,
    repeat: options.repeat,
    maxDurationMs: options.maxDurationMs,
    maxEncodedBytes: options.maxEncodedBytes,
  });
  const start = performance.now();
  let busy: Promise<void> | null = null;
  let stopping: Promise<Blob> | null = null;
  let count = 0;
  let cleared = false;
  let failure: Error | null = null;
  let result: GifResult | null = null;
  const release = () => {
    staging.width = 0;
    staging.height = 0;
    client.close();
  };
  const complete = (encoded: GifResult) => {
    result = encoded;
    release();
    if (encoded.limit) options.onLimit?.(encoded);
  };
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    release();
    if (!cleared) options.onError?.(failure);
  };
  client.onError = fail;
  void client.ready.catch(fail);
  return {
    captureFrame(timestampMs = performance.now() - start) {
      if (busy || stopping || cleared || failure || result) return false;
      busy = (async () => {
        await client.ready;
        if (cleared || failure) return;
        if (
          timestampMs >= (options.maxDurationMs ?? GIF_LIMITS.maxDurationMs)
        ) {
          complete(
            await client.finish(
              options.maxDurationMs ?? GIF_LIMITS.maxDurationMs,
            ),
          );
          return;
        }
        const frame = captureCanvasFrame(canvas, staging);
        if (!frame) throw new Error("The recording canvas is empty.");
        count++;
        const encoded = await client.addFrame(frame, timestampMs, true);
        if (encoded) complete(encoded);
      })()
        .catch(fail)
        .finally(() => {
          busy = null;
        });
      return true;
    },
    encode(timestampMs = performance.now() - start) {
      if (stopping) return stopping;
      stopping = (async () => {
        await busy;
        if (cleared)
          throw new DOMException("GIF encoding cancelled.", "AbortError");
        if (failure) throw failure;
        if (result) return result.blob;
        await client.ready;
        result = await client.finish(timestampMs);
        return result.blob;
      })().finally(release);
      return stopping;
    },
    frameCount: () => count,
    durationMs: () => result?.durationMs,
    details: () =>
      result
        ? { ...size, durationMs: result.durationMs, limit: result.limit }
        : undefined,
    clear() {
      cleared = true;
      result = null;
      release();
    },
  };
}

export interface TerminalGifOptions {
  cols: number;
  rows: number;
  fontSize?: number;
  fontFamily?: string;
  bgColor?: string;
  fgColor?: string;
  /** Sample the entire timeline within this frame budget (default 300). */
  maxFrames?: number;
  frameSampleIntervalMs?: number;
  maxColors?: number;
  signal?: AbortSignal;
}
interface TerminalEntry {
  timestamp_ms: number;
  data: string;
  entry_type: "Output" | "Input" | { Resize: { cols: number; rows: number } };
}

/** Bounded terminal sampling with timestamp delays and worker encoding. */
export async function renderTerminalToGif(
  entries: TerminalEntry[],
  options: TerminalGifOptions,
): Promise<Blob> {
  const {
    cols,
    rows,
    fontSize = 14,
    fontFamily = 'Consolas, "Courier New", monospace',
    bgColor = "#1e1e1e",
    fgColor = "#cccccc",
    maxColors = 64,
    signal,
  } = options;
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    rows < 1 ||
    cols > 1000 ||
    rows > 1000 ||
    !Number.isFinite(fontSize) ||
    fontSize < 1
  )
    throw new Error("Invalid terminal dimensions for GIF export.");
  let end = 0;
  let hasOutput = false;
  const checkAbort = () => {
    if (signal?.aborted)
      throw new DOMException("GIF encoding cancelled.", "AbortError");
  };
  for (let i = 0; i < entries.length; i++) {
    if (i % 256 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkAbort();
    }
    const entry = entries[i];
    if (entry.entry_type !== "Output") continue;
    if (!Number.isFinite(entry.timestamp_ms) || entry.timestamp_ms < end)
      throw new Error("Invalid terminal recording timestamps.");
    end = entry.timestamp_ms;
    hasOutput = true;
  }
  if (end + 100 > GIF_LIMITS.maxDurationMs)
    throw new Error(
      "GIF export is limited to 5 minutes. Export as asciicast instead.",
    );
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Unable to create the terminal GIF canvas.");
  ctx.font = `${fontSize}px ${fontFamily}`;
  const charWidth = ctx.measureText("M").width;
  const lineHeight = fontSize * 1.2;
  const nativeWidth = Math.ceil(charWidth * cols) + 16;
  const nativeHeight = Math.ceil(lineHeight * rows) + 16;
  const scale = Math.min(
    1,
    GIF_LIMITS.maxWidth / nativeWidth,
    GIF_LIMITS.maxHeight / nativeHeight,
  );
  canvas.width = Math.max(1, Math.floor(nativeWidth * scale));
  canvas.height = Math.max(1, Math.floor(nativeHeight * scale));
  const client = new GifWorkerClient({
    width: canvas.width,
    height: canvas.height,
    maxColors,
  });
  const cancel = () => client.close();
  signal?.addEventListener("abort", cancel, { once: true });
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array<string>(cols).fill(" "),
  );
  let cursorRow = 0;
  let cursorCol = 0;
  const scroll = () => {
    if (cursorRow >= rows) {
      grid.shift();
      grid.push(Array<string>(cols).fill(" "));
      cursorRow = rows - 1;
    }
  };
  const render = async (timestampMs: number) => {
    checkAbort();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, nativeWidth, nativeHeight);
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = fgColor;
    ctx.textBaseline = "top";
    for (let r = 0; r < rows; r++)
      ctx.fillText(grid[r].join(""), 8, 8 + r * lineHeight);
    const result = await client.addFrame(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      timestampMs,
      true,
    );
    if (result)
      throw new Error(
        "Terminal GIF exceeds the 64 MiB size limit. Export as asciicast instead.",
      );
  };
  try {
    checkAbort();
    await client.ready;
    await render(0);
    const frameBudget = Math.max(3, Math.min(300, options.maxFrames ?? 300));
    const interval = Math.max(
      100,
      options.frameSampleIntervalMs ?? 100,
      end / (frameBudget - 2),
    );
    let nextFrameTime = 0;
    let renderedFrames = 1;
    let lastRenderedTime = 0;
    let processed = 0;
    let nextOutputIndex = 0;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];
      if (entry.entry_type !== "Output") continue;
      nextOutputIndex = Math.max(nextOutputIndex, entryIndex + 1);
      while (
        nextOutputIndex < entries.length &&
        entries[nextOutputIndex].entry_type !== "Output"
      ) {
        if (nextOutputIndex % 256 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          checkAbort();
        }
        nextOutputIndex++;
      }
      const beforeIdleGap =
        (entries[nextOutputIndex]?.timestamp_ms ?? end) - entry.timestamp_ms >=
        Math.min(interval, 1000);
      for (const ch of entry.data) {
        if (++processed % 8192 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          checkAbort();
        }
        if (ch === "\n") {
          cursorCol = 0;
          cursorRow++;
          scroll();
        } else if (ch === "\r") cursorCol = 0;
        else if (ch === "\x08") cursorCol = Math.max(0, cursorCol - 1);
        else if (ch === "\t")
          cursorCol = Math.min(cursorCol + (8 - (cursorCol % 8)), cols - 1);
        else if (ch.charCodeAt(0) >= 32) {
          if (cursorCol >= cols) {
            cursorCol = 0;
            cursorRow++;
            scroll();
          }
          grid[cursorRow][cursorCol++] = ch;
        }
      }
      // Render the initial output at its own timestamp: an idle period must
      // show that terminal state, not the earlier empty canvas. Reserve one
      // frame for the final state and coalesce entries sharing a timestamp.
      if (
        entry.timestamp_ms < end &&
        (((entry.timestamp_ms >= nextFrameTime || beforeIdleGap) &&
          renderedFrames < frameBudget - 1) ||
          entry.timestamp_ms === lastRenderedTime)
      ) {
        await render(entry.timestamp_ms);
        if (entry.timestamp_ms > lastRenderedTime) renderedFrames++;
        lastRenderedTime = entry.timestamp_ms;
        nextFrameTime = entry.timestamp_ms + interval;
      }
    }
    if (hasOutput) await render(end);
    const result = await client.finish(hasOutput ? end + 100 : 1000);
    if (result.limit)
      throw new Error(
        "Terminal GIF exceeds the export limit. Export as asciicast instead.",
      );
    return result.blob;
  } finally {
    signal?.removeEventListener("abort", cancel);
    client.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function stripAnsi(str: string): string {
  const esc = "\u001b";
  const bell = "\u0007";
  return str
    .replace(new RegExp(`${esc}\\[[0-9;]*[a-zA-Z]`, "g"), "")
    .replace(new RegExp(`${esc}\\][^${bell}]*${bell}`, "g"), "")
    .replace(new RegExp(`${esc}[()][A-Z0-9]`, "g"), "")
    .replace(new RegExp(`${esc}[>=<]`, "g"), "");
}
