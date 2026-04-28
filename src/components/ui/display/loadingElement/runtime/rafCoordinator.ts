/**
 * Single shared requestAnimationFrame loop. Variants register a tick(now)
 * callback. When no tickers are registered the loop sleeps. Pause control
 * is via deregistration.
 *
 * Why share: with the loading-element shipping into many call sites,
 * having one rAF instead of one-per-orb avoids a long render-batch
 * ordering issue and keeps overhead negligible.
 */

export type Ticker = (nowMs: number) => void;

let running = false;
let rafId: number | null = null;
const tickers = new Set<Ticker>();
let paused = false;

function loop(now: number) {
  if (!running) return;
  if (!paused) {
    for (const fn of tickers) {
      try { fn(now); } catch { /* never let one orb kill the loop */ }
    }
  }
  rafId = requestAnimationFrame(loop);
}

function ensureLoop() {
  if (running) return;
  running = true;
  rafId = requestAnimationFrame(loop);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisChange);
    paused = document.visibilityState === 'hidden';
  }
}

function tearDown() {
  running = false;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisChange);
  }
}

function onVisChange() {
  paused = document.visibilityState === 'hidden';
}

export function subscribeTicker(fn: Ticker): () => void {
  tickers.add(fn);
  ensureLoop();
  return () => {
    tickers.delete(fn);
    if (tickers.size === 0) tearDown();
  };
}
