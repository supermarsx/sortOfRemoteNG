export type RdpInputEvent = Record<string, unknown>;

export class RdpInputBackpressureError extends Error {
  constructor() {
    super(
      "Remote input is stalled and has been paused. Disconnect and reconnect to resume input.",
    );
    this.name = "RdpInputBackpressureError";
  }
}

/** Coalesces pointer motion across browser tasks with one native call in flight.
 * Control events form ordering barriers and bypass the pointer cadence.
 */
export class RdpInputScheduler {
  private sessionId: string | null = null;
  private pending: RdpInputEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private urgent = false;
  private generation = 0;
  private pendingBytes = 0;
  private terminal = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private possiblyPressed = new Map<string, RdpInputEvent>();
  private pressedBytes = 0;
  private releasesSent = false;
  private static readonly MAX_EVENTS = 512;
  private static readonly MAX_BYTES = 64 * 1024;

  constructor(
    private readonly sender: (
      sessionId: string,
      events: RdpInputEvent[],
    ) => Promise<unknown>,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly moveCadenceMs = 8,
  ) {}

  setSession(sessionId: string | null): void {
    if (this.sessionId === sessionId) return;
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.pending = [];
    this.pendingBytes = 0;
    this.terminal = false;
    this.possiblyPressed.clear();
    this.pressedBytes = 0;
    this.releasesSent = false;
    this.urgent = false;
    this.inFlight = false;
    this.sessionId = sessionId;
  }

  enqueue(events: RdpInputEvent[], immediate = false): void {
    if (!this.sessionId || this.terminal) return;
    for (const event of events) {
      let bytes: number;
      try {
        bytes = JSON.stringify(event).length * 2;
      } catch {
        this.fail();
        return;
      }
      const last = this.pending[this.pending.length - 1];
      const replacesMove =
        event.type === "MouseMove" && last?.type === "MouseMove";
      const replacedBytes = replacesMove ? JSON.stringify(last).length * 2 : 0;
      if (
        (!replacesMove &&
          this.pending.length >= RdpInputScheduler.MAX_EVENTS) ||
        this.pendingBytes - replacedBytes + bytes > RdpInputScheduler.MAX_BYTES
      ) {
        this.fail();
        return;
      }
      this.pendingBytes += bytes - replacedBytes;
      if (event.type === "MouseMove" && last?.type === "MouseMove") {
        this.pending[this.pending.length - 1] = event;
      } else {
        this.pending.push(event);
      }
      if (event.type !== "MouseMove") this.urgent = true;
    }
    this.urgent ||= immediate;
    if (this.urgent) this.flush();
    else this.scheduleMove();
  }

  private scheduleMove(): void {
    if (this.timer !== null || this.inFlight || this.pending.length === 0)
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.moveCadenceMs);
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (
      this.terminal ||
      this.inFlight ||
      !this.sessionId ||
      this.pending.length === 0
    )
      return;
    const events = this.pending;
    const generation = this.generation;
    this.pending = [];
    this.pendingBytes = 0;
    this.urgent = false;
    for (const event of events) {
      const key = this.pressKey(event);
      if (key && event.pressed === true) {
        if (
          !this.possiblyPressed.has(key) &&
          this.possiblyPressed.size >= RdpInputScheduler.MAX_EVENTS
        ) {
          this.fail();
          return;
        }
        const previous = this.possiblyPressed.get(key);
        const release = { ...event, pressed: false };
        const nextBytes =
          this.pressedBytes -
          (previous ? JSON.stringify(previous).length * 2 : 0) +
          JSON.stringify(release).length * 2;
        if (nextBytes > RdpInputScheduler.MAX_BYTES) {
          this.fail();
          return;
        }
        this.pressedBytes = nextBytes;
        this.possiblyPressed.set(key, release);
      }
    }
    this.inFlight = true;
    this.timeout = setTimeout(() => {
      this.timeout = null;
      if (generation === this.generation) this.fail();
    }, 10_000);
    let delivery: Promise<unknown>;
    try {
      delivery = this.sender(this.sessionId, events);
    } catch (error) {
      delivery = Promise.reject(error);
    }
    void delivery
      .then(() => {
        if (generation !== this.generation || this.terminal) return;
        for (const event of events) {
          const key = this.pressKey(event);
          if (key && event.pressed === false) {
            const previous = this.possiblyPressed.get(key);
            if (previous)
              this.pressedBytes = Math.max(
                0,
                this.pressedBytes - JSON.stringify(previous).length * 2,
              );
            this.possiblyPressed.delete(key);
          }
        }
      })
      .catch(this.onError)
      .finally(() => {
        if (generation !== this.generation) return;
        if (this.timeout !== null) clearTimeout(this.timeout);
        this.timeout = null;
        this.inFlight = false;
        if (this.terminal) this.releaseAfterFault();
        else if (this.urgent) this.flush();
        else this.scheduleMove();
      });
  }

  private pressKey(event: RdpInputEvent): string | null {
    if (event.type === "KeyboardKey")
      return `key:${event.scancode}:${event.extended}`;
    if (event.type === "MouseButton") return `button:${event.button}`;
    if (event.type === "Unicode") return `unicode:${event.code}`;
    return null;
  }

  private fail(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.pending = [];
    this.pendingBytes = 0;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.onError(new RdpInputBackpressureError());
    if (!this.inFlight) this.releaseAfterFault();
  }

  private releaseAfterFault(): void {
    if (this.releasesSent || !this.sessionId) return;
    this.releasesSent = true;
    const releases = [...this.possiblyPressed.values()];
    this.possiblyPressed.clear();
    this.pressedBytes = 0;
    if (releases.length === 0) return;
    // The unknown original batch has settled. Send only corrective releases,
    // once, in the same session; input stays disabled until a new session.
    try {
      void this.sender(this.sessionId, releases).catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
  }
}
