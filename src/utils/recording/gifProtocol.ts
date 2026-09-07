export const GIF_LIMITS = {
  maxWidth: 1280,
  maxHeight: 720,
  maxDurationMs: 5 * 60 * 1000,
  maxEncodedBytes: 64 * 1024 * 1024,
} as const;

export interface GifEncoderOptions {
  width: number;
  height: number;
  delayMs?: number;
  maxColors?: number;
  repeat?: number;
  /** May lower, but never raise, the resource limits. */
  maxDurationMs?: number;
  maxEncodedBytes?: number;
}

export interface GifResult {
  blob: Blob;
  durationMs: number;
  limit?: string;
}

export type GifRequest =
  | { type: "init"; options: GifEncoderOptions }
  | { type: "frame"; rgba: ArrayBuffer; timestampMs: number }
  | { type: "finish"; timestampMs: number };

export type GifResponse =
  | { type: "ready" }
  | { type: "frame" }
  | { type: "done"; result: GifResult }
  | { type: "error"; message: string };

export function validateGifOptions(options: GifEncoderOptions) {
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width < 1 ||
    options.height < 1 ||
    options.width > GIF_LIMITS.maxWidth ||
    options.height > GIF_LIMITS.maxHeight
  )
    throw new Error("GIF dimensions must be between 1×1 and 1280×720 pixels.");
  if (
    options.maxColors !== undefined &&
    (!Number.isInteger(options.maxColors) ||
      options.maxColors < 2 ||
      options.maxColors > 256)
  ) {
    throw new Error("GIF palettes require 2–256 colors.");
  }
  for (const [key, maximum] of [
    ["maxDurationMs", GIF_LIMITS.maxDurationMs],
    ["maxEncodedBytes", GIF_LIMITS.maxEncodedBytes],
  ] as const) {
    const value = options[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 1 || value > maximum)
    )
      throw new Error(`Invalid GIF ${key} limit.`);
  }
  if (
    options.delayMs !== undefined &&
    (!Number.isFinite(options.delayMs) ||
      options.delayMs < 20 ||
      options.delayMs > GIF_LIMITS.maxDurationMs)
  )
    throw new Error("Invalid GIF frame delay.");
}
