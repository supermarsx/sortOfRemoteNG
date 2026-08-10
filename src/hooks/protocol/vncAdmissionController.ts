export interface VncAdmissionLease {
  /** Idempotently return this lease to the controller. */
  release(): void;
}

type WaiterState = "queued" | "granted" | "aborted";

interface AdmissionWaiter {
  previous: AdmissionWaiter | null;
  next: AdmissionWaiter | null;
  state: WaiterState;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  resolve: (lease: VncAdmissionLease) => void;
  reject: (reason: unknown) => void;
}

const createAbortError = (): Error => {
  const error = new Error("VNC admission was aborted.");
  error.name = "AbortError";
  return error;
};

/**
 * Small FIFO admission controller for high-cost VNC IPC operations.
 *
 * Abort signals cancel only queued acquisition. Once a lease is granted, the
 * caller owns it and must release it in `finally`, even if its signal aborts
 * before the awaiting continuation runs.
 */
export class VncAdmissionController {
  readonly capacity: number;

  private available: number;
  private firstWaiter: AdmissionWaiter | null = null;
  private lastWaiter: AdmissionWaiter | null = null;
  private waiterCount = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        "VNC admission capacity must be a positive integer.",
      );
    }
    this.capacity = capacity;
    this.available = capacity;
  }

  get activeCount(): number {
    return this.capacity - this.available;
  }

  get waitingCount(): number {
    return this.waiterCount;
  }

  acquire(signal?: AbortSignal): Promise<VncAdmissionLease> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve(this.createLease());
    }

    return new Promise<VncAdmissionLease>((resolve, reject) => {
      const waiter: AdmissionWaiter = {
        previous: this.lastWaiter,
        next: null,
        state: "queued",
        signal,
        onAbort: undefined,
        resolve,
        reject,
      };
      if (this.lastWaiter) {
        this.lastWaiter.next = waiter;
      } else {
        this.firstWaiter = waiter;
      }
      this.lastWaiter = waiter;
      this.waiterCount += 1;

      if (signal) {
        waiter.onAbort = () => this.abortWaiter(waiter);
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
    });
  }

  private createLease(): VncAdmissionLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.releasePermit();
      },
    };
  }

  private abortWaiter(waiter: AdmissionWaiter): void {
    if (waiter.state !== "queued") return;
    this.unlinkWaiter(waiter);
    waiter.state = "aborted";
    this.removeAbortListener(waiter);
    waiter.reject(createAbortError());
  }

  private releasePermit(): void {
    while (this.firstWaiter) {
      const waiter = this.firstWaiter;
      this.unlinkWaiter(waiter);
      if (waiter.state !== "queued") continue;
      if (waiter.signal?.aborted) {
        waiter.state = "aborted";
        this.removeAbortListener(waiter);
        waiter.reject(createAbortError());
        continue;
      }

      waiter.state = "granted";
      this.removeAbortListener(waiter);
      waiter.resolve(this.createLease());
      return;
    }

    if (this.available >= this.capacity) {
      throw new Error("VNC admission permit accounting overflowed.");
    }
    this.available += 1;
  }

  private unlinkWaiter(waiter: AdmissionWaiter): void {
    if (waiter.previous) {
      waiter.previous.next = waiter.next;
    } else {
      this.firstWaiter = waiter.next;
    }
    if (waiter.next) {
      waiter.next.previous = waiter.previous;
    } else {
      this.lastWaiter = waiter.previous;
    }
    waiter.previous = null;
    waiter.next = null;
    this.waiterCount -= 1;
  }

  private removeAbortListener(waiter: AdmissionWaiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    waiter.onAbort = undefined;
  }
}
