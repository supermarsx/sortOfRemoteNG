// This module is loaded by the encoder worker only (and codec tests).
// @ts-expect-error gifenc does not ship declarations
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import {
  GIF_LIMITS,
  validateGifOptions,
  type GifEncoderOptions,
  type GifResult,
} from "./gifProtocol";

/** Retains encoded chunks and one indexed frame, never a recording of RGBA frames. */
export class IncrementalGifEncoder {
  private gif = GIFEncoder({ auto: false });
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private bytes = 0;
  private writtenFrames = 0;
  private writtenUntil = 0;
  private pending: {
    index: Uint8Array;
    palette: number[][];
    timestampMs: number;
  } | null = null;
  private result: GifResult | null = null;
  private readonly durationLimit: number;
  private readonly byteLimit: number;

  constructor(private options: GifEncoderOptions) {
    validateGifOptions(options);
    this.durationLimit = options.maxDurationMs ?? GIF_LIMITS.maxDurationMs;
    this.byteLimit = options.maxEncodedBytes ?? GIF_LIMITS.maxEncodedBytes;
  }

  addFrame(rgba: ArrayBuffer, timestampMs: number): GifResult | null {
    if (this.result) return this.result;
    if (rgba.byteLength !== this.options.width * this.options.height * 4)
      throw new Error("GIF frame dimensions changed.");
    this.validateTime(timestampMs);
    if (timestampMs >= this.durationLimit)
      return this.finish(
        this.durationLimit,
        "GIF duration limit reached; the captured portion was saved.",
      );
    if (
      this.pending &&
      timestampMs > this.pending.timestampMs &&
      !this.writePending(timestampMs)
    )
      return this.complete(
        "GIF size limit reached; the captured portion was saved.",
      );
    const pixels = new Uint8ClampedArray(rgba);
    const palette = quantize(pixels, this.options.maxColors ?? 256);
    this.pending = {
      index: applyPalette(pixels, palette),
      palette,
      timestampMs,
    };
    return null;
  }

  finish(timestampMs: number, limit?: string): GifResult {
    if (this.result) return this.result;
    this.validateTime(timestampMs);
    if (!this.pending && !this.writtenFrames)
      throw new Error("No GIF frames were captured.");
    const end = Math.min(timestampMs, this.durationLimit);
    if (timestampMs >= this.durationLimit)
      limit ??= "GIF duration limit reached; the captured portion was saved.";
    if (this.pending && !this.writePending(end))
      limit = "GIF size limit reached; the captured portion was saved.";
    return this.complete(limit);
  }

  private validateTime(timestampMs: number) {
    if (
      !Number.isFinite(timestampMs) ||
      timestampMs < 0 ||
      (this.pending && timestampMs < this.pending.timestampMs)
    )
      throw new Error("Invalid GIF frame timestamp.");
  }

  private writePending(end: number): boolean {
    const frame = this.pending!;
    // Round absolute boundaries, avoiding accumulated centisecond rounding drift.
    const delay = Math.max(
      20,
      Math.round(end / 10) * 10 - Math.round(frame.timestampMs / 10) * 10,
    );
    if (!this.writtenFrames) this.gif.writeHeader();
    this.gif.writeFrame(frame.index, this.options.width, this.options.height, {
      first: this.writtenFrames === 0,
      palette: frame.palette,
      delay,
      repeat: this.options.repeat ?? 0,
    });
    const chunk: Uint8Array<ArrayBuffer> = this.gif.bytes();
    this.gif.stream.reset();
    this.pending = null;
    // Reserve the trailer. The temporary overshoot is at most one bounded frame.
    if (this.bytes + chunk.byteLength + 1 > this.byteLimit) return false;
    this.chunks.push(chunk);
    this.bytes += chunk.byteLength;
    this.writtenFrames++;
    this.writtenUntil = Math.round(frame.timestampMs / 10) * 10 + delay;
    return true;
  }

  private complete(limit?: string): GifResult {
    if (!this.writtenFrames)
      throw new Error("GIF size limit is too small to hold one frame.");
    const blob = new Blob([...this.chunks, new Uint8Array([0x3b])], {
      type: "image/gif",
    });
    this.chunks = [];
    this.pending = null;
    this.gif = null;
    this.result = { blob, durationMs: this.writtenUntil, limit };
    return this.result;
  }
}
