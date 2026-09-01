/**
 * Memory watchdog for one application window.
 *
 * Heap sampling is synchronous and never waits for the native system-memory
 * probe. Pressure is reported to the React owner; this module does not tear
 * down UI, clear canvases, close sessions, or claim to reclaim resources.
 */

export type MemoryPressureSeverity =
  "warning" | "critical" | "pressure" | "recovered";

export type MemoryPressureSource = "heap" | "system" | "both";
export type MemoryWatchdogOwner = symbol;

export interface MemoryWatchdogConfig {
  /** Delay between heap samples in ms (default: 5000). */
  intervalMs?: number;
  /** JS heap warning threshold in MB (default: 512). */
  warningMb?: number;
  /** JS heap critical threshold in MB (default: 1024). */
  criticalMb?: number;
  /** JS heap pressure threshold in MB (default: 1800). */
  killMb?: number;
  /** System RAM usage percentage that raises a warning (default: 85). */
  systemWarningPct?: number;
  /** System RAM usage percentage that raises pressure (default: 95). */
  systemKillPct?: number;
  /** Maximum wait for delivery of a native system sample (default: 4000). */
  systemProbeTimeoutMs?: number;
  /** Label identifying the monitored window. */
  windowLabel?: string;
  /** Callback when a warning state is first entered. */
  onWarning?: (stats: MemoryStats) => void;
  /** Callback when heap critical pressure is first entered. */
  onCritical?: (stats: MemoryStats) => void;
  /** Backward-compatible callback for entering a pressure threshold. */
  onKill?: (stats: MemoryStats) => void;
  /** Receives pressure and recovery transitions. */
  onStatusChange?: (status: MemoryWatchdogStatus) => void;
}

export interface MemoryStats {
  usedMb: number;
  totalMb: number;
  limitMb: number;
  heapPct: number;
  timestamp: number;
  trend: "rising" | "stable" | "falling";
  growthRateMbPerSec: number;
  /** Latest valid OS-level memory sample, or null when unavailable/stale. */
  system: {
    totalGb: number;
    usedGb: number;
    usedPct: number;
  } | null;
}

export interface MemoryWatchdogStatus {
  severity: MemoryPressureSeverity;
  source: MemoryPressureSource;
  stats: MemoryStats;
  windowLabel: string;
}

/** Severity as last evaluated; "normal" means no threshold is exceeded. */
export type MemoryWatchdogActiveSeverity =
  Exclude<MemoryPressureSeverity, "recovered"> | "normal";

/** The normalized thresholds actually in force for the monitored window. */
export type MemoryWatchdogThresholds = Pick<
  Required<MemoryWatchdogConfig>,
  | "intervalMs"
  | "warningMb"
  | "criticalMb"
  | "killMb"
  | "systemWarningPct"
  | "systemKillPct"
  | "windowLabel"
>;

/** Read-only view of the watchdog for diagnostics UI. */
export interface MemoryWatchdogSnapshot {
  /** False when the watchdog exists but is stopped. */
  running: boolean;
  /** False when `performance.memory` is missing (heap numbers are meaningless). */
  heapAvailable: boolean;
  severity: MemoryWatchdogActiveSeverity;
  source: MemoryPressureSource;
  stats: MemoryStats;
  thresholds: MemoryWatchdogThresholds;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface SystemMemoryInfo {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
}

interface NativeSystemProbe {
  token: symbol;
  promise: Promise<unknown>;
}

interface SystemProbeDelivery {
  token: symbol;
  generation: number;
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

type ActiveSeverity = MemoryWatchdogActiveSeverity;
type MemorySampleSource = "heap" | "system";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 30_000;
const MIN_SYSTEM_PROBE_TIMEOUT_MS = 100;
const MAX_SYSTEM_PROBE_TIMEOUT_MS = 30_000;
const MAX_SYSTEM_PROBE_BACKOFF_MS = 60_000;
const MIN_HEAP_WARNING_MB = 64;
const MIN_HEAP_CRITICAL_MB = 128;
const MIN_HEAP_PRESSURE_MB = 256;
const MAX_HEAP_WARNING_MB = 8192;
const MAX_HEAP_CRITICAL_MB = 8192;
const MAX_HEAP_PRESSURE_MB = 16_384;
const REQUIRED_CONSECUTIVE_SAMPLES = 2;
const EXIT_HYSTERESIS_RATIO = 0.9;

const noop = () => {};

const defaultConfig: Required<MemoryWatchdogConfig> = {
  intervalMs: 5000,
  warningMb: 512,
  criticalMb: 1024,
  killMb: 1800,
  systemWarningPct: 85,
  systemKillPct: 95,
  systemProbeTimeoutMs: 4000,
  windowLabel: "main",
  onWarning: noop,
  onCritical: noop,
  onKill: noop,
  onStatusChange: noop,
};

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Normalizes persisted/runtime input at the execution boundary. Invalid or
 * misordered threshold groups fail closed to known-safe defaults instead of
 * producing ambiguous severity ordering.
 */
export function normalizeMemoryWatchdogConfig(
  config: MemoryWatchdogConfig = {},
): Required<MemoryWatchdogConfig> {
  const intervalCandidate = finiteOrDefault(
    config.intervalMs,
    defaultConfig.intervalMs,
  );
  const timeoutCandidate = finiteOrDefault(
    config.systemProbeTimeoutMs,
    defaultConfig.systemProbeTimeoutMs,
  );
  const warningCandidate = finiteOrDefault(
    config.warningMb,
    defaultConfig.warningMb,
  );
  const criticalCandidate = finiteOrDefault(
    config.criticalMb,
    defaultConfig.criticalMb,
  );
  const pressureCandidate = finiteOrDefault(
    config.killMb,
    defaultConfig.killMb,
  );
  const heapThresholdsValid =
    inRange(warningCandidate, MIN_HEAP_WARNING_MB, MAX_HEAP_WARNING_MB) &&
    inRange(criticalCandidate, MIN_HEAP_CRITICAL_MB, MAX_HEAP_CRITICAL_MB) &&
    inRange(pressureCandidate, MIN_HEAP_PRESSURE_MB, MAX_HEAP_PRESSURE_MB) &&
    warningCandidate < criticalCandidate &&
    criticalCandidate < pressureCandidate;
  const systemWarningCandidate = finiteOrDefault(
    config.systemWarningPct,
    defaultConfig.systemWarningPct,
  );
  const systemPressureCandidate = finiteOrDefault(
    config.systemKillPct,
    defaultConfig.systemKillPct,
  );
  const systemThresholdsValid =
    inRange(systemWarningCandidate, 1, 99) &&
    inRange(systemPressureCandidate, 2, 100) &&
    systemWarningCandidate < systemPressureCandidate;

  return {
    intervalMs: Math.min(
      MAX_INTERVAL_MS,
      Math.max(MIN_INTERVAL_MS, intervalCandidate),
    ),
    warningMb: heapThresholdsValid ? warningCandidate : defaultConfig.warningMb,
    criticalMb: heapThresholdsValid
      ? criticalCandidate
      : defaultConfig.criticalMb,
    killMb: heapThresholdsValid ? pressureCandidate : defaultConfig.killMb,
    systemWarningPct: systemThresholdsValid
      ? systemWarningCandidate
      : defaultConfig.systemWarningPct,
    systemKillPct: systemThresholdsValid
      ? systemPressureCandidate
      : defaultConfig.systemKillPct,
    systemProbeTimeoutMs: Math.min(
      MAX_SYSTEM_PROBE_TIMEOUT_MS,
      Math.max(MIN_SYSTEM_PROBE_TIMEOUT_MS, timeoutCandidate),
    ),
    windowLabel:
      typeof config.windowLabel === "string" && config.windowLabel.trim()
        ? config.windowLabel
        : defaultConfig.windowLabel,
    onWarning:
      typeof config.onWarning === "function"
        ? config.onWarning
        : defaultConfig.onWarning,
    onCritical:
      typeof config.onCritical === "function"
        ? config.onCritical
        : defaultConfig.onCritical,
    onKill:
      typeof config.onKill === "function"
        ? config.onKill
        : defaultConfig.onKill,
    onStatusChange:
      typeof config.onStatusChange === "function"
        ? config.onStatusChange
        : defaultConfig.onStatusChange,
  };
}

function getHeapMemory(): PerformanceMemory | null {
  if (typeof performance === "undefined") return null;
  const perf = performance as Performance & { memory?: PerformanceMemory };
  const memory = perf.memory;
  if (
    !memory ||
    !Number.isFinite(memory.usedJSHeapSize) ||
    !Number.isFinite(memory.totalJSHeapSize) ||
    !Number.isFinite(memory.jsHeapSizeLimit) ||
    memory.usedJSHeapSize < 0 ||
    memory.totalJSHeapSize < 0 ||
    memory.jsHeapSizeLimit <= 0
  ) {
    return null;
  }
  return memory;
}

/** True when this runtime exposes usable `performance.memory` heap counters. */
export function isHeapMemoryAvailable(): boolean {
  return getHeapMemory() !== null;
}

function normalizeSystemMemoryInfo(value: unknown): SystemMemoryInfo | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SystemMemoryInfo>;
  if (
    !Number.isFinite(candidate.total_bytes) ||
    !Number.isFinite(candidate.used_bytes) ||
    !Number.isFinite(candidate.available_bytes) ||
    (candidate.total_bytes ?? 0) <= 0 ||
    (candidate.used_bytes ?? -1) < 0 ||
    (candidate.available_bytes ?? -1) < 0 ||
    (candidate.used_bytes ?? 0) > (candidate.total_bytes ?? 0) ||
    (candidate.available_bytes ?? 0) > (candidate.total_bytes ?? 0)
  ) {
    return null;
  }
  return candidate as SystemMemoryInfo;
}

/*
 * Tauri invoke has no cancellation primitive. This gate guarantees at most
 * one native request in this JS realm. A stopped/restarted watchdog never
 * awaits or adopts the old promise; it simply continues heap sampling until
 * the abandoned native call settles and the gate becomes available again.
 */
let activeNativeSystemProbe: NativeSystemProbe | null = null;

function launchNativeSystemProbe(): NativeSystemProbe | null {
  if (activeNativeSystemProbe) return null;

  const token = Symbol("system-memory-probe");
  const promise = (async (): Promise<unknown> => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SystemMemoryInfo>("get_system_memory_info");
  })();
  const probe = { token, promise };
  activeNativeSystemProbe = probe;
  void promise.then(
    () => {
      if (activeNativeSystemProbe?.token === token) {
        activeNativeSystemProbe = null;
      }
    },
    () => {
      if (activeNativeSystemProbe?.token === token) {
        activeNativeSystemProbe = null;
      }
    },
  );
  return probe;
}

function severityRank(severity: ActiveSeverity): number {
  switch (severity) {
    case "pressure":
      return 3;
    case "critical":
      return 2;
    case "warning":
      return 1;
    default:
      return 0;
  }
}

export class MemoryWatchdog {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private config: Required<MemoryWatchdogConfig>;
  private history: { usedMb: number; time: number }[] = [];
  private running = false;
  private generation = 0;
  private currentSeverity: ActiveSeverity = "normal";
  private currentSource: MemoryPressureSource = "heap";
  private heapSeverity: ActiveSeverity = "normal";
  private systemSeverity: ActiveSeverity = "normal";
  private heapCriticalSamples = 0;
  private systemPressureSamples = 0;
  private heapExitSamples = 0;
  private systemExitSamples = 0;
  private latestSystemMemory: SystemMemoryInfo | null = null;
  private systemDelivery: SystemProbeDelivery | null = null;
  private systemProbeFailures = 0;
  private nextSystemProbeAt = 0;

  constructor(config: MemoryWatchdogConfig = {}) {
    this.config = normalizeMemoryWatchdogConfig(config);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.addVisibilityListener();

    if (!getHeapMemory()) {
      console.warn(
        "[MemoryWatchdog] performance.memory not available; heap monitoring is disabled",
      );
    }
    console.log(
      `[MemoryWatchdog] Started for ${this.config.windowLabel}; heap warn/critical/pressure: ${this.config.warningMb}/${this.config.criticalMb}/${this.config.killMb}MB, system pressure: ${this.config.systemKillPct}%`,
    );
    if (!this.isDocumentHidden()) this.schedule(0);
  }

  updateConfig(config: MemoryWatchdogConfig): void {
    this.config = normalizeMemoryWatchdogConfig(config);
    this.resetTransitionSamples();
    if (!this.running || this.isDocumentHidden()) return;
    this.clearScheduledHeapProbe();
    this.schedule(0);
  }

  stop(): void {
    if (!this.running && !this.timeoutId && !this.systemDelivery) return;
    this.running = false;
    this.generation += 1;
    this.clearScheduledHeapProbe();
    this.cancelSystemDelivery();
    this.removeVisibilityListener();
    this.history = [];
    this.latestSystemMemory = null;
    this.nextSystemProbeAt = 0;
    this.currentSeverity = "normal";
    this.currentSource = "heap";
    this.heapSeverity = "normal";
    this.systemSeverity = "normal";
    this.resetTransitionSamples();
  }

  /** Returns an immediate heap sample plus the latest delivered system sample. */
  async getStats(signal?: AbortSignal): Promise<MemoryStats | null> {
    if (signal?.aborted) return null;
    return this.sampleStats();
  }

  /** True while heap sampling is scheduled for the monitored window. */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Normalized thresholds actually in force. These can differ from the stored
   * settings: detached windows get their own values, and invalid groups fall
   * back to defaults in `normalizeMemoryWatchdogConfig`.
   */
  getThresholds(): MemoryWatchdogThresholds {
    return {
      intervalMs: this.config.intervalMs,
      warningMb: this.config.warningMb,
      criticalMb: this.config.criticalMb,
      killMb: this.config.killMb,
      systemWarningPct: this.config.systemWarningPct,
      systemKillPct: this.config.systemKillPct,
      windowLabel: this.config.windowLabel,
    };
  }

  /**
   * Read-only view for diagnostics UI. Deliberately does not record heap
   * history, so a UI that polls this cannot skew the growth-rate/trend signal
   * the watchdog evaluates thresholds against. It also never launches a native
   * system probe; `stats.system` is whatever the watchdog last delivered.
   */
  getSnapshot(): MemoryWatchdogSnapshot {
    return {
      running: this.running,
      heapAvailable: isHeapMemoryAvailable(),
      severity: this.currentSeverity,
      source: this.currentSource,
      stats: this.sampleStats(false),
      thresholds: this.getThresholds(),
    };
  }

  private sampleStats(recordHeapHistory = true): MemoryStats {
    const heap = getHeapMemory();
    const usedMb = heap ? heap.usedJSHeapSize / MB : 0;
    const totalMb = heap ? heap.totalJSHeapSize / MB : 0;
    const limitMb = heap ? heap.jsHeapSizeLimit / MB : 0;
    const now = Date.now();

    if (heap && recordHeapHistory) {
      this.history.push({ usedMb, time: now });
      if (this.history.length > 60) this.history.shift();
    }

    const growthRate = this.calcGrowthRate();
    const trend: MemoryStats["trend"] =
      growthRate > 0.5 ? "rising" : growthRate < -0.5 ? "falling" : "stable";
    const system = this.latestSystemMemory;

    return {
      usedMb: Math.round(usedMb * 10) / 10,
      totalMb: Math.round(totalMb * 10) / 10,
      limitMb: Math.round(limitMb * 10) / 10,
      heapPct: limitMb > 0 ? Math.round((usedMb / limitMb) * 100) : 0,
      timestamp: now,
      trend,
      growthRateMbPerSec: Math.round(growthRate * 100) / 100,
      system: system
        ? {
            totalGb: Math.round((system.total_bytes / GB) * 10) / 10,
            usedGb: Math.round((system.used_bytes / GB) * 10) / 10,
            usedPct: Math.round((system.used_bytes / system.total_bytes) * 100),
          }
        : null,
    };
  }

  private calcGrowthRate(): number {
    if (this.history.length < 3) return 0;
    const recent = this.history.slice(-6);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dtSec = (last.time - first.time) / 1000;
    if (dtSec < 1) return 0;
    return (last.usedMb - first.usedMb) / dtSec;
  }

  private schedule(delayMs: number): void {
    if (!this.running || this.timeoutId !== null || this.isDocumentHidden()) {
      return;
    }

    const generation = this.generation;
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      this.runHeapProbe(generation);
    }, delayMs);
  }

  private runHeapProbe(generation: number): void {
    if (
      !this.running ||
      generation !== this.generation ||
      this.isDocumentHidden()
    ) {
      return;
    }

    try {
      this.evaluate(this.sampleStats(), "heap");
      this.startSystemProbe(generation);
    } catch (error) {
      this.heapCriticalSamples = 0;
      this.heapExitSamples = 0;
      console.warn("[MemoryWatchdog] heap probe failed", error);
    } finally {
      if (this.running && generation === this.generation) {
        this.schedule(this.config.intervalMs);
      }
    }
  }

  private startSystemProbe(generation: number): void {
    if (
      this.systemDelivery ||
      Date.now() < this.nextSystemProbeAt ||
      !this.running ||
      generation !== this.generation ||
      this.isDocumentHidden()
    ) {
      return;
    }

    const nativeProbe = launchNativeSystemProbe();
    if (!nativeProbe) return;
    const controller = new AbortController();
    const delivery: SystemProbeDelivery = {
      token: nativeProbe.token,
      generation,
      controller,
      timeoutId: setTimeout(() => {
        if (this.systemDelivery !== delivery) return;
        controller.abort();
        this.systemDelivery = null;
        this.latestSystemMemory = null;
        this.recordSystemProbeFailure();
      }, this.config.systemProbeTimeoutMs),
    };
    this.systemDelivery = delivery;

    void nativeProbe.promise.then(
      (value) => this.completeSystemProbe(delivery, value),
      () => this.completeSystemProbe(delivery, null),
    );
  }

  private completeSystemProbe(
    delivery: SystemProbeDelivery,
    value: unknown,
  ): void {
    if (this.systemDelivery !== delivery) return;
    clearTimeout(delivery.timeoutId);
    this.systemDelivery = null;
    if (
      delivery.controller.signal.aborted ||
      !this.running ||
      delivery.generation !== this.generation
    ) {
      return;
    }

    const systemMemory = normalizeSystemMemoryInfo(value);
    if (!systemMemory) {
      this.latestSystemMemory = null;
      this.recordSystemProbeFailure();
      return;
    }

    this.latestSystemMemory = systemMemory;
    this.systemProbeFailures = 0;
    this.nextSystemProbeAt = Date.now() + this.config.intervalMs;
    this.evaluate(this.sampleStats(false), "system");
  }

  private recordSystemProbeFailure(): void {
    this.systemPressureSamples = 0;
    this.systemExitSamples = 0;
    this.systemProbeFailures += 1;
    const backoffMs = Math.min(
      MAX_SYSTEM_PROBE_BACKOFF_MS,
      1000 * 2 ** Math.min(this.systemProbeFailures - 1, 6),
    );
    this.nextSystemProbeAt = Date.now() + backoffMs;
  }

  private cancelSystemDelivery(): void {
    const delivery = this.systemDelivery;
    if (!delivery) return;
    delivery.controller.abort();
    clearTimeout(delivery.timeoutId);
    this.systemDelivery = null;
  }

  private evaluate(stats: MemoryStats, sampleSource: MemorySampleSource): void {
    if (sampleSource === "heap") {
      this.updateHeapSeverity(stats);
    } else {
      this.updateSystemSeverity(stats);
    }

    const heapRank = severityRank(this.heapSeverity);
    const systemRank = severityRank(this.systemSeverity);
    const severity =
      heapRank >= systemRank ? this.heapSeverity : this.systemSeverity;
    const source: MemoryPressureSource =
      heapRank > 0 && heapRank === systemRank
        ? "both"
        : heapRank >= systemRank
          ? "heap"
          : "system";

    if (severity === "normal") {
      if (this.currentSeverity !== "normal") {
        this.notifyStatus({
          severity: "recovered",
          source: this.currentSource,
          stats,
          windowLabel: this.config.windowLabel,
        });
      }
      this.currentSeverity = "normal";
      this.currentSource = source;
      return;
    }

    const changed =
      severity !== this.currentSeverity || source !== this.currentSource;
    if (!changed) return;

    this.notifyThreshold(severity, source, stats);
    this.currentSeverity = severity;
    this.currentSource = source;
    this.notifyStatus({
      severity,
      source,
      stats,
      windowLabel: this.config.windowLabel,
    });
  }

  private updateHeapSeverity(stats: MemoryStats): void {
    const rawSeverity: ActiveSeverity =
      stats.usedMb >= this.config.killMb
        ? "pressure"
        : stats.usedMb >= this.config.criticalMb
          ? "critical"
          : stats.usedMb >= this.config.warningMb && stats.trend === "rising"
            ? "warning"
            : "normal";

    const rawRank = severityRank(rawSeverity);
    const currentRank = severityRank(this.heapSeverity);
    if (rawRank > currentRank) {
      this.heapExitSamples = 0;
      if (rawSeverity === "pressure") {
        this.heapCriticalSamples = 0;
        this.heapSeverity = "pressure";
        return;
      }

      if (rawSeverity === "critical") {
        this.heapCriticalSamples += 1;
        if (this.heapCriticalSamples >= REQUIRED_CONSECUTIVE_SAMPLES) {
          this.heapCriticalSamples = 0;
          this.heapSeverity = "critical";
        } else if (
          this.heapSeverity === "normal" &&
          stats.usedMb >= this.config.warningMb &&
          stats.trend === "rising"
        ) {
          this.heapSeverity = "warning";
        }
        return;
      }

      this.heapCriticalSamples = 0;
      this.heapSeverity = rawSeverity;
      return;
    }

    this.heapCriticalSamples = 0;
    if (rawRank === currentRank) {
      this.heapExitSamples = 0;
      return;
    }

    const exitThreshold =
      (this.heapSeverity === "pressure"
        ? this.config.killMb
        : this.heapSeverity === "critical"
          ? this.config.criticalMb
          : this.config.warningMb) * EXIT_HYSTERESIS_RATIO;
    if (stats.usedMb >= exitThreshold) {
      this.heapExitSamples = 0;
      return;
    }

    this.heapExitSamples += 1;
    if (this.heapExitSamples >= REQUIRED_CONSECUTIVE_SAMPLES) {
      this.heapExitSamples = 0;
      this.heapSeverity = rawSeverity;
    }
  }

  private updateSystemSeverity(stats: MemoryStats): void {
    if (!stats.system) return;

    const rawSeverity: ActiveSeverity =
      stats.system.usedPct >= this.config.systemKillPct
        ? "pressure"
        : stats.system.usedPct >= this.config.systemWarningPct
          ? "warning"
          : "normal";
    const rawRank = severityRank(rawSeverity);
    const currentRank = severityRank(this.systemSeverity);

    if (rawRank > currentRank) {
      this.systemExitSamples = 0;
      if (rawSeverity === "pressure") {
        this.systemPressureSamples += 1;
        if (this.systemPressureSamples >= REQUIRED_CONSECUTIVE_SAMPLES) {
          this.systemPressureSamples = 0;
          this.systemSeverity = "pressure";
        } else if (this.systemSeverity === "normal") {
          // The first pressure sample still satisfies the existing warning
          // threshold, so retain warning's immediate-entry semantics.
          this.systemSeverity = "warning";
        }
        return;
      }

      this.systemPressureSamples = 0;
      this.systemSeverity = rawSeverity;
      return;
    }

    this.systemPressureSamples = 0;
    if (rawRank === currentRank) {
      this.systemExitSamples = 0;
      return;
    }

    const exitThreshold =
      (this.systemSeverity === "pressure"
        ? this.config.systemKillPct
        : this.config.systemWarningPct) * EXIT_HYSTERESIS_RATIO;
    if (stats.system.usedPct >= exitThreshold) {
      this.systemExitSamples = 0;
      return;
    }

    this.systemExitSamples += 1;
    if (this.systemExitSamples >= REQUIRED_CONSECUTIVE_SAMPLES) {
      this.systemExitSamples = 0;
      this.systemSeverity = rawSeverity;
    }
  }

  private resetTransitionSamples(): void {
    this.heapCriticalSamples = 0;
    this.systemPressureSamples = 0;
    this.heapExitSamples = 0;
    this.systemExitSamples = 0;
  }

  private notifyThreshold(
    severity: Exclude<ActiveSeverity, "normal">,
    source: MemoryPressureSource,
    stats: MemoryStats,
  ): void {
    const systemSummary = stats.system
      ? `${stats.system.usedPct}% (${stats.system.usedGb}/${stats.system.totalGb}GB)`
      : "unavailable";
    if (severity === "pressure") {
      console.error(
        `[MemoryWatchdog] MEMORY PRESSURE in ${this.config.windowLabel}; source: ${source}, heap: ${stats.usedMb}MB, system: ${systemSummary}`,
      );
      this.callSafely(this.config.onKill, stats);
      return;
    }
    if (severity === "critical") {
      console.error(
        `[MemoryWatchdog] HEAP CRITICAL in ${this.config.windowLabel}; ${stats.usedMb}MB, growth: ${stats.growthRateMbPerSec}MB/s`,
      );
      this.callSafely(this.config.onCritical, stats);
      return;
    }
    console.warn(
      `[MemoryWatchdog] MEMORY WARNING in ${this.config.windowLabel}; source: ${source}, heap: ${stats.usedMb}MB, system: ${systemSummary}`,
    );
    this.callSafely(this.config.onWarning, stats);
  }

  private notifyStatus(status: MemoryWatchdogStatus): void {
    this.callSafely(this.config.onStatusChange, status);
  }

  private callSafely<T>(callback: (value: T) => void, value: T): void {
    try {
      callback(value);
    } catch (error) {
      console.error("[MemoryWatchdog] callback failed", error);
    }
  }

  private isDocumentHidden(): boolean {
    return (
      typeof document !== "undefined" && document.visibilityState === "hidden"
    );
  }

  private readonly handleVisibilityChange = (): void => {
    if (!this.running) return;
    if (this.isDocumentHidden()) {
      this.clearScheduledHeapProbe();
      this.cancelSystemDelivery();
      this.resetTransitionSamples();
      this.latestSystemMemory = null;
      this.nextSystemProbeAt = 0;
      return;
    }
    this.schedule(0);
  };

  private addVisibilityListener(): void {
    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  private removeVisibilityListener(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
      );
    }
  }

  private clearScheduledHeapProbe(): void {
    if (this.timeoutId === null) return;
    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }
}

let instance: MemoryWatchdog | null = null;
let activeOwner: MemoryWatchdogOwner | null = null;
const legacyOwner = Symbol("legacy-memory-watchdog-owner");

/** Starts or live-updates the one monitor owned by this JS window. */
export function startMemoryWatchdog(
  config: MemoryWatchdogConfig = {},
  owner: MemoryWatchdogOwner = legacyOwner,
): MemoryWatchdog {
  if (instance) {
    if (activeOwner === owner) {
      instance.updateConfig(config);
      instance.start();
    }
    return instance;
  }
  instance = new MemoryWatchdog(config);
  activeOwner = owner;
  instance.start();
  return instance;
}

/** Stops only the expected instance/owner; omitting owner force-cleans tests. */
export function stopMemoryWatchdog(
  expected?: MemoryWatchdog,
  owner?: MemoryWatchdogOwner,
): void {
  if (expected && instance !== expected) return;
  if (owner && activeOwner !== owner) return;
  instance?.stop();
  instance = null;
  activeOwner = null;
}

export function getMemoryWatchdog(): MemoryWatchdog | null {
  return instance;
}
