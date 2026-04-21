/**
 * Memory Watchdog — monitors both JS heap and system-level RAM usage.
 *
 * **JS Heap**: Uses `performance.memory` (Chromium/WebView2) for heap stats.
 * **System RAM**: Calls `invoke("get_system_memory_info")` via Tauri to read
 * OS-level memory. Falls back gracefully if the command isn't registered.
 *
 * When system RAM exceeds 95% usage, or JS heap exceeds its kill threshold,
 * the watchdog tears down the page to protect the machine.
 */

export interface MemoryWatchdogConfig {
  /** Polling interval in ms (default: 5000) */
  intervalMs?: number;
  /** JS heap warning threshold in MB (default: 512) */
  warningMb?: number;
  /** JS heap critical threshold in MB — shows overlay (default: 1024) */
  criticalMb?: number;
  /** JS heap kill threshold in MB — tears down page (default: 1800) */
  killMb?: number;
  /** System RAM usage % at which to show a warning (default: 85) */
  systemWarningPct?: number;
  /** System RAM usage % at which to tear down (default: 95) */
  systemKillPct?: number;
  /** Label shown in the BSOD to identify which window crashed */
  windowLabel?: string;
  /** Callback when warning threshold is reached */
  onWarning?: (stats: MemoryStats) => void;
  /** Callback when critical threshold is reached */
  onCritical?: (stats: MemoryStats) => void;
  /** Callback when kill threshold is reached */
  onKill?: (stats: MemoryStats) => void;
}

export interface MemoryStats {
  usedMb: number;
  totalMb: number;
  limitMb: number;
  heapPct: number;
  timestamp: number;
  trend: "rising" | "stable" | "falling";
  growthRateMbPerSec: number;
  /** OS-level memory (null if unavailable) */
  system: {
    totalGb: number;
    usedGb: number;
    usedPct: number;
  } | null;
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

const MB = 1024 * 1024;
const GB = 1024 * MB;

function getHeapMemory(): PerformanceMemory | null {
  const perf = performance as any;
  if (perf.memory) return perf.memory as PerformanceMemory;
  return null;
}

/** Try to get OS memory from Tauri backend. Caches the "not available" result. */
let _systemMemoryAvailable: boolean | null = null;
async function getSystemMemory(): Promise<SystemMemoryInfo | null> {
  if (_systemMemoryAvailable === false) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<SystemMemoryInfo>("get_system_memory_info");
    _systemMemoryAvailable = true;
    return info;
  } catch {
    _systemMemoryAvailable = false;
    return null;
  }
}

export class MemoryWatchdog {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private config: Required<MemoryWatchdogConfig>;
  private history: { usedMb: number; time: number }[] = [];
  private warningShown = false;
  private criticalShown = false;
  private systemWarningShown = false;
  private overlayEl: HTMLDivElement | null = null;
  private killed = false;

  constructor(config: MemoryWatchdogConfig = {}) {
    this.config = {
      intervalMs: config.intervalMs ?? 5000,
      warningMb: config.warningMb ?? 512,
      criticalMb: config.criticalMb ?? 1024,
      killMb: config.killMb ?? 1800,
      systemWarningPct: config.systemWarningPct ?? 85,
      systemKillPct: config.systemKillPct ?? 95,
      windowLabel: config.windowLabel ?? "main",
      onWarning: config.onWarning ?? (() => {}),
      onCritical: config.onCritical ?? (() => {}),
      onKill: config.onKill ?? (() => {}),
    };
  }

  start(): void {
    if (this.intervalId) return;
    if (!getHeapMemory()) {
      console.warn("[MemoryWatchdog] performance.memory not available — heap monitoring disabled");
    }
    console.log(
      `[MemoryWatchdog] Started — heap warn/crit/kill: ${this.config.warningMb}/${this.config.criticalMb}/${this.config.killMb}MB, system kill: ${this.config.systemKillPct}%`,
    );
    this.intervalId = setInterval(() => this.check(), this.config.intervalMs);
    this.check();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.removeOverlay();
  }

  async getStats(): Promise<MemoryStats | null> {
    const heap = getHeapMemory();
    const sysMem = await getSystemMemory();

    const usedMb = heap ? heap.usedJSHeapSize / MB : 0;
    const totalMb = heap ? heap.totalJSHeapSize / MB : 0;
    const limitMb = heap ? heap.jsHeapSizeLimit / MB : 0;
    const now = Date.now();

    if (heap) {
      this.history.push({ usedMb, time: now });
      if (this.history.length > 60) this.history.shift();
    }

    const growthRate = this.calcGrowthRate();
    const trend: MemoryStats["trend"] =
      growthRate > 0.5 ? "rising" : growthRate < -0.5 ? "falling" : "stable";

    return {
      usedMb: Math.round(usedMb * 10) / 10,
      totalMb: Math.round(totalMb * 10) / 10,
      limitMb: Math.round(limitMb * 10) / 10,
      heapPct: limitMb > 0 ? Math.round((usedMb / limitMb) * 100) : 0,
      timestamp: now,
      trend,
      growthRateMbPerSec: Math.round(growthRate * 100) / 100,
      system: sysMem
        ? {
            totalGb: Math.round((sysMem.total_bytes / GB) * 10) / 10,
            usedGb: Math.round((sysMem.used_bytes / GB) * 10) / 10,
            usedPct: Math.round(
              (sysMem.used_bytes / sysMem.total_bytes) * 100,
            ),
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

  private async check(): Promise<void> {
    if (this.killed) return;
    const stats = await this.getStats();
    if (!stats) return;

    // ═══ System RAM kill — highest priority ═══
    if (stats.system && stats.system.usedPct >= this.config.systemKillPct) {
      console.error(
        `[MemoryWatchdog] SYSTEM RAM CRITICAL — ${stats.system.usedPct}% (${stats.system.usedGb}/${stats.system.totalGb}GB)`,
      );
      this.config.onKill(stats);
      this.forceClose(stats);
      return;
    }

    // ═══ System RAM warning ═══
    if (
      stats.system &&
      stats.system.usedPct >= this.config.systemWarningPct &&
      !this.systemWarningShown
    ) {
      this.systemWarningShown = true;
      console.warn(
        `[MemoryWatchdog] SYSTEM RAM WARNING — ${stats.system.usedPct}% (${stats.system.usedGb}/${stats.system.totalGb}GB)`,
      );
      this.showOverlay(stats);
    }
    if (
      stats.system &&
      stats.system.usedPct < this.config.systemWarningPct - 5
    ) {
      this.systemWarningShown = false;
    }

    // ═══ JS Heap kill ═══
    if (stats.usedMb >= this.config.killMb) {
      console.error(
        `[MemoryWatchdog] HEAP KILL (${this.config.killMb}MB) — ${stats.usedMb}MB, growth: ${stats.growthRateMbPerSec}MB/s`,
      );
      this.config.onKill(stats);
      this.forceClose(stats);
      return;
    }

    // ═══ JS Heap critical ═══
    if (stats.usedMb >= this.config.criticalMb) {
      if (!this.criticalShown) {
        this.criticalShown = true;
        console.error(
          `[MemoryWatchdog] HEAP CRITICAL (${this.config.criticalMb}MB) — ${stats.usedMb}MB, growth: ${stats.growthRateMbPerSec}MB/s`,
        );
        this.config.onCritical(stats);
        this.showOverlay(stats);
        this.attemptGC();
      }
      this.updateOverlay(stats);
      return;
    }

    // ═══ JS Heap warning ═══
    if (stats.usedMb >= this.config.warningMb && stats.trend === "rising") {
      if (!this.warningShown) {
        this.warningShown = true;
        console.warn(
          `[MemoryWatchdog] HEAP WARNING (${this.config.warningMb}MB) — ${stats.usedMb}MB, growth: ${stats.growthRateMbPerSec}MB/s`,
        );
        this.config.onWarning(stats);
      }
      return;
    }

    // Reset flags if memory drops
    if (stats.usedMb < this.config.warningMb * 0.8) {
      this.warningShown = false;
    }
    if (stats.usedMb < this.config.criticalMb * 0.8) {
      this.criticalShown = false;
      this.removeOverlay();
    }
  }

  private attemptGC(): void {
    try {
      document
        .querySelectorAll("img[src^='data:']")
        .forEach((img) => ((img as HTMLImageElement).src = ""));
      document.querySelectorAll("canvas").forEach((c) => {
        const ctx = c.getContext("2d");
        if (ctx && c.width > 0) ctx.clearRect(0, 0, c.width, c.height);
      });
      if ((window as any).gc) (window as any).gc();
    } catch {
      /* best effort */
    }
  }

  // ─── Overlay UI ────────────────────────────────────────────────

  private showOverlay(stats: MemoryStats): void {
    if (this.overlayEl) {
      this.updateOverlay(stats);
      return;
    }
    const el = document.createElement("div");
    el.id = "memory-watchdog-overlay";
    el.style.cssText = `
      position:fixed;bottom:12px;right:12px;z-index:2147483646;
      background:#1a1a2e;color:#e2e8f0;font-family:monospace;
      font-size:12px;padding:12px 16px;border-radius:8px;
      border:1px solid #ef4444;box-shadow:0 4px 24px rgba(0,0,0,0.5);
      max-width:340px;line-height:1.5;
    `;
    el.innerHTML = this.buildOverlayHTML(stats);
    document.body.appendChild(el);
    this.overlayEl = el;
    this.wireOverlayButtons();
  }

  private updateOverlay(stats: MemoryStats): void {
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML = this.buildOverlayHTML(stats);
    this.wireOverlayButtons();
  }

  private wireOverlayButtons(): void {
    this.overlayEl?.querySelector("#mw-close")?.addEventListener("click", () => {
      this.removeOverlay();
      this.criticalShown = false;
      this.systemWarningShown = false;
    });
    this.overlayEl?.querySelector("#mw-reload")?.addEventListener("click", () => {
      window.location.reload();
    });
  }

  private buildOverlayHTML(stats: MemoryStats): string {
    const heapPct = stats.heapPct;
    const barColor = heapPct > 80 ? "#ef4444" : heapPct > 60 ? "#f59e0b" : "#22c55e";
    const trendIcon =
      stats.trend === "rising"
        ? "&#x2191;"
        : stats.trend === "falling"
          ? "&#x2193;"
          : "&#x2192;";

    let sysHTML = "";
    if (stats.system) {
      const sysColor =
        stats.system.usedPct >= 95
          ? "#ef4444"
          : stats.system.usedPct >= 85
            ? "#f59e0b"
            : "#22c55e";
      sysHTML = `
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid #1e2650">
          System RAM: <strong>${stats.system.usedGb}GB</strong> / ${stats.system.totalGb}GB
          (<span style="color:${sysColor};font-weight:600">${stats.system.usedPct}%</span>)
        </div>
        <div style="height:4px;background:#1e2650;border-radius:2px;overflow:hidden;margin-top:4px">
          <div style="height:100%;width:${stats.system.usedPct}%;background:${sysColor};border-radius:2px;transition:width 0.3s"></div>
        </div>
      `;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:600;color:#ef4444">&#x26A0; High Memory Usage</span>
        <button id="mw-close" style="background:none;border:none;color:#8892b0;cursor:pointer;font-size:16px;padding:0 4px">&times;</button>
      </div>
      <div style="margin-bottom:4px">
        JS Heap: <strong>${stats.usedMb}MB</strong> / ${stats.limitMb}MB (${heapPct}%)
        <span style="margin-left:4px">${trendIcon} ${stats.growthRateMbPerSec}MB/s</span>
      </div>
      <div style="height:4px;background:#1e2650;border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${heapPct}%;background:${barColor};border-radius:2px;transition:width 0.3s"></div>
      </div>
      ${sysHTML}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="mw-reload" style="padding:4px 10px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">Reload</button>
      </div>
    `;
  }

  private removeOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  // ─── Force close (BSOD) ────────────────────────────────────────

  private forceClose(stats: MemoryStats): void {
    if (this.killed) return;
    this.killed = true;
    this.stop();

    const label = this.config.windowLabel;
    const isDetached = label !== "main";

    // Notify main window that this detached window was killed
    if (isDetached) {
      import("@tauri-apps/api/event").then(({ emit }) => {
        emit("detached-window-oom", { windowLabel: label, stats }).catch(() => {});
      }).catch(() => {});
    }

    const sysLine = stats.system
      ? `System RAM: ${stats.system.usedGb}GB / ${stats.system.totalGb}GB (${stats.system.usedPct}%)`
      : "";
    const reason = stats.system && stats.system.usedPct >= this.config.systemKillPct
      ? `System memory usage reached ${stats.system.usedPct}% (${stats.system.usedGb}GB / ${stats.system.totalGb}GB).`
      : `JS heap usage reached ${Math.round(stats.usedMb)}MB (limit: ${Math.round(stats.limitMb)}MB) with a growth rate of ${stats.growthRateMbPerSec}MB/s.`;
    const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const windowInfo = isDetached
      ? `<p style="font-size:11px;color:#8892b0;margin-bottom:8px;font-family:monospace">Window: ${safeLabel}</p>`
      : "";

    const el = document.createElement("div");
    el.style.cssText = `
      position:fixed;inset:0;z-index:2147483647;background:#0a0e27;color:#e2e8f0;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      display:flex;align-items:center;justify-content:center;
    `;
    el.innerHTML = `
      <div style="text-align:center;max-width:540px;padding:48px">
        <div style="font-size:80px;font-weight:100;margin-bottom:24px">:(</div>
        <h1 style="font-size:22px;font-weight:300;margin-bottom:12px">
          ${isDetached ? "This detached window" : "This window"} was stopped to protect your system
        </h1>
        <p style="font-size:14px;color:#8892b0;margin-bottom:8px;line-height:1.6">
          ${reason}
        </p>
        ${windowInfo}
        ${sysLine ? `<p style="font-size:12px;color:#8892b0;margin-bottom:24px;font-family:monospace">${sysLine}</p>` : ""}
        <div style="display:flex;gap:12px;justify-content:center">
          <button onclick="window.location.reload()" style="
            padding:10px 24px;background:#3b82f6;color:#fff;border:none;
            border-radius:6px;font-size:14px;cursor:pointer;
          ">Reload</button>
          <button onclick="window.close()" style="
            padding:10px 24px;background:#141a3a;color:#e2e8f0;
            border:1px solid #1e2650;border-radius:6px;font-size:14px;cursor:pointer;
          ">Close Window</button>
        </div>
      </div>
    `;
    document.body.innerHTML = "";
    document.body.appendChild(el);
  }
}

/** Singleton for the app-wide watchdog. */
let _instance: MemoryWatchdog | null = null;

export function startMemoryWatchdog(config?: MemoryWatchdogConfig): MemoryWatchdog {
  if (_instance) return _instance;
  _instance = new MemoryWatchdog(config);
  _instance.start();
  return _instance;
}

export function stopMemoryWatchdog(): void {
  _instance?.stop();
  _instance = null;
}

export function getMemoryWatchdog(): MemoryWatchdog | null {
  return _instance;
}
