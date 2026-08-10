export const RLOGIN_POLL_INTERVAL_MS = 400;
export const RLOGIN_POLL_MAX_CONCURRENCY = 4;
export const RLOGIN_POLL_MAX_CALLS_PER_TICK = 8;

export interface RloginPollingSchedulerOptions {
  intervalMs?: number;
  maxConcurrency?: number;
  maxCallsPerTick?: number;
}

export interface RloginPollingRegistration {
  setActive(active: boolean): void;
  unregister(): void;
}

export interface RloginPollingSchedulerDiagnostics {
  registrations: number;
  activeRegistrations: number;
  timerCount: 0 | 1;
  inFlight: number;
  tick: number;
  callsThisTick: number;
  totalCalls: number;
}

interface PollingEntry {
  id: number;
  poll: () => Promise<void>;
  active: boolean;
  activationPending: boolean;
  inFlight: boolean;
  lastStartedTick: number;
}

const positiveInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.trunc(value))
    : fallback;

/**
 * Fair, renderer-local scheduler for retained RLogin snapshot recovery.
 *
 * Registrations share one timer. Each cycle admits a finite number of calls,
 * while a separate concurrency ceiling bounds unresolved IPC. Activations are
 * selected first, but still spend cycle credit and rotate through the same
 * cursor as ordinary polling.
 */
export class RloginPollingScheduler {
  private readonly intervalMs: number;
  private readonly maxConcurrency: number;
  private readonly maxCallsPerTick: number;
  private readonly entries = new Map<number, PollingEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private roundRobinCursor = 0;
  private tickNumber = 0;
  private callsRemaining = 0;
  private inFlightCount = 0;
  private totalCalls = 0;

  constructor(options: RloginPollingSchedulerOptions = {}) {
    this.intervalMs = positiveInteger(
      options.intervalMs,
      RLOGIN_POLL_INTERVAL_MS,
    );
    this.maxConcurrency = positiveInteger(
      options.maxConcurrency,
      RLOGIN_POLL_MAX_CONCURRENCY,
    );
    this.maxCallsPerTick = positiveInteger(
      options.maxCallsPerTick,
      RLOGIN_POLL_MAX_CALLS_PER_TICK,
    );
  }

  register(
    poll: () => Promise<void>,
    active: boolean,
  ): RloginPollingRegistration {
    const id = this.nextId++;
    const entry: PollingEntry = {
      id,
      poll,
      active,
      activationPending: active,
      inFlight: false,
      lastStartedTick: -1,
    };
    this.entries.set(id, entry);
    this.ensureTimerAndCycle();
    this.pump();

    let registered = true;
    return {
      setActive: (nextActive) => {
        if (!registered) return;
        const current = this.entries.get(id);
        if (!current || current.active === nextActive) return;
        current.active = nextActive;
        current.activationPending = nextActive;
        if (nextActive) this.pump();
      },
      unregister: () => {
        if (!registered) return;
        registered = false;
        this.unregister(id);
      },
    };
  }

  diagnostics(): RloginPollingSchedulerDiagnostics {
    let activeRegistrations = 0;
    for (const entry of this.entries.values()) {
      if (entry.active) activeRegistrations += 1;
    }
    return {
      registrations: this.entries.size,
      activeRegistrations,
      timerCount: this.timer === null ? 0 : 1,
      inFlight: this.inFlightCount,
      tick: this.tickNumber,
      callsThisTick:
        this.tickNumber === 0 ? 0 : this.maxCallsPerTick - this.callsRemaining,
      totalCalls: this.totalCalls,
    };
  }

  /** Test/teardown escape hatch. In-flight IPC settles naturally. */
  dispose(): void {
    this.entries.clear();
    this.stopTimer();
    this.roundRobinCursor = 0;
    this.callsRemaining = 0;
    this.tickNumber = 0;
    this.totalCalls = 0;
  }

  private ensureTimerAndCycle(): void {
    if (this.tickNumber === 0) this.beginCycle();
    if (this.timer !== null) return;
    this.timer = globalThis.setInterval(
      () => this.beginCycle(),
      this.intervalMs,
    );
  }

  private beginCycle(): void {
    this.tickNumber += 1;
    this.callsRemaining = this.maxCallsPerTick;
    this.pump();
  }

  private unregister(id: number): void {
    this.entries.delete(id);
    if (this.entries.size === 0) {
      this.stopTimer();
      this.roundRobinCursor = 0;
      this.callsRemaining = 0;
      this.tickNumber = 0;
    } else {
      this.roundRobinCursor %= this.entries.size;
      this.pump();
    }
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    globalThis.clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    while (
      this.callsRemaining > 0 &&
      this.inFlightCount < this.maxConcurrency
    ) {
      const entry = this.selectNext();
      if (!entry) return;
      this.start(entry);
    }
  }

  private selectNext(): PollingEntry | null {
    const entries = [...this.entries.values()];
    if (entries.length === 0) return null;
    this.roundRobinCursor %= entries.length;

    const select = (activationOnly: boolean): PollingEntry | null => {
      for (let offset = 0; offset < entries.length; offset += 1) {
        const index = (this.roundRobinCursor + offset) % entries.length;
        const entry = entries[index];
        if (!entry.active || entry.inFlight) continue;
        if (activationOnly) {
          if (!entry.activationPending) continue;
        } else if (
          entry.activationPending ||
          entry.lastStartedTick === this.tickNumber
        ) {
          continue;
        }
        this.roundRobinCursor = (index + 1) % entries.length;
        return entry;
      }
      return null;
    };

    return select(true) ?? select(false);
  }

  private start(entry: PollingEntry): void {
    entry.activationPending = false;
    entry.inFlight = true;
    entry.lastStartedTick = this.tickNumber;
    this.callsRemaining -= 1;
    this.inFlightCount += 1;
    this.totalCalls += 1;

    let task: Promise<void>;
    try {
      task = Promise.resolve(entry.poll());
    } catch {
      task = Promise.resolve();
    }
    void task.then(
      () => this.finish(entry),
      () => this.finish(entry),
    );
  }

  private finish(entry: PollingEntry): void {
    if (!entry.inFlight) return;
    entry.inFlight = false;
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    this.pump();
  }
}

export const rloginPollingScheduler = new RloginPollingScheduler();
