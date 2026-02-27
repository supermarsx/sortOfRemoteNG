/**
 * GIF encoding utilities for RDP canvas recording and SSH terminal export.
 * Uses the `gifenc` library (pure JS, no Web Workers needed).
 */
// @ts-expect-error gifenc has no type declarations
import GIFEncoder, { quantize, applyPalette } from 'gifenc';

export interface GifEncoderOptions {
  width: number;
  height: number;
  /** Delay between frames in milliseconds (default 100 = 10fps) */
  delayMs?: number;
  /** Max colors in palette 2-256 (default 256) */
  maxColors?: number;
  /** Loop count: 0 = infinite, -1 = no loop (default 0) */
  repeat?: number;
}

/**
 * Create a GIF from an array of canvas ImageData frames.
 * Returns a Blob of the encoded GIF.
 */
export function encodeGifFromFrames(
  frames: ImageData[],
  options: GifEncoderOptions,
): Blob {
  const {
    width,
    height,
    delayMs = 100,
    maxColors = 256,
    repeat = 0,
  } = options;

  const gif = GIFEncoder();

  for (let i = 0; i < frames.length; i++) {
    const rgba = frames[i].data;
    const palette = quantize(rgba, maxColors);
    const index = applyPalette(rgba, palette);

    gif.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
      repeat: i === 0 ? repeat : undefined,
    });
  }

  gif.finish();
  const bytes = gif.bytesView();
  return new Blob([bytes], { type: 'image/gif' });
}

/**
 * Captures a canvas element as a single ImageData frame.
 */
export function captureCanvasFrame(canvas: HTMLCanvasElement): ImageData | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// ─── GIF Frame Collector ─────────────────────────────────────────────────

export interface GifFrameCollector {
  /** Capture the current canvas state as a frame */
  captureFrame: () => void;
  /** Stop collecting and encode the GIF */
  encode: () => Blob;
  /** Get the number of captured frames */
  frameCount: () => number;
  /** Clear all captured frames */
  clear: () => void;
}

/**
 * Creates a frame collector that periodically captures a canvas for GIF encoding.
 * Used for RDP GIF recording mode.
 */
export function createGifFrameCollector(
  canvas: HTMLCanvasElement,
  options: Omit<GifEncoderOptions, 'width' | 'height'> = {},
): GifFrameCollector {
  const frames: ImageData[] = [];
  const { delayMs = 100, maxColors = 256, repeat = 0 } = options;

  return {
    captureFrame() {
      const frame = captureCanvasFrame(canvas);
      if (frame) frames.push(frame);
    },
    encode() {
      return encodeGifFromFrames(frames, {
        width: canvas.width,
        height: canvas.height,
        delayMs,
        maxColors,
        repeat,
      });
    },
    frameCount() {
      return frames.length;
    },
    clear() {
      frames.length = 0;
    },
  };
}

// ─── Terminal-to-GIF Renderer ────────────────────────────────────────────

export interface TerminalGifOptions {
  /** Terminal columns */
  cols: number;
  /** Terminal rows */
  rows: number;
  /** Font size in px (default 14) */
  fontSize?: number;
  /** Font family (default 'monospace') */
  fontFamily?: string;
  /** Background color (default '#1e1e1e') */
  bgColor?: string;
  /** Foreground color (default '#cccccc') */
  fgColor?: string;
  /** Max frames to render (default 300) */
  maxFrames?: number;
  /** Min time between sampled frames in ms (default 100) */
  frameSampleIntervalMs?: number;
  /** Max colors in palette (default 64 for smaller files) */
  maxColors?: number;
}

interface TerminalEntry {
  timestamp_ms: number;
  data: string;
  entry_type: 'Output' | 'Input' | { Resize: { cols: number; rows: number } };
}

/**
 * Render SSH recording entries into an animated GIF.
 * Simulates a simple terminal by writing output data into a character grid
 * and rendering each state-change to a canvas, then encoding as GIF.
 */
export function renderTerminalToGif(
  entries: TerminalEntry[],
  options: TerminalGifOptions,
): Blob {
  const {
    cols,
    rows,
    fontSize = 14,
    fontFamily = 'Consolas, "Courier New", monospace',
    bgColor = '#1e1e1e',
    fgColor = '#cccccc',
    maxFrames = 300,
    frameSampleIntervalMs = 100,
    maxColors = 64,
  } = options;

  // Measure character dimensions
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${fontSize}px ${fontFamily}`;
  const charWidth = ctx.measureText('M').width;
  const lineHeight = fontSize * 1.2;

  const canvasWidth = Math.ceil(charWidth * cols) + 16; // 8px padding each side
  const canvasHeight = Math.ceil(lineHeight * rows) + 16;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Simple terminal state
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ' '),
  );
  let cursorRow = 0;
  let cursorCol = 0;

  const frames: ImageData[] = [];

  function renderFrame() {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = fgColor;
    ctx.textBaseline = 'top';

    for (let r = 0; r < rows; r++) {
      const line = grid[r].join('');
      ctx.fillText(line, 8, 8 + r * lineHeight);
    }

    frames.push(ctx.getImageData(0, 0, canvasWidth, canvasHeight));
  }

  // Filter to output entries only
  const outputEntries = entries.filter(
    (e) => e.entry_type === 'Output',
  );

  if (outputEntries.length === 0) {
    renderFrame();
    return encodeGifFromFrames(frames, {
      width: canvasWidth,
      height: canvasHeight,
      delayMs: 1000,
      maxColors,
    });
  }

  // Render initial empty frame
  renderFrame();

  let lastFrameTime = 0;

  for (const entry of outputEntries) {
    // Process each character
    for (const ch of entry.data) {
      if (ch === '\n') {
        cursorCol = 0;
        cursorRow++;
        if (cursorRow >= rows) {
          // Scroll up
          grid.shift();
          grid.push(Array.from({ length: cols }, () => ' '));
          cursorRow = rows - 1;
        }
      } else if (ch === '\r') {
        cursorCol = 0;
      } else if (ch === '\x08') {
        // Backspace
        if (cursorCol > 0) cursorCol--;
      } else if (ch === '\t') {
        cursorCol = Math.min(cursorCol + (8 - (cursorCol % 8)), cols - 1);
      } else if (ch.charCodeAt(0) >= 32) {
        if (cursorCol >= cols) {
          cursorCol = 0;
          cursorRow++;
          if (cursorRow >= rows) {
            grid.shift();
            grid.push(Array.from({ length: cols }, () => ' '));
            cursorRow = rows - 1;
          }
        }
        grid[cursorRow][cursorCol] = ch;
        cursorCol++;
      }
      // Skip ANSI escape sequences (simplified)
      // They'll be rendered as invisible but won't break the grid
    }

    // Sample frame at interval
    const elapsed = entry.timestamp_ms - lastFrameTime;
    if (elapsed >= frameSampleIntervalMs && frames.length < maxFrames) {
      renderFrame();
      lastFrameTime = entry.timestamp_ms;
    }
  }

  // Always render the final frame
  if (frames.length < maxFrames) {
    renderFrame();
  }

  // Calculate per-frame delay from timestamps
  const totalDurationMs = outputEntries[outputEntries.length - 1].timestamp_ms;
  const frameDelayMs = frames.length > 1
    ? Math.max(50, Math.round(totalDurationMs / frames.length))
    : 1000;

  return encodeGifFromFrames(frames, {
    width: canvasWidth,
    height: canvasHeight,
    delayMs: Math.min(frameDelayMs, 500), // Cap at 500ms per frame
    maxColors,
  });
}

/**
 * Strip ANSI escape sequences from terminal data.
 * This is a simplified version - handles the most common sequences.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC sequences
    .replace(/\x1b[()][A-Z0-9]/g, '')     // Character set
    .replace(/\x1b[>=<]/g, '');            // Mode changes
}
