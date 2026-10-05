export interface TerminalOutputChunk {
  data: string;
  generation?: number;
  sequenceStart?: number;
  sequenceEnd?: number;
  retainedStart?: number;
  droppedBytes?: number;
}

export interface TerminalReplaySnapshot {
  sessionId: string;
  data: string;
  generation: number;
  sequenceStart: number;
  sequenceEnd: number;
  retainedStart: number;
  droppedBytes: number;
  gap: boolean;
  generationChanged: boolean;
  hasMore?: boolean;
}

export type TerminalOutputGapReason =
  "overflow" | "sequence" | "replay" | "generation";

export interface TerminalOutputGap {
  reason: TerminalOutputGapReason;
  droppedChunks: number;
  droppedBytes: number;
  fromSequence?: number;
  throughSequence?: number;
}

export interface TerminalOutputCallbacks {
  /** Return false when the renderer is temporarily unavailable; data stays queued. */
  write: (data: string) => boolean | void | Promise<boolean | void>;
  onGap: (gap: TerminalOutputGap) => boolean | void;
  onReset?: () => boolean | void;
  /** Fetch one bounded native replay page, starting at the acknowledged cursor. */
  replay?: (
    cursor: TerminalOutputCursor,
  ) => Promise<TerminalReplaySnapshot | null>;
}

export interface TerminalOutputSchedulerConfig {
  perSessionMaxBytes: number;
  perSessionMaxChunks: number;
  globalMaxBytes: number;
  tickBudgetMs: number;
  maxChunksPerSessionTurn: number;
  maxBytesPerSessionTurn: number;
  /** Delay before retrying a delivery after `write` returned false. */
  writeRetryDelayMs: number;
  /**
   * Consecutive `write:false` results tolerated before the registration is
   * paused for good (until an explicit `resume()`). 0 disables retries.
   */
  maxWriteRetries: number;
}

export const DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG: TerminalOutputSchedulerConfig =
  {
    perSessionMaxBytes: 1024 * 1024,
    perSessionMaxChunks: 512,
    globalMaxBytes: 16 * 1024 * 1024,
    tickBudgetMs: 8,
    maxChunksPerSessionTurn: 8,
    maxBytesPerSessionTurn: 64 * 1024,
    writeRetryDelayMs: 50,
    maxWriteRetries: 40,
  };

export interface TerminalOutputSchedulerClock {
  now: () => number;
  schedule: (callback: () => void) => unknown;
  cancel: (handle: unknown) => void;
  /** Run `callback` once after `ms`; the returned function cancels it. */
  scheduleAfter: (ms: number, callback: () => void) => () => void;
}

const defaultClock: TerminalOutputSchedulerClock = {
  now: () =>
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  schedule: (callback) => setTimeout(callback, 0),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  scheduleAfter: (ms, callback) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};

export interface TerminalOutputCursor {
  generation?: number;
  afterSequence?: number;
}

export interface TerminalOutputRegistrationDiagnostics {
  sessionId: string;
  generation?: number;
  paused: boolean;
  queuedBytes: number;
  queuedChunks: number;
  deliveredSequence?: number;
  pendingGap: boolean;
  /** Consecutive `write:false` results since the last successful write. */
  writeRetries: number;
}

export interface TerminalOutputRegistration {
  enqueue: (chunk: TerminalOutputChunk) => boolean;
  pause: () => void;
  resume: () => void;
  synchronize: () => void;
  captureOrdinal: () => number;
  cursor: () => TerminalOutputCursor;
  applyReplay: (snapshot: TerminalReplaySnapshot) => void;
  applyLegacyReplay: (data: string, throughOrdinal: number) => void;
  diagnostics: () => TerminalOutputRegistrationDiagnostics;
  dispose: () => void;
}

export interface TerminalOutputSchedulerDiagnostics {
  registrations: number;
  pausedRegistrations: number;
  queuedBytes: number;
  queuedChunks: number;
  scheduled: boolean;
}

interface QueueRecord extends TerminalOutputChunk {
  ownerId: number;
  ordinal: number;
  bytes: number;
  live: boolean;
}

interface SchedulerState {
  id: number;
  sessionId: string;
  generation?: number;
  queue: QueueRecord[];
  queuedBytes: number;
  paused: boolean;
  disposed: boolean;
  callbacks: TerminalOutputCallbacks;
  deliveredSequence?: number;
  lastBackendDroppedBytes?: number;
  pendingGap: TerminalOutputGap | null;
  resetPending: boolean;
  writeRetries: number;
  cancelWriteRetry: (() => void) | null;
  writing: QueueRecord | null;
  replayRequested: boolean;
  replayInFlight: boolean;
  replayFailures: number;
  replayPageEnd?: number;
  replayMore: boolean;
  highWater?: number;
}

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });

const byteLength = (value: string): number => encoder.encode(value).byteLength;

const decodeAtBoundary = (bytes: Uint8Array): string => {
  for (let offset = 0; offset <= Math.min(3, bytes.byteLength); offset++) {
    try {
      return fatalDecoder.decode(bytes.subarray(offset));
    } catch {
      // A UTF-8 code point is at most four bytes; try the next boundary.
    }
  }
  return "";
};

const keepLastUtf8Bytes = (value: string, maximumBytes: number): string => {
  if (maximumBytes <= 0) return "";
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  return decodeAtBoundary(bytes.subarray(bytes.byteLength - maximumBytes));
};

const dropFirstUtf8Bytes = (value: string, bytesToDrop: number): string => {
  if (bytesToDrop <= 0) return value;
  const bytes = encoder.encode(value);
  if (bytesToDrop >= bytes.byteLength) return "";
  return decodeAtBoundary(bytes.subarray(bytesToDrop));
};

const takeFirstUtf8Bytes = (
  value: string,
  maximumBytes: number,
): { data: string; bytes: number } => {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) {
    return { data: value, bytes: bytes.byteLength };
  }

  let boundary = Math.min(maximumBytes, bytes.byteLength);
  while (
    boundary > 0 &&
    boundary < bytes.byteLength &&
    (bytes[boundary] & 0b1100_0000) === 0b1000_0000
  ) {
    boundary--;
  }
  if (boundary === 0) return { data: "", bytes: 0 };
  return {
    data: fatalDecoder.decode(bytes.subarray(0, boundary)),
    bytes: boundary,
  };
};

const finiteNonNegativeInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

const finitePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;

const normalizeConfig = (
  config: Partial<TerminalOutputSchedulerConfig>,
): TerminalOutputSchedulerConfig => ({
  perSessionMaxBytes: finitePositiveInteger(
    config.perSessionMaxBytes ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.perSessionMaxBytes,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.perSessionMaxBytes,
  ),
  perSessionMaxChunks: finitePositiveInteger(
    config.perSessionMaxChunks ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.perSessionMaxChunks,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.perSessionMaxChunks,
  ),
  globalMaxBytes: finitePositiveInteger(
    config.globalMaxBytes ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.globalMaxBytes,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.globalMaxBytes,
  ),
  tickBudgetMs: Math.min(
    8,
    finitePositiveInteger(
      config.tickBudgetMs ??
        DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.tickBudgetMs,
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.tickBudgetMs,
    ),
  ),
  maxChunksPerSessionTurn: finitePositiveInteger(
    config.maxChunksPerSessionTurn ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxChunksPerSessionTurn,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxChunksPerSessionTurn,
  ),
  maxBytesPerSessionTurn: finitePositiveInteger(
    Math.max(
      4,
      config.maxBytesPerSessionTurn ??
        DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxBytesPerSessionTurn,
    ),
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxBytesPerSessionTurn,
  ),
  writeRetryDelayMs: finiteNonNegativeInteger(
    config.writeRetryDelayMs ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.writeRetryDelayMs,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.writeRetryDelayMs,
  ),
  maxWriteRetries: finiteNonNegativeInteger(
    config.maxWriteRetries ??
      DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxWriteRetries,
    DEFAULT_TERMINAL_OUTPUT_SCHEDULER_CONFIG.maxWriteRetries,
  ),
});

/**
 * Window-level bounded terminal scheduler. A single ready queue services all
 * sessions round-robin, under a hard <=8 ms work budget per scheduled tick.
 */
export class TerminalOutputScheduler {
  private readonly config: TerminalOutputSchedulerConfig;
  private readonly states = new Map<number, SchedulerState>();
  private readonly readyQueue: number[] = [];
  private readonly readySet = new Set<number>();
  private readonly globalOrder: QueueRecord[] = [];
  private globalOrderHead = 0;
  private nextStateId = 1;
  private nextOrdinal = 1;
  private totalQueuedBytes = 0;
  private totalQueuedChunks = 0;
  private scheduledHandle: unknown = null;
  private replayFlights = 0;
  private readonly replayWaiters = new Set<number>();

  constructor(
    config: Partial<TerminalOutputSchedulerConfig> = {},
    private readonly clock: TerminalOutputSchedulerClock = defaultClock,
  ) {
    this.config = normalizeConfig(config);
  }

  register(
    sessionId: string,
    callbacks: TerminalOutputCallbacks,
    options: { generation?: number; paused?: boolean } = {},
  ): TerminalOutputRegistration {
    if (!sessionId) throw new Error("Terminal scheduler requires a session ID");
    const state: SchedulerState = {
      id: this.nextStateId++,
      sessionId,
      generation: options.generation,
      queue: [],
      queuedBytes: 0,
      paused: options.paused ?? false,
      disposed: false,
      callbacks,
      pendingGap: null,
      resetPending: false,
      writeRetries: 0,
      cancelWriteRetry: null,
      writing: null,
      replayRequested: false,
      replayInFlight: false,
      replayFailures: 0,
      replayMore: false,
    };
    this.states.set(state.id, state);

    let disposed = false;
    const withState = <T>(
      fallback: T,
      action: (live: SchedulerState) => T,
    ): T => {
      if (disposed || state.disposed) return fallback;
      return action(state);
    };

    return {
      enqueue: (chunk) => withState(false, (live) => this.enqueue(live, chunk)),
      pause: () => {
        withState(undefined, (live) => this.setPaused(live, true));
      },
      resume: () => {
        withState(undefined, (live) => this.setPaused(live, false));
      },
      synchronize: () => {
        withState(undefined, (live) => {
          if (!live.callbacks.replay) return;
          live.replayRequested = true;
          this.markReady(live);
        });
      },
      captureOrdinal: () => this.nextOrdinal - 1,
      cursor: () =>
        withState<TerminalOutputCursor>({}, (live) => ({
          generation: live.generation,
          afterSequence: live.deliveredSequence,
        })),
      applyReplay: (snapshot) => {
        withState(undefined, (live) => this.applyReplay(live, snapshot));
      },
      applyLegacyReplay: (data, throughOrdinal) => {
        withState(undefined, (live) =>
          this.applyLegacyReplay(live, data, throughOrdinal),
        );
      },
      diagnostics: () =>
        withState<TerminalOutputRegistrationDiagnostics>(
          {
            sessionId,
            paused: true,
            queuedBytes: 0,
            queuedChunks: 0,
            pendingGap: false,
            writeRetries: 0,
          },
          (live) => this.stateDiagnostics(live),
        ),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.disposeState(state);
      },
    };
  }

  diagnostics(): TerminalOutputSchedulerDiagnostics {
    return {
      registrations: this.states.size,
      pausedRegistrations: [...this.states.values()].filter(
        (state) => state.paused,
      ).length,
      queuedBytes: this.totalQueuedBytes,
      queuedChunks: this.totalQueuedChunks,
      scheduled: this.scheduledHandle !== null,
    };
  }

  dispose(): void {
    for (const state of [...this.states.values()]) this.disposeState(state);
  }

  private enqueue(
    state: SchedulerState,
    incoming: TerminalOutputChunk,
  ): boolean {
    if (state.disposed || !incoming.data) return false;

    if (incoming.generation !== undefined) {
      if (state.generation === undefined)
        state.generation = incoming.generation;
      if (state.generation !== incoming.generation) return false;
    }

    // History eviction is not evidence of missing live output. Only stream
    // sequence discontinuities (or an expired replay cursor) establish a gap.
    state.lastBackendDroppedBytes = Math.max(
      state.lastBackendDroppedBytes ?? 0,
      incoming.droppedBytes ?? 0,
    );
    if (incoming.sequenceEnd !== undefined) {
      state.highWater = Math.max(state.highWater ?? 0, incoming.sequenceEnd);
      if (
        state.callbacks.replay &&
        (state.paused ||
          state.replayRequested ||
          state.replayInFlight ||
          state.replayPageEnd !== undefined)
      ) {
        // During catch-up the native replay buffer is the source of truth.
        // Do not duplicate potentially 100 MiB of history in a hidden WebView.
        if (state.replayPageEnd !== undefined) state.replayMore = true;
        else state.replayRequested = true;
        this.markReady(state);
        return true;
      }
    }
    const chunk = this.reconcileSequence(state, incoming);
    if (!chunk?.data) return false;
    this.insertRecord(state, chunk, false);
    this.enforceLimits(state);
    this.markReady(state);
    return true;
  }

  private reconcileSequence(
    state: SchedulerState,
    incoming: TerminalOutputChunk,
  ): TerminalOutputChunk | null {
    let data = incoming.data;
    let sequenceStart = incoming.sequenceStart;
    const sequenceEnd = incoming.sequenceEnd;
    const expected = this.latestSequence(state);

    if (
      expected === undefined ||
      sequenceStart === undefined ||
      sequenceEnd === undefined
    ) {
      return { ...incoming, data };
    }
    if (sequenceEnd <= expected) return null;
    if (sequenceStart > expected) {
      this.recordGap(state, {
        reason: "sequence",
        droppedChunks: 0,
        droppedBytes: sequenceStart - expected,
        fromSequence: expected,
        throughSequence: sequenceStart,
      });
    } else if (sequenceStart < expected) {
      data = dropFirstUtf8Bytes(data, expected - sequenceStart);
      sequenceStart = expected;
    }
    return { ...incoming, data, sequenceStart, sequenceEnd };
  }

  private latestSequence(state: SchedulerState): number | undefined {
    for (let index = state.queue.length - 1; index >= 0; index--) {
      const sequenceEnd = state.queue[index]?.sequenceEnd;
      if (sequenceEnd !== undefined) return sequenceEnd;
    }
    return state.deliveredSequence;
  }

  private insertRecord(
    state: SchedulerState,
    chunk: TerminalOutputChunk,
    atFront: boolean,
  ): void {
    let data = chunk.data;
    const absoluteCap = Math.min(
      this.config.perSessionMaxBytes,
      this.config.globalMaxBytes,
    );
    const originalBytes = byteLength(data);
    if (originalBytes > absoluteCap) {
      data = keepLastUtf8Bytes(data, absoluteCap);
      const retainedBytes = byteLength(data);
      this.recordGap(state, {
        reason: "overflow",
        droppedChunks: 0,
        droppedBytes: originalBytes - retainedBytes,
        fromSequence: chunk.sequenceStart,
        throughSequence:
          chunk.sequenceStart !== undefined
            ? chunk.sequenceStart + originalBytes - retainedBytes
            : undefined,
      });
    }
    if (!data) return;
    const retainedBytes = byteLength(data);

    const record: QueueRecord = {
      ...chunk,
      data,
      sequenceStart:
        chunk.sequenceEnd !== undefined && originalBytes > retainedBytes
          ? chunk.sequenceEnd - retainedBytes
          : chunk.sequenceStart,
      ownerId: state.id,
      bytes: retainedBytes,
      ordinal: this.nextOrdinal++,
      live: true,
    };
    if (atFront) state.queue.unshift(record);
    else state.queue.push(record);
    state.queuedBytes += record.bytes;
    this.totalQueuedBytes += record.bytes;
    this.totalQueuedChunks++;
    this.globalOrder.push(record);
  }

  private enforceLimits(state: SchedulerState): void {
    while (
      state.queue.length > this.config.perSessionMaxChunks ||
      state.queuedBytes > this.config.perSessionMaxBytes
    ) {
      const oldest = state.queue.find((record) => record !== state.writing);
      if (!oldest) break;
      this.dropRecord(state, oldest, true);
    }

    while (this.totalQueuedBytes > this.config.globalMaxBytes) {
      const oldest = this.takeOldestGlobalRecord();
      if (!oldest) break;
      const owner = this.states.get(oldest.ownerId);
      if (!owner) {
        oldest.live = false;
        continue;
      }
      this.dropRecord(owner, oldest, true);
    }
    this.compactGlobalOrder();
  }

  private takeOldestGlobalRecord(): QueueRecord | null {
    for (
      let index = this.globalOrderHead;
      index < this.globalOrder.length;
      index++
    ) {
      const record = this.globalOrder[index];
      if (record?.live && this.states.get(record.ownerId)?.writing !== record)
        return record;
    }
    return null;
  }

  private compactGlobalOrder(): void {
    while (
      this.globalOrderHead < this.globalOrder.length &&
      !this.globalOrder[this.globalOrderHead]?.live
    ) {
      this.globalOrderHead++;
    }
    if (this.globalOrderHead > 1024) {
      this.globalOrder.splice(0, this.globalOrderHead);
      this.globalOrderHead = 0;
    }
    // A slow in-flight write can pin the first entry while later chunks are
    // consumed. Do not retain an unbounded tombstone list behind that entry.
    if (this.globalOrder.length > this.totalQueuedChunks * 2 + 1024) {
      const live = this.globalOrder.filter((record) => record.live);
      this.globalOrder.length = 0;
      this.globalOrder.push(...live);
      this.globalOrderHead = 0;
    }
  }

  private dropRecord(
    state: SchedulerState,
    record: QueueRecord,
    reportGap: boolean,
  ): void {
    if (!record.live) return;
    const index = state.queue.indexOf(record);
    if (index >= 0) state.queue.splice(index, 1);
    record.live = false;
    state.queuedBytes = Math.max(0, state.queuedBytes - record.bytes);
    this.totalQueuedBytes = Math.max(0, this.totalQueuedBytes - record.bytes);
    this.totalQueuedChunks = Math.max(0, this.totalQueuedChunks - 1);
    if (reportGap) {
      this.recordGap(state, {
        reason: "overflow",
        droppedChunks: 1,
        droppedBytes: record.bytes,
        fromSequence: record.sequenceStart,
        throughSequence: record.sequenceEnd,
      });
    }
  }

  private recordGap(state: SchedulerState, gap: TerminalOutputGap): void {
    if (
      state.callbacks.replay &&
      (gap.reason === "sequence" || gap.reason === "overflow")
    ) {
      state.replayRequested = true;
    }
    if (!state.pendingGap) {
      state.pendingGap = { ...gap };
      this.markReady(state);
      return;
    }
    state.pendingGap = {
      reason:
        state.pendingGap.reason === gap.reason
          ? gap.reason
          : state.pendingGap.reason === "generation" ||
              gap.reason === "generation"
            ? "generation"
            : state.pendingGap.reason === "overflow" ||
                gap.reason === "overflow"
              ? "overflow"
              : gap.reason,
      droppedChunks:
        state.pendingGap.droppedChunks + Math.max(0, gap.droppedChunks),
      droppedBytes:
        state.pendingGap.droppedBytes + Math.max(0, gap.droppedBytes),
      fromSequence:
        state.pendingGap.fromSequence === undefined
          ? gap.fromSequence
          : gap.fromSequence === undefined
            ? state.pendingGap.fromSequence
            : Math.min(state.pendingGap.fromSequence, gap.fromSequence),
      throughSequence:
        state.pendingGap.throughSequence === undefined
          ? gap.throughSequence
          : gap.throughSequence === undefined
            ? state.pendingGap.throughSequence
            : Math.max(state.pendingGap.throughSequence, gap.throughSequence),
    };
  }

  private applyReplay(
    state: SchedulerState,
    snapshot: TerminalReplaySnapshot,
  ): void {
    if (snapshot.sessionId !== state.sessionId) return;
    const generationChanged =
      snapshot.generationChanged ||
      (state.generation !== undefined &&
        state.generation !== snapshot.generation);

    if (generationChanged) {
      this.clearQueue(state, false);
      state.deliveredSequence = undefined;
      state.highWater = snapshot.sequenceEnd;
      state.generation = snapshot.generation;
      state.resetPending = true;
      this.recordGap(state, {
        reason: "generation",
        droppedChunks: 0,
        droppedBytes: Math.max(0, snapshot.sequenceStart),
        fromSequence: 0,
        throughSequence: snapshot.sequenceStart,
      });
    } else if (state.generation === undefined) {
      state.generation = snapshot.generation;
    }

    if (
      snapshot.gap &&
      !generationChanged &&
      snapshot.sequenceStart > (state.deliveredSequence ?? 0)
    ) {
      // Report only the unread interval, not lifetime history eviction. Keep
      // already-rendered output intact when older native history has expired.
      this.recordGap(state, {
        reason: "replay",
        droppedChunks: 0,
        droppedBytes: snapshot.sequenceStart - (state.deliveredSequence ?? 0),
        fromSequence: state.deliveredSequence ?? 0,
        throughSequence: snapshot.sequenceStart,
      });
    }
    state.lastBackendDroppedBytes = Math.max(
      state.lastBackendDroppedBytes ?? 0,
      snapshot.droppedBytes,
    );

    this.dropQueuedThroughSequence(state, snapshot.sequenceEnd);
    let data = snapshot.data;
    let sequenceStart = snapshot.sequenceStart;
    if (
      state.deliveredSequence !== undefined &&
      sequenceStart < state.deliveredSequence
    ) {
      data = dropFirstUtf8Bytes(data, state.deliveredSequence - sequenceStart);
      sequenceStart = state.deliveredSequence;
    }
    if (data && snapshot.sequenceEnd > (state.deliveredSequence ?? -1)) {
      this.insertRecord(
        state,
        {
          data,
          generation: snapshot.generation,
          sequenceStart,
          sequenceEnd: snapshot.sequenceEnd,
          retainedStart: snapshot.retainedStart,
          droppedBytes: snapshot.droppedBytes,
        },
        true,
      );
      this.enforceLimits(state);
    } else if (
      snapshot.sequenceStart === snapshot.sequenceEnd &&
      (state.deliveredSequence === undefined ||
        snapshot.sequenceEnd > state.deliveredSequence)
    ) {
      state.deliveredSequence = snapshot.sequenceEnd;
    }
    this.markReady(state);
  }

  private dropQueuedThroughSequence(
    state: SchedulerState,
    throughSequence: number,
  ): void {
    for (const record of [...state.queue]) {
      if (record.sequenceEnd === undefined) continue;
      if (record.sequenceEnd <= throughSequence) {
        this.dropRecord(state, record, false);
        continue;
      }
      if (
        record.sequenceStart !== undefined &&
        record.sequenceStart < throughSequence
      ) {
        const data = dropFirstUtf8Bytes(
          record.data,
          throughSequence - record.sequenceStart,
        );
        const nextBytes = byteLength(data);
        const removedBytes = record.bytes - nextBytes;
        record.data = data;
        record.bytes = nextBytes;
        record.sequenceStart = throughSequence;
        state.queuedBytes -= removedBytes;
        this.totalQueuedBytes -= removedBytes;
        if (!data) this.dropRecord(state, record, false);
      }
    }
  }

  private applyLegacyReplay(
    state: SchedulerState,
    data: string,
    throughOrdinal: number,
  ): void {
    for (const record of [...state.queue]) {
      if (record.ordinal <= throughOrdinal)
        this.dropRecord(state, record, false);
    }
    state.resetPending = true;
    state.deliveredSequence = undefined;
    if (data) {
      this.insertRecord(state, { data, generation: state.generation }, true);
      this.enforceLimits(state);
    }
    this.markReady(state);
  }

  private clearQueue(state: SchedulerState, reportGap: boolean): void {
    for (const record of [...state.queue]) {
      this.dropRecord(state, record, reportGap);
    }
  }

  private setPaused(state: SchedulerState, paused: boolean): void {
    if (state.disposed) return;
    // Explicit pause()/resume() always resets the retry budget and drops any
    // pending retry tick, even when the paused flag does not change.
    this.cancelWriteRetry(state);
    state.writeRetries = 0;
    if (state.paused === paused) {
      if (!paused) this.markReady(state);
      return;
    }
    state.paused = paused;
    if (paused) {
      this.readySet.delete(state.id);
      if (this.readySet.size === 0 && this.scheduledHandle !== null) {
        this.clock.cancel(this.scheduledHandle);
        this.scheduledHandle = null;
      }
      return;
    }
    this.markReady(state);
  }

  private hasWork(state: SchedulerState): boolean {
    return (
      state.queue.length > 0 ||
      state.pendingGap !== null ||
      state.resetPending ||
      state.replayRequested ||
      state.replayPageEnd !== undefined
    );
  }

  private markReady(state: SchedulerState): void {
    if (
      state.disposed ||
      state.paused ||
      state.writing !== null ||
      state.replayInFlight ||
      this.replayWaiters.has(state.id) ||
      state.cancelWriteRetry !== null ||
      !this.hasWork(state) ||
      this.readySet.has(state.id)
    ) {
      return;
    }
    this.readySet.add(state.id);
    this.readyQueue.push(state.id);
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (this.scheduledHandle !== null || this.readySet.size === 0) return;
    this.scheduledHandle = this.clock.schedule(() => this.flushTick());
  }

  private flushTick(): void {
    this.scheduledHandle = null;
    const startedAt = this.clock.now();
    let visitedStates = 0;

    while (this.readyQueue.length > 0) {
      if (
        visitedStates > 0 &&
        this.clock.now() - startedAt >= this.config.tickBudgetMs
      ) {
        break;
      }
      const stateId = this.readyQueue.shift();
      if (stateId === undefined || !this.readySet.delete(stateId)) continue;
      const state = this.states.get(stateId);
      if (!state || state.disposed || state.paused || !this.hasWork(state)) {
        continue;
      }
      visitedStates++;

      if (state.replayPageEnd !== undefined && state.queue.length === 0) {
        // Empty can mean eviction, not delivery. Do not lose a recovery
        // request when global pressure removed the final page before writing.
        state.replayRequested =
          state.replayRequested ||
          state.replayMore ||
          (state.deliveredSequence ?? -1) < state.replayPageEnd;
        state.replayPageEnd = undefined;
        state.replayMore = false;
      }
      const canDrainPrefix =
        state.deliveredSequence !== undefined &&
        state.queue[0]?.sequenceStart === state.deliveredSequence;
      if (state.replayRequested && state.callbacks.replay && !canDrainPrefix) {
        this.startReplay(state);
        continue;
      }

      if (state.resetPending) {
        const accepted = state.callbacks.onReset?.();
        if (accepted === false) {
          state.paused = true;
          continue;
        }
        state.resetPending = false;
      }
      if (state.pendingGap && !state.replayRequested) {
        const gap = state.pendingGap;
        const accepted = state.callbacks.onGap(gap);
        if (accepted === false) {
          state.paused = true;
          continue;
        }
        state.pendingGap = null;
      }

      let turnChunks = 0;
      let turnBytes = 0;
      while (state.queue.length > 0) {
        if (turnChunks >= this.config.maxChunksPerSessionTurn) break;
        if (turnBytes >= this.config.maxBytesPerSessionTurn) break;
        const record = state.queue[0];
        if (
          state.replayRequested &&
          state.callbacks.replay &&
          record.sequenceStart !== state.deliveredSequence
        )
          break;
        if (
          turnChunks > 0 &&
          this.clock.now() - startedAt >= this.config.tickBudgetMs
        ) {
          break;
        }

        const delivery = takeFirstUtf8Bytes(
          record.data,
          this.config.maxBytesPerSessionTurn - turnBytes,
        );
        if (!delivery.data || delivery.bytes === 0) break;
        const deliverySequenceEnd =
          record.sequenceStart !== undefined
            ? record.sequenceStart + delivery.bytes
            : delivery.bytes === record.bytes
              ? record.sequenceEnd
              : undefined;
        try {
          const accepted = state.callbacks.write(delivery.data);
          if (
            accepted instanceof Promise ||
            (accepted && typeof accepted === "object" && "then" in accepted)
          ) {
            // Exactly one xterm write is outstanding per registration. Queue
            // acceptance is not a rendered/parsed acknowledgement.
            state.writing = record;
            const generation = state.generation;
            void Promise.resolve(accepted).then(
              (result) => {
                if (state.disposed || state.generation !== generation) return;
                state.writing = null;
                if (result === false) this.handleWriteRejected(state);
                else {
                  state.writeRetries = 0;
                  this.consumeRecordPrefix(state, record, delivery);
                  if (deliverySequenceEnd !== undefined)
                    state.deliveredSequence = deliverySequenceEnd;
                }
                this.markReady(state);
              },
              () => {
                if (state.disposed || state.generation !== generation) return;
                state.writing = null;
                this.handleWriteRejected(state);
              },
            );
            break;
          }
          if (accepted === false) {
            // The view became hidden or its renderer has not acquired valid
            // dimensions yet. Retry a bounded number of times after a delay;
            // once the budget is exhausted, pause without spinning until the
            // view explicitly resumes after its next visibility/fit transition.
            this.handleWriteRejected(state);
            break;
          }
          state.writeRetries = 0;
          this.consumeRecordPrefix(state, record, delivery);
          turnChunks++;
          turnBytes += delivery.bytes;
          if (deliverySequenceEnd !== undefined) {
            state.deliveredSequence = Math.max(
              state.deliveredSequence ?? deliverySequenceEnd,
              deliverySequenceEnd,
            );
          }
        } catch {
          this.dropRecord(state, record, false);
          turnChunks++;
          turnBytes += delivery.bytes;
          this.recordGap(state, {
            reason: "overflow",
            droppedChunks: 1,
            droppedBytes: record.bytes,
            fromSequence: record.sequenceStart,
            throughSequence: record.sequenceEnd,
          });
        }
      }
      this.markReady(state);
    }

    this.compactGlobalOrder();
    this.scheduleTick();
  }

  private startReplay(state: SchedulerState): void {
    const replay = state.callbacks.replay;
    if (!replay || state.replayInFlight || state.writing) return;
    // Cap IPC fan-out as well as the JS delivery queue: a thousand simultaneous
    // 256 KiB replies would otherwise allocate 250 MiB before queue limits run.
    if (this.replayFlights >= 4) {
      this.replayWaiters.add(state.id);
      return;
    }
    this.replayFlights++;
    state.replayRequested = false;
    state.replayInFlight = true;
    const cursor = {
      generation: state.generation,
      afterSequence: state.deliveredSequence,
    };
    void Promise.resolve()
      .then(() => replay(cursor))
      .then((snapshot) => {
        if (state.disposed) return;
        if (
          snapshot &&
          (snapshot.sessionId !== state.sessionId ||
            snapshot.sequenceEnd < snapshot.sequenceStart ||
            byteLength(snapshot.data) !==
              snapshot.sequenceEnd - snapshot.sequenceStart ||
            (snapshot.hasMore && !snapshot.data))
        ) {
          throw new Error("Invalid terminal replay page");
        }
        if (snapshot) {
          if (
            !snapshot.data &&
            (state.highWater ?? 0) > snapshot.sequenceEnd &&
            !snapshot.generationChanged &&
            snapshot.generation === state.generation
          ) {
            throw new Error(
              "Terminal replay has not caught up with live output",
            );
          }
          this.clearQueue(state, false);
          state.pendingGap = null;
          this.applyReplay(state, snapshot);
          state.replayPageEnd = snapshot.sequenceEnd;
          // Preserve requests received during this flight, but drain the page
          // before fetching again from the acknowledged cursor.
          state.replayMore =
            state.replayRequested ||
            snapshot.hasMore === true ||
            (state.highWater ?? 0) > snapshot.sequenceEnd;
          state.replayRequested = false;
        }
        state.replayFailures = 0;
        state.replayInFlight = false;
        this.markReady(state);
      })
      .catch(() => {
        if (state.disposed) return;
        state.replayInFlight = false;
        state.replayRequested = true;
        state.replayFailures++;
        // Keep unread data and retry transient IPC failures with bounded
        // backoff. Never busy-loop or silently switch to an unsequenced stream.
        this.cancelWriteRetry(state);
        state.cancelWriteRetry = this.clock.scheduleAfter(
          Math.min(30_000, 500 * 2 ** Math.min(state.replayFailures - 1, 6)),
          () => {
            state.cancelWriteRetry = null;
            this.markReady(state);
          },
        );
      })
      .finally(() => {
        this.replayFlights--;
        // Ready entries do not reserve slots: a view can pause or disappear
        // before its tick. Wake every waiter so cancelling an awakened view
        // cannot strand the remaining waiters with no IPC left to wake them.
        // The tick budget still bounds scheduling work and startReplay checks
        // the four-flight cap again at actual admission.
        for (const id of this.replayWaiters) {
          this.replayWaiters.delete(id);
          const waiting = this.states.get(id);
          if (waiting && !waiting.disposed && !waiting.paused) {
            this.markReady(waiting);
          }
        }
      });
  }

  private consumeRecordPrefix(
    state: SchedulerState,
    record: QueueRecord,
    delivery: { data: string; bytes: number },
  ): void {
    if (delivery.bytes >= record.bytes) {
      this.dropRecord(state, record, false);
      return;
    }

    record.data = record.data.slice(delivery.data.length);
    record.bytes -= delivery.bytes;
    if (record.sequenceStart !== undefined) {
      record.sequenceStart += delivery.bytes;
    }
    state.queuedBytes = Math.max(0, state.queuedBytes - delivery.bytes);
    this.totalQueuedBytes = Math.max(0, this.totalQueuedBytes - delivery.bytes);
  }

  private handleWriteRejected(state: SchedulerState): void {
    if (state.writeRetries >= this.config.maxWriteRetries) {
      state.paused = true;
      return;
    }
    state.writeRetries++;
    this.cancelWriteRetry(state);
    state.cancelWriteRetry = this.clock.scheduleAfter(
      this.config.writeRetryDelayMs,
      () => {
        state.cancelWriteRetry = null;
        this.markReady(state);
      },
    );
  }

  private cancelWriteRetry(state: SchedulerState): void {
    if (state.cancelWriteRetry === null) return;
    const cancel = state.cancelWriteRetry;
    state.cancelWriteRetry = null;
    cancel();
  }

  private disposeState(state: SchedulerState): void {
    if (state.disposed) return;
    state.disposed = true;
    this.replayWaiters.delete(state.id);
    this.cancelWriteRetry(state);
    this.readySet.delete(state.id);
    this.clearQueue(state, false);
    state.pendingGap = null;
    state.resetPending = false;
    this.states.delete(state.id);
    if (this.states.size === 0) {
      this.readyQueue.length = 0;
      this.readySet.clear();
      if (this.scheduledHandle !== null) {
        this.clock.cancel(this.scheduledHandle);
        this.scheduledHandle = null;
      }
      this.globalOrder.length = 0;
      this.globalOrderHead = 0;
    }
  }

  private stateDiagnostics(
    state: SchedulerState,
  ): TerminalOutputRegistrationDiagnostics {
    return {
      sessionId: state.sessionId,
      generation: state.generation,
      paused: state.paused,
      queuedBytes: state.queuedBytes,
      queuedChunks: state.queue.length,
      deliveredSequence: state.deliveredSequence,
      pendingGap: state.pendingGap !== null,
      writeRetries: state.writeRetries,
    };
  }
}

export const formatTerminalOutputGap = (gap: TerminalOutputGap): string => {
  const pieces = ["terminal output gap"];
  if (gap.droppedBytes > 0) pieces.push(`${gap.droppedBytes} bytes dropped`);
  if (gap.droppedChunks > 0) pieces.push(`${gap.droppedChunks} chunks dropped`);
  if (gap.fromSequence !== undefined && gap.throughSequence !== undefined) {
    pieces.push(`sequence ${gap.fromSequence}-${gap.throughSequence}`);
  }
  // CAN aborts a partially received CSI/OSC/DCS after genuine byte loss;
  // otherwise the warning or following prompt could become control payload.
  return `\x18\r\n\x1b[33m[${pieces.join("; ")}]\x1b[0m\r\n`;
};

let windowScheduler: TerminalOutputScheduler | null = null;

export const getTerminalOutputScheduler = (): TerminalOutputScheduler => {
  windowScheduler ??= new TerminalOutputScheduler();
  return windowScheduler;
};

export const resetTerminalOutputSchedulerForTests = (): void => {
  windowScheduler?.dispose();
  windowScheduler = null;
};
