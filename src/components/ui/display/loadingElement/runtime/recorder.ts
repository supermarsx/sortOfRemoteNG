/**
 * Offscreen recorder for loading-element variants.
 *
 * Mounts a real <LoadingElement> into a hidden div, finds the <canvas> the
 * variant rendered into (canvas-mode only), pipes its captureStream() into a
 * MediaRecorder, and returns the encoded Blob.
 *
 * Pure-CSS / DOM-only variants are not yet supported — this v1 ships the
 * canvas-mode pipeline. html2canvas is intentionally NOT a dependency, so for
 * those variants we reject with a clear message and let the UI surface it.
 */

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoadingElement } from '../LoadingElement';
import type { LoadingElementType, VariantConfig } from '../types';

export interface RecordOptions {
  type: LoadingElementType;
  config: VariantConfig;
  color: string;
  sizePx: number;
  frameRate: 24 | 30 | 60;
  durationSeconds: number;
  onProgress?: (frac: number) => void;
}

export interface RecordResult {
  blob: Blob;
  mime: string;
}

/** Resolve after the next animation frame (browser-only). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(() => resolve(), 16);
    }
  });
}

/** Pick a supported MediaRecorder mime, preferring webp then webm. */
function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'image/webp',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function recordLoadingElement(opts: RecordOptions): Promise<RecordResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('Precompute requires a DOM environment.');
  }

  const mime = pickMime();
  if (!mime) {
    throw new Error('MediaRecorder is not available in this environment.');
  }

  const host = document.createElement('div');
  host.setAttribute('data-loading-element-recorder', '1');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0px';
  host.style.width = `${opts.sizePx}px`;
  host.style.height = `${opts.sizePx}px`;
  host.style.pointerEvents = 'none';
  host.style.opacity = '1';
  document.body.appendChild(host);

  let root: Root | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  const cleanup = (): void => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      // ignore
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
    }
    if (root) {
      try { root.unmount(); } catch { /* ignore */ }
    }
    if (host.parentNode) host.parentNode.removeChild(host);
  };

  try {
    root = createRoot(host);

    // Render the real dispatcher and force canvas mode — we need a pixel
    // surface to capture from. Variants that don't support canvas will fail
    // the canvas-detection check below, and we surface a clear error.
    root.render(
      React.createElement(LoadingElement, {
        type: opts.type,
        config: opts.config as Partial<VariantConfig>,
        color: opts.color,
        size: opts.sizePx,
        fallbackMode: 'never',
        forceRenderMode: 'canvas',
      }),
    );

    // Two rAFs gives React a chance to mount, the variant a chance to do its
    // first paint, and the canvas to acquire a non-empty framebuffer.
    await nextFrame();
    await nextFrame();

    const canvas = host.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error(
        `Precompute not yet supported for variant "${opts.type}" — variant did not render to a canvas.`,
      );
    }

    if (typeof canvas.captureStream !== 'function') {
      throw new Error('canvas.captureStream is not available in this browser.');
    }

    stream = canvas.captureStream(opts.frameRate);
    recorder = new MediaRecorder(stream, { mimeType: mime });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const stopped = new Promise<void>((resolve, reject) => {
      if (!recorder) {
        reject(new Error('Recorder not initialised.'));
        return;
      }
      recorder.onstop = () => resolve();
      recorder.onerror = (ev: Event) => {
        const err = (ev as unknown as { error?: Error }).error;
        reject(err ?? new Error('MediaRecorder error.'));
      };
    });

    recorder.start();

    // Progress ticker — independent of how often dataavailable fires.
    if (opts.onProgress) {
      const startedAt = performance.now();
      const totalMs = opts.durationSeconds * 1000;
      progressTimer = setInterval(() => {
        const frac = Math.min(1, (performance.now() - startedAt) / totalMs);
        opts.onProgress?.(frac);
      }, 100);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, opts.durationSeconds * 1000));

    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if (opts.onProgress) opts.onProgress(1);

    const blob = new Blob(chunks, { type: mime });
    return { blob, mime };
  } finally {
    cleanup();
  }
}
