import type { NetworkDiscoveryConfig } from "../../types/settings/settings";

interface DiscoveryCpuMetadata {
  /** Logical CPUs available to this process, used only for concurrency sizing. */
  logicalCpus?: number | null;
  /** Machine topology, for display; never a divisor for CPU utilization. */
  systemLogicalCpus?: number | null;
  physicalCores?: number | null;
  cpuSampleIntervalMs?: number | null;
  cpuSampleAgeMs?: number | null;
}

export interface DiscoveryCapacity extends DiscoveryCpuMetadata {
  /** Machine-wide utilization on a 0..100 scale, already normalized. */
  cpuPercent: number | null;
  interfaces: Array<{
    name: string;
    linkSpeedMbps: number | null;
    receiveBytesPerSecond: number | null;
    transmitBytesPerSecond: number | null;
  }>;
}

export interface DiscoverySchedulerStatus extends DiscoveryCpuMetadata {
  activeWorkers: number;
  workerLimit: number;
  probeLimit: number;
  cpuPercent: number | null;
  networkUtilizationPercent: number | null;
  throttleReason?: string;
  paused: boolean;
}
type Kind = "worker" | "probe";
type Waiter = { maximum: number; resolve: (acquired: number) => void };

/** Two global admission gates. Callers keep only a bounded pool of waiters. */
export class AdaptiveDiscoveryScheduler {
  private active = { worker: 0, probe: 0 };
  private queues: Record<Kind, Waiter[]> = { worker: [], probe: [] };
  private lastLaunch = { worker: -Infinity, probe: -Infinity };
  private timer?: ReturnType<typeof setTimeout>;
  private sampleTimer?: ReturnType<typeof setTimeout>;
  private sampleStaleTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private workersClosed = false;
  private userPaused = false;
  private capacityPaused = false;
  private highLoad = false;
  private recovering = false;
  private healthySamples = 0;
  private reason?: string;
  private coverageReason?: string;
  private cpu: number | null = null;
  private network: number | null = null;
  private cpuMetadata: DiscoveryCpuMetadata = {
    logicalCpus: null,
    systemLogicalCpus: null,
    physicalCores: null,
    cpuSampleIntervalMs: null,
    cpuSampleAgeMs: null,
  };
  private workerLimit: number;
  private probeLimit: number;
  readonly workerCap: number;
  readonly probeCap: number;
  readonly monitoring: boolean;
  private readonly abort = () => this.stop();

  constructor(
    private readonly config: NetworkDiscoveryConfig,
    private readonly signal: AbortSignal,
    private readonly publish: (status: DiscoverySchedulerStatus) => void,
  ) {
    this.workerCap = Math.min(512, config.maxConcurrent);
    this.probeCap = Math.min(
      1024,
      config.maxPortConcurrent,
      config.absoluteMaxProbes ?? 1024,
    );
    this.monitoring =
      config.adaptiveConcurrency === true ||
      config.pauseOnHighLoad === true ||
      config.maxCpuPercent !== undefined ||
      config.maxNetworkUtilizationPercent !== undefined;
    this.workerLimit =
      config.adaptiveConcurrency === true
        ? Math.min(4, this.workerCap)
        : this.workerCap;
    this.probeLimit =
      config.adaptiveConcurrency === true
        ? Math.min(8, this.probeCap)
        : this.probeCap;
    if (config.adaptiveConcurrency === true)
      this.reason =
        "Capacity metrics unavailable; conservative concurrency fallback";
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.stop();
  }

  snapshot(): DiscoverySchedulerStatus {
    return {
      ...this.cpuMetadata,
      activeWorkers: this.active.worker,
      workerLimit: this.workerLimit,
      probeLimit: this.probeLimit,
      cpuPercent: this.cpu,
      networkUtilizationPercent: this.network,
      throttleReason:
        [this.userPaused ? "Paused by user" : this.reason, this.coverageReason]
          .filter(Boolean)
          .join("; ") || undefined,
      paused: this.userPaused || this.capacityPaused,
    };
  }

  pause(): void {
    if (this.stopped || this.userPaused) return;
    this.userPaused = true;
    this.pump();
  }
  resume(): void {
    if (this.stopped || !this.userPaused) return;
    this.userPaused = false;
    this.pump();
  }

  acquire(kind: Kind): Promise<boolean> {
    return this.enqueue(kind, 1).then((count) => count > 0);
  }

  /** Atomically reserve up to a batch's available slots; never hold-and-wait. */
  acquireProbes(maximum: number): Promise<number> {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 32)
      throw new Error("Discovery probe batch must contain 1–32 probes.");
    return this.enqueue("probe", maximum);
  }

  private enqueue(kind: Kind, maximum: number): Promise<number> {
    if (
      this.stopped ||
      this.signal.aborted ||
      (kind === "worker" && this.workersClosed)
    )
      return Promise.resolve(0);
    return new Promise((resolve) => {
      this.queues[kind].push({ maximum, resolve });
      this.pump();
    });
  }
  release(kind: Kind, count = 1): void {
    this.active[kind] -= count;
    this.pump();
  }

  /** No remaining targets: release idle workers without pacing empty work. */
  closeWorkers(): void {
    this.workersClosed = true;
    for (const waiter of this.queues.worker.splice(0)) waiter.resolve(0);
  }

  /** No overlapping samples; one outstanding IPC at most, even if it stalls. */
  async startSampling(read: () => Promise<DiscoveryCapacity>): Promise<void> {
    if (!this.monitoring || this.stopped) return;
    const sample = async (): Promise<void> => {
      if (this.stopped) return;
      const stale = () => {
        if (!this.stopped) this.updateCapacity(null);
      };
      this.sampleStaleTimer = setTimeout(stale, 1500);
      try {
        const capacity = await read();
        if (!this.stopped) this.updateCapacity(capacity);
      } catch {
        stale();
      } finally {
        clearTimeout(this.sampleStaleTimer);
      }
      if (!this.stopped)
        this.sampleTimer = setTimeout(() => {
          void sample();
        }, 1000);
    };
    // Initial admission waits for a sample, but never indefinitely for IPC.
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    await Promise.race([
      sample(),
      new Promise<void>((resolve) => {
        onAbort = resolve;
        this.signal.addEventListener("abort", onAbort, { once: true });
        initialTimer = setTimeout(resolve, 1500);
      }),
    ]);
    clearTimeout(initialTimer);
    if (onAbort) this.signal.removeEventListener("abort", onAbort);
  }

  updateCapacity(capacity: DiscoveryCapacity | null): void {
    if (this.stopped) return;
    const finite = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n >= 0;
    const count = (n: unknown): number | null =>
      finite(n) && Number.isSafeInteger(n) && n >= 1 ? n : null;
    const logicalCpus = count(capacity?.logicalCpus);
    const systemLogicalCpus = count(capacity?.systemLogicalCpus);
    const physicalCores = count(capacity?.physicalCores);
    const age = capacity?.cpuSampleAgeMs;
    const interval = capacity?.cpuSampleIntervalMs;
    this.cpuMetadata = {
      logicalCpus,
      systemLogicalCpus,
      physicalCores,
      cpuSampleIntervalMs: finite(interval) && interval > 0 ? interval : null,
      cpuSampleAgeMs: finite(age) ? age : null,
    };
    // Omitted metadata remains compatible with older backends. Explicit null
    // means no valid sample; stale or malformed telemetry cannot drive growth.
    const fresh =
      (age === undefined || (finite(age) && age <= 5000)) &&
      (interval === undefined || (finite(interval) && interval > 0));
    const validCounts =
      logicalCpus !== null &&
      (capacity?.systemLogicalCpus === undefined ||
        (systemLogicalCpus !== null && logicalCpus <= systemLogicalCpus));
    this.cpu =
      fresh && finite(capacity?.cpuPercent) && capacity.cpuPercent <= 100
        ? capacity.cpuPercent
        : null;
    const interfaces = capacity?.interfaces ?? [];
    const utilization = interfaces.map((nic) =>
      finite(nic.linkSpeedMbps) &&
      nic.linkSpeedMbps > 0 &&
      finite(nic.receiveBytesPerSecond) &&
      finite(nic.transmitBytesPerSecond)
        ? ((Math.max(nic.receiveBytesPerSecond, nic.transmitBytesPerSecond) *
            8) /
            (nic.linkSpeedMbps * 1_000_000)) *
          100
        : null,
    );
    // Unknown tunnel/loopback speeds must not erase pressure on known links.
    // The value is the busiest measured interface, not global coverage.
    const measured = utilization.filter(
      (n): n is number => n !== null && Number.isFinite(n),
    );
    this.network = measured.length ? Math.max(...measured) : null;
    const partialNetwork =
      !measured.length || measured.length !== interfaces.length;
    this.coverageReason =
      [
        this.cpu === null
          ? `${finite(age) && age > 5000 ? "CPU metrics stale" : "CPU metrics unavailable"}; CPU cap not enforceable`
          : "",
        !validCounts
          ? "CPU topology unavailable or invalid; adaptive scaling limited"
          : "",
        partialNetwork
          ? `${measured.length ? "Partial network coverage" : "Network metrics unavailable"}; global network utilization cap not enforceable`
          : "",
      ]
        .filter(Boolean)
        .join("; ") || undefined;
    const hysteresis = this.highLoad ? 0.9 : 1;
    const cpuHigh =
      this.cpu !== null &&
      this.cpu >= (this.config.maxCpuPercent ?? 80) * hysteresis;
    const networkHigh =
      this.network !== null &&
      this.network >=
        (this.config.maxNetworkUtilizationPercent ?? 80) * hysteresis;
    this.highLoad = cpuHigh || networkHigh;
    this.capacityPaused = this.config.pauseOnHighLoad === true && this.highLoad;
    if (this.highLoad) {
      this.reason = `${cpuHigh ? "CPU" : "Network"} threshold reached; ${this.capacityPaused ? "new launches paused" : "reducing concurrency; scanning continues"}`;
      this.workerLimit = Math.max(1, Math.floor(this.workerLimit / 2));
      this.probeLimit = Math.max(1, Math.floor(this.probeLimit / 2));
      this.healthySamples = 0;
      this.recovering = true;
    } else if (
      this.config.adaptiveConcurrency !== true &&
      (!this.recovering || this.config.pauseOnHighLoad === true)
    ) {
      // Manual tuning means the requested concurrency, not an implicit 4/8
      // ceiling merely because a virtual interface lacks speed telemetry.
      this.reason = undefined;
      this.workerLimit = this.workerCap;
      this.probeLimit = this.probeCap;
      this.healthySamples = 0;
      this.recovering = false;
    } else if (this.cpu === null || !validCounts) {
      this.reason = "Conservative concurrency fallback";
      // Unknown samples may lower a ceiling, never undo an earlier backoff.
      this.workerLimit = Math.min(this.workerLimit, 4, this.workerCap);
      this.probeLimit = Math.min(this.probeLimit, 8, this.probeCap);
      this.healthySamples = 0;
    } else {
      this.reason = undefined;
      const cpus = logicalCpus!;
      // With partial network coverage, grow more slowly and retain modest
      // CPU-informed ceilings. These are concurrency limits, not bandwidth caps.
      const measuredWorkerCap =
        this.config.adaptiveConcurrency === true
          ? Math.min(
              this.workerCap,
              cpus * (partialNetwork ? 2 : 4),
              partialNetwork ? 32 : 512,
            )
          : this.workerCap;
      const measuredProbeCap =
        this.config.adaptiveConcurrency === true
          ? Math.min(
              this.probeCap,
              cpus * (partialNetwork ? 4 : 16),
              partialNetwork ? 64 : 1024,
            )
          : this.probeCap;
      this.workerLimit = Math.min(this.workerLimit, measuredWorkerCap);
      this.probeLimit = Math.min(this.probeLimit, measuredProbeCap);
      const nearLimit =
        this.cpu >= (this.config.maxCpuPercent ?? 80) * 0.85 ||
        (this.network !== null &&
          this.network >=
            (this.config.maxNetworkUtilizationPercent ?? 80) * 0.85);
      if (nearLimit) {
        this.reduceConcurrency();
      } else if (++this.healthySamples >= (partialNetwork ? 3 : 2)) {
        this.healthySamples = 0;
        this.workerLimit = Math.min(
          measuredWorkerCap,
          this.workerLimit + Math.max(1, Math.ceil(this.workerLimit / 2)),
        );
        this.probeLimit = Math.min(
          measuredProbeCap,
          this.probeLimit + Math.max(1, Math.ceil(this.probeLimit / 2)),
        );
      }
      this.recovering =
        this.workerLimit < measuredWorkerCap ||
        this.probeLimit < measuredProbeCap;
      if (this.recovering && !this.reason)
        this.reason = "Recovering concurrency after healthy capacity samples";
    }
    this.pump();
  }

  backoff(): void {
    if (!this.config.adaptiveConcurrency) return;
    this.reduceConcurrency();
  }

  private reduceConcurrency(): void {
    this.recovering = true;
    this.healthySamples = 0;
    this.workerLimit = Math.max(1, Math.floor(this.workerLimit / 2));
    this.probeLimit = Math.max(1, Math.floor(this.probeLimit / 2));
    this.reason = "Measured pressure; reducing concurrency";
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.sampleTimer);
    clearTimeout(this.sampleStaleTimer);
    this.signal.removeEventListener("abort", this.abort);
    for (const kind of ["worker", "probe"] as const)
      for (const waiter of this.queues[kind].splice(0)) waiter.resolve(0);
  }

  private pump(): void {
    clearTimeout(this.timer);
    if (!this.stopped && !this.userPaused && !this.capacityPaused) {
      let nextDelay = Infinity;
      for (const kind of ["worker", "probe"] as const) {
        const limit = kind === "worker" ? this.workerLimit : this.probeLimit;
        const interval =
          (kind === "worker"
            ? this.config.workerLaunchIntervalMs
            : this.config.probeLaunchIntervalMs) ?? 0;
        while (this.queues[kind].length && this.active[kind] < limit) {
          const delay = this.lastLaunch[kind] + interval - Date.now();
          if (delay > 0) {
            nextDelay = Math.min(nextDelay, delay);
            break;
          }
          const waiter = this.queues[kind].shift()!;
          // A configured launch interval still spaces every individual probe.
          const count = Math.min(
            waiter.maximum,
            limit - this.active[kind],
            interval > 0 ? 1 : 32,
          );
          this.active[kind] += count;
          this.lastLaunch[kind] = Date.now();
          waiter.resolve(count);
        }
      }
      if (Number.isFinite(nextDelay))
        this.timer = setTimeout(() => this.pump(), nextDelay);
    }
    this.publish(this.snapshot());
  }
}
