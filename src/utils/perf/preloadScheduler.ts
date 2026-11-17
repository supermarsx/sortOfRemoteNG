/**
 * Idle-time preload scheduler.
 *
 * - Priorities 0 (critical, runs even when busy) .. 3 (lowest).
 * - Drains in slices bounded by a frame budget; up to `maxConcurrent` async
 *   tasks at once.
 * - Defers (does not drop) while the user is busy (input within 150 ms, busy
 *   probes such as a high-rate terminal) or the document is hidden.
 * - `requires: "unlocked"` tasks never run unless the lock state is explicitly
 *   "unlocked"; they are dropped when the app locks. `secret: true` tasks are
 *   rejected at registration. The scheduler never calls any unlock/prompt path.
 */
import { metrics } from "./metrics";
import {
  isUnlockedForPreload,
  onLockStateChange,
  onCachesCleared,
} from "./safety";
import { isHidden } from "./visibility";

export type PreloadPriority = 0 | 1 | 2 | 3;

export interface PreloadTask {
  id: string;
  priority?: PreloadPriority;
  /** Rough cost in ms; a task costing more than the remaining slice waits for the next slice. */
  cost?: number;
  run: () => void | Promise<unknown>;
  requires?: "unlocked";
  /** Must be false/absent: secret preloads are forbidden. */
  secret?: false;
}

export interface SchedulerEnv {
  now: () => number;
  /** Run `fn` when idle. Returns cancel. */
  idle: (fn: () => void) => () => void;
  isBusy: () => boolean;
  isHidden: () => boolean;
  isUnlocked: () => boolean;
}

export interface SchedulerOptions {
  frameBudgetMs?: number;
  maxConcurrent?: number;
  /** Re-check delay while busy/hidden. Default 250. */
  busyRetryMs?: number;
}

const BUSY_WINDOW_MS = 150;
let lastInputAt = -Infinity;
const busyProbes = new Set<() => boolean>();
let inputWired = false;

function wireInput() {
  if (inputWired || typeof window === "undefined") return;
  inputWired = true;
  const mark = () => {
    lastInputAt = Date.now();
  };
  for (const ev of ["keydown", "pointerdown", "wheel"])
    window.addEventListener(ev, mark, { passive: true, capture: true });
}

/** Register a probe that reports "busy" (e.g. active terminal output rate). */
export function registerBusyProbe(probe: () => boolean): () => void {
  busyProbes.add(probe);
  return () => busyProbes.delete(probe);
}

export function markUserActivity(at = Date.now()): void {
  lastInputAt = at;
}

function defaultIdle(fn: () => void): () => void {
  const win = typeof window === "undefined" ? undefined : window;
  if (win && typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(fn, { timeout: 2000 });
    return () => win.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 50);
  return () => clearTimeout(id);
}

export function defaultSchedulerEnv(): SchedulerEnv {
  wireInput();
  return {
    now: () => Date.now(),
    idle: defaultIdle,
    isBusy: () => {
      if (Date.now() - lastInputAt < BUSY_WINDOW_MS) return true;
      for (const p of busyProbes) if (p()) return true;
      return false;
    },
    isHidden,
    isUnlocked: isUnlockedForPreload,
  };
}

interface Queued extends PreloadTask {
  priority: PreloadPriority;
  seq: number;
}

export function createPreloadScheduler(
  env: SchedulerEnv,
  options: SchedulerOptions = {},
) {
  const budget = options.frameBudgetMs ?? 8;
  const maxConcurrent = options.maxConcurrent ?? 2;
  const retryMs = options.busyRetryMs ?? 250;
  const queue = new Map<string, Queued>();
  let running = 0;
  let seq = 0;
  let cancelIdle: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    if (cancelIdle || retryTimer !== undefined || queue.size === 0) return;
    cancelIdle = env.idle(() => {
      cancelIdle = undefined;
      slice();
    });
  };

  const defer = () => {
    if (retryTimer !== undefined || queue.size === 0) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      arm();
    }, retryMs);
  };

  const pick = (busy: boolean): Queued | undefined => {
    let best: Queued | undefined;
    for (const t of queue.values()) {
      if (t.requires === "unlocked" && !env.isUnlocked()) continue;
      if ((busy || env.isHidden()) && t.priority !== 0) continue;
      if (
        !best ||
        t.priority < best.priority ||
        (t.priority === best.priority && t.seq < best.seq)
      )
        best = t;
    }
    return best;
  };

  function slice() {
    const start = env.now();
    let ranAny = false;
    for (;;) {
      if (running >= maxConcurrent) break;
      const busy = env.isBusy();
      const task = pick(busy);
      if (!task) {
        // Remaining tasks (if any) are blocked by busy/hidden/locked: poll later.
        if (queue.size && (busy || env.isHidden()))
          metrics.count("preload.deferred");
        break;
      }
      if (
        ranAny &&
        task.priority !== 0 &&
        env.now() - start + (task.cost ?? 0) > budget
      )
        break;
      queue.delete(task.id);
      ranAny = true;
      run(task);
      if (env.now() - start >= budget) break;
    }
    if (queue.size && running < maxConcurrent) {
      if (pick(env.isBusy())) arm();
      else if (
        [...queue.values()].some(
          (t) => !(t.requires === "unlocked" && !env.isUnlocked()),
        )
      )
        defer(); // busy/hidden: poll again later
      // else only locked-blocked tasks remain: wait for kick() on unlock
    }
  }

  function run(task: Queued) {
    metrics.count("preload.run");
    // Re-check the lock at the last moment.
    if (task.requires === "unlocked" && !env.isUnlocked()) return;
    let result: void | Promise<unknown>;
    try {
      result = task.run();
    } catch {
      metrics.count("preload.error");
      return;
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      running++;
      (result as Promise<unknown>).then(
        () => settle(),
        () => {
          metrics.count("preload.error");
          settle();
        },
      );
    }
  }
  function settle() {
    running = Math.max(0, running - 1);
    arm();
  }

  const scheduler = {
    /** Queue a preload. Same id replaces a pending one. Returns cancel. */
    schedule(task: PreloadTask): () => void {
      if ((task as { secret?: boolean }).secret === true)
        throw new Error("[perf] secret preloads are forbidden");
      const queued: Queued = {
        ...task,
        priority: task.priority ?? 2,
        seq: seq++,
      };
      queue.set(task.id, queued);
      arm();
      return () => {
        if (queue.get(task.id) === queued) queue.delete(task.id);
      };
    },
    cancel(id: string): boolean {
      return queue.delete(id);
    },
    cancelAll(): void {
      queue.clear();
      cancelIdle?.();
      cancelIdle = undefined;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    },
    /** Drop tasks that need the app to be unlocked. */
    dropUnlocked(): void {
      for (const [id, t] of [...queue])
        if (t.requires === "unlocked") queue.delete(id);
    },
    /** Wake the scheduler (e.g. after unlock). */
    kick(): void {
      arm();
    },
    get pending(): number {
      return queue.size;
    },
    pendingIds(): string[] {
      return [...queue.keys()];
    },
    get running(): number {
      return running;
    },
  };
  return scheduler;
}

export type PreloadScheduler = ReturnType<typeof createPreloadScheduler>;

let shared: PreloadScheduler | undefined;
/** App-wide scheduler (lazy). Locking drops unlock-requiring tasks; unlocking wakes it. */
export function getPreloadScheduler(): PreloadScheduler {
  if (!shared) {
    const s = createPreloadScheduler(defaultSchedulerEnv());
    shared = s;
    onCachesCleared(() => s.dropUnlocked());
    onLockStateChange((state) => {
      if (state === "unlocked") s.kick();
    });
  }
  return shared;
}

/** Convenience: getPreloadScheduler().schedule(task). */
export function schedulePreload(task: PreloadTask): () => void {
  return getPreloadScheduler().schedule(task);
}

/**
 * Prefetch a code chunk at low priority, once per id. `importer` is a plain
 * thunk such as `() => import("./Panel")` (works for next/dynamic targets).
 */
export function prefetchChunk(
  id: string,
  importer: () => Promise<unknown>,
  priority: PreloadPriority = 3,
): () => void {
  return schedulePreload({ id: `chunk:${id}`, priority, run: importer });
}

/**
 * Idle code prefetch only pays off in a production bundle, where `import()`
 * just fetches and evaluates a prebuilt chunk. Under `next dev` every
 * `import()` of a panel makes the dev server compile that panel's whole module
 * graph on demand, so a startup warm-up becomes a compile storm that starves
 * the first paint and the webview (`tauri dev` start-up measured at ~16 s of
 * module transform for the nine warmed chunks). Intent-driven preloads (hover,
 * focus) are unaffected: the user asked for that panel.
 */
export function shouldWarmChunksAtIdle(): boolean {
  return process.env.NODE_ENV !== "development";
}

export interface ChunkStep {
  id: string;
  importer: () => Promise<unknown>;
  priority?: PreloadPriority;
}

/**
 * Prefetch chunks strictly one after another with a pause between them.
 * Evaluating a large chunk is an uninterruptible main-thread task, so
 * queueing several at once (the scheduler allows two concurrent) lands them
 * back to back in one burst. Each step goes through the normal scheduler
 * (busy/hidden/idle rules apply); the next is queued `gapMs` after the
 * previous settles. Returns a cancel function.
 */
export function prefetchChunksInSequence(
  steps: readonly ChunkStep[],
  gapMs = 400,
): () => void {
  let index = 0;
  let cancelled = false;
  let cancelStep: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const next = () => {
    timer = undefined;
    if (cancelled || index >= steps.length) return;
    const step = steps[index++];
    cancelStep = schedulePreload({
      id: `chunk:${step.id}`,
      priority: step.priority ?? 3,
      run: () =>
        step.importer().finally(() => {
          if (!cancelled) timer = setTimeout(next, gapMs);
        }),
    });
  };
  next();
  return () => {
    cancelled = true;
    cancelStep?.();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * Preload because the user showed intent (hover/focus/shortcut). Debounced
 * 80 ms; leaving before it fires cancels it. Spread the handlers on an element.
 */
export function preloadOnIntent(
  id: string,
  task: Omit<PreloadTask, "id">,
  debounceMs = 80,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      schedulePreload({ ...task, priority: task.priority ?? 1, id });
    }, debounceMs);
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    onPointerEnter: start,
    onFocus: start,
    onPointerLeave: stop,
    onBlur: stop,
  };
}
