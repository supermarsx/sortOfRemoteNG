/**
 * Shared document-visibility store, visible-aware interval, and the single 1 s
 * tick store. Background lane only: do not gate real-time I/O on visibility.
 */

const subs = new Set<() => void>();
let hidden =
  typeof document !== "undefined"
    ? document.visibilityState === "hidden"
    : false;
let wired = false;

function onChange() {
  const next = document.visibilityState === "hidden";
  if (next === hidden) return;
  hidden = next;
  for (const cb of [...subs]) cb();
}

function wire() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", onChange);
}

export function isHidden(): boolean {
  return hidden;
}

/** Re-read document.visibilityState (tests set it then call this or dispatch the event). */
export function refreshVisibility(): void {
  if (typeof document === "undefined") return;
  hidden = !(document.visibilityState !== "hidden");
  onChange();
}

export function subscribeVisibility(cb: () => void): () => void {
  wire();
  subs.add(cb);
  return () => subs.delete(cb);
}

export interface VisibleIntervalOptions {
  /** "pause" (default) stops while hidden; a number polls at that slower ms. */
  hidden?: "pause" | number;
  /** Call once right away (default false). */
  immediate?: boolean;
}

/**
 * setInterval that pauses (or slows) while the document is hidden. On
 * becoming visible it fires ONE catch-up call if a tick was due, then resumes
 * the cadence; missed ticks are never replayed in a burst.
 */
export function createVisibleInterval(
  cb: () => void,
  ms: number,
  options: VisibleIntervalOptions = {},
): () => void {
  const hiddenMode = options.hidden ?? "pause";
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastRun = Date.now();
  let stopped = false;

  const run = () => {
    lastRun = Date.now();
    cb();
  };
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const apply = () => {
    if (stopped) return;
    stopTimer();
    if (isHidden()) {
      if (hiddenMode === "pause") return;
      timer = setInterval(run, Math.max(ms, hiddenMode));
      return;
    }
    timer = setInterval(run, ms);
  };

  const unsub = subscribeVisibility(() => {
    if (stopped) return;
    const wasPaused = timer === undefined;
    apply();
    if (!isHidden() && wasPaused && Date.now() - lastRun >= ms) run();
  });
  if (options.immediate && !isHidden()) run();
  apply();
  return () => {
    stopped = true;
    stopTimer();
    unsub();
  };
}

// ── shared 1 s tick ───────────────────────────────────────────────────────

const TICK_MS = 1000;
const tickSubs = new Set<() => void>();
let tickNow = Date.now();
let tickStop: (() => void) | undefined;

function tickRun() {
  tickNow = Date.now();
  for (const cb of [...tickSubs]) cb();
}

/** One timer for every elapsed-time UI; paused while hidden. */
export const tickStore = {
  subscribe(cb: () => void): () => void {
    tickSubs.add(cb);
    if (!tickStop) {
      tickNow = Date.now();
      tickStop = createVisibleInterval(tickRun, TICK_MS);
    }
    return () => {
      tickSubs.delete(cb);
      if (tickSubs.size === 0 && tickStop) {
        tickStop();
        tickStop = undefined;
      }
    };
  },
  /** Current tick time (ms epoch), stable between ticks. */
  getSnapshot(): number {
    return tickNow;
  },
  /** Seconds bucket: changes every `everyN` seconds. */
  bucket(everyN = 1): number {
    return Math.floor(tickNow / (TICK_MS * Math.max(1, everyN)));
  },
  get subscribers(): number {
    return tickSubs.size;
  },
};
