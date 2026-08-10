export const DEFAULT_SESSION_CLOSE_CONCURRENCY = 8;
export const MAX_SESSION_CLOSE_CONCURRENCY = 64;
export const DEFAULT_SESSION_CLOSE_TIMEOUT_MS = 15_000;

export interface SessionCloseTarget<T> {
  readonly id: string;
  readonly value: T;
}

type SessionCloseEntryState =
  | "pending"
  | "in-flight"
  | "settling"
  | "completed"
  | "failed";

interface SessionCloseEntry<T> extends SessionCloseTarget<T> {
  state: SessionCloseEntryState;
  attempts: number;
  error?: string;
  timedOut: boolean;
}

export interface SessionCloseFailure {
  id: string;
  error: string;
  timedOut: boolean;
  attempts: number;
}

export interface SessionCloseProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  inFlight: number;
  timedOut: number;
  attempted: number;
  attemptCount: number;
  maximumInFlight: number;
  cancelled: boolean;
}

export interface SessionCloseBatchResult extends SessionCloseProgress {
  completedIds: readonly string[];
  pendingIds: readonly string[];
  timedOutIds: readonly string[];
  failures: readonly SessionCloseFailure[];
}

export interface SessionCloseRunOptions {
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SessionCloseProgress) => void;
  onSettledAfterTimeout?: (settlement: {
    id: string;
    completed: boolean;
    error?: string;
  }) => void;
  yieldControl?: () => Promise<void>;
}

export class SessionCloseTimeoutError extends Error {
  constructor(
    readonly sessionId: string,
    readonly timeoutMs: number,
  ) {
    super(`Closing session ${sessionId} timed out after ${timeoutMs}ms`);
    this.name = "SessionCloseTimeoutError";
  }
}

export const normalizeSessionCloseConcurrency = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SESSION_CLOSE_CONCURRENCY;
  }
  return Math.min(
    MAX_SESSION_CLOSE_CONCURRENCY,
    Math.max(1, Math.floor(value)),
  );
};

const normalizeSessionCloseTimeout = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SESSION_CLOSE_TIMEOUT_MS;
  }
  return Math.floor(value);
};

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type SessionCloseSettlement =
  | { readonly status: "fulfilled" }
  | { readonly status: "rejected"; readonly error: unknown };

type SessionCloseAttempt =
  | { readonly status: "settled"; readonly settlement: SessionCloseSettlement }
  | {
      readonly status: "timed-out";
      readonly error: SessionCloseTimeoutError;
      readonly settlement: Promise<SessionCloseSettlement>;
    };

const runUntilTimeout = async <T>(
  sessionId: string,
  timeoutMs: number,
  operation: () => Promise<T> | T,
): Promise<SessionCloseAttempt> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const settlement = Promise.resolve()
    .then(operation)
    .then(
      (): SessionCloseSettlement => ({ status: "fulfilled" }),
      (error: unknown): SessionCloseSettlement => ({
        status: "rejected",
        error,
      }),
    );
  const timeoutError = new SessionCloseTimeoutError(sessionId, timeoutMs);
  const timeoutPromise = new Promise<SessionCloseAttempt>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ status: "timed-out", error: timeoutError, settlement });
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      settlement.then(
        (result): SessionCloseAttempt => ({
          status: "settled",
          settlement: result,
        }),
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

/**
 * A captured, deterministic close batch. Completed entries remain recorded so
 * retrying the same batch only schedules failed or previously unclaimed work.
 * Cancellation is cooperative: it stops workers from claiming new entries but
 * lets already-started protocol cleanup settle through its existing API.
 */
export class BoundedSessionCloseBatch<T> {
  readonly targets: readonly SessionCloseTarget<T>[];

  private readonly entries: SessionCloseEntry<T>[];
  private activeController: AbortController | undefined;
  private running: Promise<SessionCloseBatchResult> | undefined;
  private completedCount = 0;
  private failedCount = 0;
  private pendingCount: number;
  private inFlightCount = 0;
  private timedOutCount = 0;
  private attemptedCount = 0;
  private totalAttemptCount = 0;
  private maximumInFlight = 0;
  private cancelled = false;

  constructor(targets: readonly SessionCloseTarget<T>[]) {
    const seen = new Set<string>();
    const captured: SessionCloseTarget<T>[] = [];
    for (const target of targets) {
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      captured.push(Object.freeze({ id: target.id, value: target.value }));
    }
    this.targets = Object.freeze(captured);
    this.entries = captured.map((target) => ({
      ...target,
      state: "pending",
      attempts: 0,
      timedOut: false,
    }));
    this.pendingCount = this.entries.length;
  }

  cancel(): SessionCloseProgress {
    this.cancelled = true;
    this.activeController?.abort();
    return this.progress();
  }

  progress(): SessionCloseProgress {
    return {
      total: this.entries.length,
      completed: this.completedCount,
      failed: this.failedCount,
      pending: this.pendingCount,
      inFlight: this.inFlightCount,
      timedOut: this.timedOutCount,
      attempted: this.attemptedCount,
      attemptCount: this.totalAttemptCount,
      maximumInFlight: this.maximumInFlight,
      cancelled: this.cancelled,
    };
  }

  result(): SessionCloseBatchResult {
    const progress = this.progress();
    return {
      ...progress,
      completedIds: this.entries
        .filter((entry) => entry.state === "completed")
        .map((entry) => entry.id),
      pendingIds: this.entries
        .filter((entry) => entry.state === "pending")
        .map((entry) => entry.id),
      timedOutIds: this.entries
        .filter((entry) => entry.state === "settling")
        .map((entry) => entry.id),
      failures: this.entries
        .filter(
          (entry) => entry.state === "failed" || entry.state === "settling",
        )
        .map((entry) => ({
          id: entry.id,
          error: entry.error ?? "Session close failed",
          timedOut: entry.timedOut,
          attempts: entry.attempts,
        })),
    };
  }

  run(
    closeTarget: (target: T) => Promise<unknown> | unknown,
    options: SessionCloseRunOptions = {},
  ): Promise<SessionCloseBatchResult> {
    if (this.running) return this.running;

    const currentRun = this.runPending(closeTarget, options);
    this.running = currentRun;
    const clearRunning = () => {
      if (this.running === currentRun) this.running = undefined;
    };
    void currentRun.then(clearRunning, clearRunning);
    return currentRun;
  }

  private async runPending(
    closeTarget: (target: T) => Promise<unknown> | unknown,
    options: SessionCloseRunOptions,
  ): Promise<SessionCloseBatchResult> {
    const concurrency = normalizeSessionCloseConcurrency(options.concurrency);
    const timeoutMs = normalizeSessionCloseTimeout(options.timeoutMs);
    const yieldControl = options.yieldControl ?? defaultYieldControl;
    const candidates = this.entries.filter(
      (entry) => entry.state === "pending" || entry.state === "failed",
    );
    const controller = new AbortController();
    this.activeController = controller;
    this.cancelled =
      controller.signal.aborted || options.signal?.aborted === true;
    let cursor = 0;
    let settledSinceYield = 0;

    const isCancelled = () =>
      controller.signal.aborted || options.signal?.aborted === true;
    const publish = (updateCancellation = true) => {
      if (updateCancellation) this.cancelled = isCancelled();
      try {
        options.onProgress?.(this.progress());
      } catch {
        // Observability must never interrupt transport cleanup bookkeeping.
      }
    };
    const worker = async () => {
      while (!isCancelled()) {
        const entry = candidates[cursor++];
        if (!entry) return;

        if (entry.state === "failed") this.failedCount--;
        else this.pendingCount--;
        entry.state = "in-flight";
        if (entry.attempts === 0) this.attemptedCount++;
        entry.attempts++;
        this.totalAttemptCount++;
        entry.error = undefined;
        entry.timedOut = false;
        this.inFlightCount++;
        this.maximumInFlight = Math.max(
          this.maximumInFlight,
          this.inFlightCount,
        );
        publish();

        const attempt = await runUntilTimeout(entry.id, timeoutMs, () =>
          closeTarget(entry.value),
        );
        if (attempt.status === "timed-out") {
          entry.state = "settling";
          entry.error = attempt.error.message;
          entry.timedOut = true;
          this.timedOutCount++;
          publish();

          void attempt.settlement.then((settlement) => {
            if (entry.state !== "settling") return;
            this.timedOutCount--;
            this.inFlightCount--;
            if (settlement.status === "fulfilled") {
              entry.state = "completed";
              entry.error = undefined;
              entry.timedOut = false;
              this.completedCount++;
            } else {
              entry.state = "failed";
              entry.error = errorMessage(settlement.error);
              this.failedCount++;
            }
            try {
              options.onSettledAfterTimeout?.({
                id: entry.id,
                completed: settlement.status === "fulfilled",
                error:
                  settlement.status === "rejected" ? entry.error : undefined,
              });
            } catch {
              // UI reconciliation is observational and cannot own admission.
            }
            publish(false);
          });
        } else if (attempt.settlement.status === "fulfilled") {
          entry.state = "completed";
          this.completedCount++;
          this.inFlightCount--;
          publish();
        } else {
          entry.state = "failed";
          entry.error = errorMessage(attempt.settlement.error);
          this.failedCount++;
          this.inFlightCount--;
          publish();
        }

        settledSinceYield++;
        if (settledSinceYield >= concurrency) {
          settledSinceYield = 0;
          try {
            await yieldControl();
          } catch {
            // A scheduling hint is best-effort; continue closing captured work.
          }
        }
        if (attempt.status === "timed-out") return;
      }
    };

    publish();
    try {
      const availableSlots = Math.max(0, concurrency - this.inFlightCount);
      const workerCount = Math.min(availableSlots, candidates.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      this.cancelled = isCancelled();
      publish();
      return this.result();
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }
}
