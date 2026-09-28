import { invoke } from "@tauri-apps/api/core";
import {
  DiscoveredHost,
  DiscoveredService,
} from "../../types/connection/connection";
import { NetworkDiscoveryConfig } from "../../types/settings/settings";
import { Semaphore } from "../core/semaphore";
import serviceMap from "../discovery/serviceMap";
import { DISCOVERY_SERVICE_PRESETS } from "../discovery/discoveryPresets";
import {
  fingerprintService,
  type ServiceFingerprintEvidence,
} from "../discovery/serviceFingerprint";
import { protocolFromPort } from "../connection/normalizeImportedProtocol";
import * as ipaddr from "ipaddr.js";
import { createDiscoveryTargetPlan } from "../discovery/discoveryTargetPlan";
import {
  isDiscoveryPingMethod,
  isDiscoveryProbeMethods,
  effectiveDiscoveryPingMethod,
  type DiscoveryProbeResult,
} from "../discovery/discoveryPing";
import {
  AdaptiveDiscoveryScheduler,
  type DiscoveryCapacity,
} from "../discovery/adaptiveDiscoveryScheduler";

interface CacheEntry<T> {
  value: T | null;
  timestamp: number;
}

export interface DiscoveryScanStatus {
  phase:
    | "preparing"
    | "discovering"
    | "scanning"
    | "identifying"
    | "resolving"
    | "complete";
  totalHosts: number;
  completedHosts: number;
  totalProbes: number;
  completedProbes: number;
  skippedHosts: number;
  activeProbes: number;
  currentHost?: string;
  currentPort?: number;
  activeWorkers?: number;
  workerLimit?: number;
  probeLimit?: number;
  cpuPercent?: number | null;
  logicalCpus?: number | null;
  systemLogicalCpus?: number | null;
  physicalCores?: number | null;
  cpuSampleIntervalMs?: number | null;
  cpuSampleAgeMs?: number | null;
  networkUtilizationPercent?: number | null;
  throttleReason?: string;
  discoveryWarning?: string;
  etaMs?: number | null;
  paused?: boolean;
  liveHosts?: number;
  livePorts?: number;
}

interface NativeScanObserver {
  start: (
    phase: "discovering" | "scanning" | "identifying",
    host: string,
    port?: number,
  ) => void;
  finish: () => void;
  skip: (ports: number) => void;
}

interface ScanPortResult extends ServiceFingerprintEvidence {
  isOpen: boolean;
  banner?: string;
  elapsed: number;
}

interface NativePortResult extends ServiceFingerprintEvidence {
  port: number;
  open: boolean;
  banner?: string;
  time_ms?: number;
}

interface NativeVncRfbProbeResult {
  status: "rfb" | "not_rfb" | "refused" | "timeout" | "unreachable";
  elapsedMs: number;
  version?: string;
  banner?: string;
}

const EXACT_RFB_BANNER = /^RFB \d{3}\.\d{3}$/;
const HOST_ONLY_RAW_PROTOCOLS = new Set([
  "ssh",
  "rdp",
  "mysql",
  "ftp",
  "telnet",
  "smb",
]);

const HTTP_BANNER = /^\s*HTTP\/\d|<!doctype html|<html|^\s*server:\s*\S/i;
const HTTP_SERVER_BANNER =
  /\b(apache|nginx|iis|lighttpd|caddy|tomcat|jetty|gunicorn|express|kestrel|openresty|cloudflare)\b/i;
// TLS record header: content type 0x16 (handshake), version 0x03 0x0[0-4].
// Compared byte-wise rather than by regex: the bytes are control characters,
// which a character-class regex cannot express without tripping
// `no-control-regex`. `charCodeAt` past the end yields NaN, so a banner
// shorter than three bytes fails every comparison.
const isTlsHandshakeBanner = (banner: string): boolean =>
  banner.charCodeAt(0) === 0x16 &&
  banner.charCodeAt(1) === 0x03 &&
  banner.charCodeAt(2) <= 0x04;

/**
 * Pure banner sniff: returns `http`/`https` when the banner carries web
 * evidence, otherwise `undefined`. Used before a port is declared unknown.
 */
export const sniffBannerProtocol = (
  banner?: string,
  port?: number,
): "http" | "https" | undefined => {
  if (typeof banner !== "string" || banner.length === 0) return undefined;
  if (isTlsHandshakeBanner(banner)) return "https";
  if (HTTP_BANNER.test(banner) || HTTP_SERVER_BANNER.test(banner)) {
    const byPort =
      typeof port === "number" ? protocolFromPort(port) : undefined;
    return byPort === "https" ? "https" : "http";
  }
  return undefined;
};

const extractVersion = (banner?: string): string | undefined => {
  if (!banner) return undefined;

  // Simple version extraction patterns
  const patterns = [
    /OpenSSH[_\s]+([\d.]+)/i,
    /Apache[\/\s]+([\d.]+)/i,
    /nginx[\/\s]+([\d.]+)/i,
    /Microsoft[_\s]+IIS[\/\s]+([\d.]+)/i,
    /MySQL[_\s]+([\d.]+)/i,
    /PostgreSQL[_\s]+([\d.]+)/i,
    /RFB\s+([\d.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = banner.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
};

/**
 * Compatibility entry point for evidence-first service fingerprinting.
 */
export const classifyDiscoveredService = (
  port: number,
  banner?: string,
  protocolHint?: string,
  evidence?: ServiceFingerprintEvidence,
): DiscoveredService => {
  return fingerprintService(port, banner, protocolHint, evidence);
};

const isConfirmedRfbBanner = (banner?: string): boolean =>
  typeof banner === "string" && EXACT_RFB_BANNER.test(banner);

export const getDiscoveredServiceLabel = (
  service: DiscoveredService,
): string => {
  if (
    service.protocol.toLowerCase() === "vnc" &&
    isConfirmedRfbBanner(service.banner)
  ) {
    return "VNC (RFB/TCP)";
  }
  return service.service.toUpperCase();
};

/**
 * Utility for scanning networks to discover hosts and open services.
 *
 * Native discovery uses a bounded, adaptive admission scheduler. Browser
 * strategies retain their legacy semaphores and metadata lookups. Results are
 * sorted for deterministic output; live callbacks receive detached snapshots.
 */
export class NetworkScanner {
  constructor(private readonly native = false) {}

  private scheduler?: AdaptiveDiscoveryScheduler;
  pause(): void {
    this.scheduler?.pause();
  }
  resume(): void {
    this.scheduler?.resume();
  }

  private hostnameCache = new Map<string, CacheEntry<string>>();
  private macCache = new Map<string, CacheEntry<string>>();
  /**
   * Scan an IP range and return metadata about responsive hosts.
   *
   * Native targets may combine IP literals and CIDRs; their union is checked
   * before any network work. Pause gates new native work, while cancellation
   * drains active bounded calls. onHost can update the same IP as ports and
   * hostnames arrive; consumers should upsert by IP.
   */
  async scanNetwork(
    config: NetworkDiscoveryConfig,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
    onStatus?: (status: DiscoveryScanStatus) => void,
    onHost?: (host: DiscoveredHost) => void,
  ): Promise<DiscoveredHost[]> {
    if (this.native) {
      // Retain UI selections in the saved config, but run only enabled stages.
      config = { ...config, pingMethod: effectiveDiscoveryPingMethod(config) };
      if (!config.ipRange.trim())
        throw new Error("Enter an IP address or CIDR range.");
      // Address generation does not retain IPv6 zone identifiers. Reject them
      // before parsing rather than probing a different, unscoped destination.
      if (config.ipRange.includes("%"))
        throw new Error(
          "Scoped IPv6 addresses are not supported by Network Scanner.",
        );
      // Validate before expanding ranges or scheduling any native requests.
      for (const range of config.serviceScanEnabled === false
        ? []
        : config.portRanges) {
        if (!/^\d+(?:-\d+)?$/.test(range))
          throw new Error(`Invalid port range: ${range}`);
        const [start, end = start] = range.split("-").map(Number);
        if (start < 1 || end > 65535 || end < start || end - start >= 1024)
          throw new Error(
            "Use ports 1–65535 and ranges of at most 1024 ports.",
          );
      }
      if (
        !Number.isFinite(config.timeout) ||
        config.timeout < 1000 ||
        config.timeout > 30000
      )
        throw new Error("Timeout must be between 1000 and 30000 ms.");
      for (const [name, value, min, max] of [
        ["Host concurrency", config.maxConcurrent, 1, 512],
        ["Probe concurrency", config.maxPortConcurrent, 1, 1024],
        ["Absolute probe cap", config.absoluteMaxProbes ?? 1024, 1, 1024],
        ["CPU threshold", config.maxCpuPercent ?? 80, 1, 100],
        [
          "Network threshold",
          config.maxNetworkUtilizationPercent ?? 80,
          1,
          100,
        ],
        ["Worker launch interval", config.workerLaunchIntervalMs ?? 0, 0, 5000],
        ["Probe launch interval", config.probeLaunchIntervalMs ?? 0, 0, 5000],
      ] as const) {
        if (!Number.isInteger(value) || value < min || value > max)
          throw new Error(`${name} must be between ${min} and ${max}.`);
      }
      if (!isDiscoveryPingMethod(config.pingMethod ?? "none"))
        throw new Error("Choose a supported host discovery method.");
      if (
        config.pingMethod !== "none" &&
        config.pingMethods !== undefined &&
        !isDiscoveryProbeMethods(config.pingMethods)
      )
        throw new Error(
          "Choose between 1 and 7 distinct host discovery methods.",
        );
      const pingTimeout = config.pingTimeout ?? 1000;
      if (
        !Number.isInteger(pingTimeout) ||
        pingTimeout < 100 ||
        pingTimeout > 30000
      )
        throw new Error(
          "Host discovery timeout must be between 100 and 30000 ms.",
        );
      const pingPort = config.pingPort ?? 443;
      if (!Number.isInteger(pingPort) || pingPort < 1 || pingPort > 65535)
        throw new Error("Host discovery port must be between 1 and 65535.");
      const udpPort = config.pingUdpPort ?? 53;
      if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535)
        throw new Error("UDP discovery port must be between 1 and 65535.");
      const ports = this.getPortsToScan(config);
      if (
        (!ports.length && config.pingMethod === "none") ||
        ports.length > 1024 ||
        ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)
      )
        throw new Error(
          "Choose between 1 and 1024 valid TCP ports, or enable a host discovery sweep.",
        );
      return this.scanNativeNetwork(
        config,
        onProgress,
        signal,
        onStatus,
        onHost,
      );
    }
    // Preserve browser strategies, metadata lookup, and legacy CIDR validation.
    const totalHosts = this.getHostCount(config.ipRange);
    const discoveredHosts: DiscoveredHost[] = [];
    const semaphore = new Semaphore(config.maxConcurrent);
    const portSemaphore = new Semaphore(config.maxPortConcurrent);
    const tasks: Promise<void>[] = [];
    let completed = 0;
    for await (const ip of this.generateIPRange(config.ipRange)) {
      if (signal?.aborted) break;
      tasks.push(
        (async () => {
          await semaphore.acquire();
          try {
            if (signal?.aborted) return;
            const host = await this.scanHost(ip, config, signal, portSemaphore);
            if (host && !signal?.aborted) {
              discoveredHosts.push(host);
              onHost?.(structuredClone(host));
            }
          } catch (error) {
            console.error(`Failed to scan ${ip}:`, error);
          } finally {
            completed++;
            onProgress?.((completed / totalHosts) * 100);
            semaphore.release();
          }
        })(),
      );
    }
    await Promise.all(tasks);
    return discoveredHosts.sort((a, b) => this.compareIPs(a.ip, b.ip));
  }

  private async scanNativeNetwork(
    config: NetworkDiscoveryConfig,
    onProgress?: (progress: number) => void,
    externalSignal?: AbortSignal,
    onStatus?: (status: DiscoveryScanStatus) => void,
    onHost?: (host: DiscoveredHost) => void,
  ): Promise<DiscoveredHost[]> {
    if (this.scheduler) throw new Error("A discovery scan is already running.");
    const plan = createDiscoveryTargetPlan(config.ipRange);
    const ports = this.getPortsToScan(config);
    const hasPing = effectiveDiscoveryPingMethod(config) !== "none";
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const signal = controller.signal;
    const hosts = new Map<string, DiscoveredHost>();
    const startedHosts = new Set<string>();
    const status: DiscoveryScanStatus = {
      phase: "preparing",
      totalHosts: plan.totalHosts,
      completedHosts: 0,
      totalProbes:
        plan.totalHosts *
        (ports.length + (hasPing ? 1 : 0) + (config.resolveHostnames ? 1 : 0)),
      completedProbes: 0,
      skippedHosts: 0,
      activeProbes: 0,
      activeWorkers: 0,
      liveHosts: 0,
      livePorts: 0,
      paused: false,
      etaMs: null,
    };
    let rateStart = Date.now();
    let rateStartCompleted = 0;
    let wasPaused = false;
    const emit = () => {
      const paused =
        !!status.paused || signal.aborted || status.phase === "complete";
      if (paused || wasPaused) {
        rateStart = Date.now();
        rateStartCompleted = status.completedProbes;
      }
      wasPaused = paused;
      const elapsed = Date.now() - rateStart;
      const done = status.completedProbes - rateStartCompleted;
      const eta =
        elapsed >= 1000 && done >= 2 && !paused
          ? ((status.totalProbes - status.completedProbes) * elapsed) / done
          : null;
      status.etaMs =
        eta !== null && Number.isFinite(eta)
          ? Math.max(0, Math.round(eta))
          : null;
      onStatus?.({ ...status });
    };
    const scheduler = new AdaptiveDiscoveryScheduler(
      config,
      signal,
      (snapshot) => {
        Object.assign(status, snapshot);
        emit();
      },
    );
    this.scheduler = scheduler;
    const publications = new Map<
      string,
      {
        countedPorts: number;
        lastPublished: number;
        dirty: boolean;
        timer?: ReturnType<typeof setTimeout>;
      }
    >();
    const flushHost = (ip: string) => {
      const publication = publications.get(ip);
      const host = hosts.get(ip);
      if (!publication || !host) return;
      clearTimeout(publication.timer);
      publication.timer = undefined;
      if (!publication.dirty) return;
      publication.dirty = false;
      publication.lastPublished = Date.now();
      if (onHost) {
        const snapshot = structuredClone(host);
        snapshot.openPorts.sort((a, b) => a - b);
        snapshot.services.sort((a, b) => a.port - b.port);
        onHost(snapshot);
      }
    };
    const flushPendingHosts = () => {
      // Internal hosts contain only metadata accepted before cancellation.
      // Deliver that metadata even on abort/error; late probes never enter it.
      for (const ip of publications.keys()) flushHost(ip);
    };
    signal.addEventListener("abort", flushPendingHosts, { once: true });
    const publishHost = (host: DiscoveredHost, final = false) => {
      if (signal.aborted) return;
      const initial = !hosts.has(host.ip);
      const publication = publications.get(host.ip) ?? {
        countedPorts: 0,
        lastPublished: -Infinity,
        dirty: false,
      };
      status.livePorts! += host.openPorts.length - publication.countedPorts;
      publication.countedPorts = host.openPorts.length;
      hosts.set(host.ip, host);
      publications.set(host.ip, publication);
      status.liveHosts = hosts.size;
      if (onHost) {
        publication.dirty = true;
        const remaining = 100 - (Date.now() - publication.lastPublished);
        if (initial || final || remaining <= 0) flushHost(host.ip);
        else if (publication.timer === undefined)
          publication.timer = setTimeout(() => flushHost(host.ip), remaining);
      }
      emit();
    };
    const progress = () => {
      onProgress?.(
        status.totalProbes
          ? (status.completedProbes / status.totalProbes) * 100
          : 100,
      );
      emit();
    };
    const observer: NativeScanObserver = {
      start: (phase, host, port) => {
        startedHosts.add(host);
        status.phase = phase;
        status.currentHost = host;
        status.currentPort = port;
        status.activeProbes++;
        emit();
      },
      finish: () => {
        status.activeProbes--;
        status.completedProbes++;
        progress();
      },
      skip: (count) => {
        status.skippedHosts++;
        status.completedProbes += count;
        progress();
      },
    };
    const iterator = plan.hosts();
    let claimedHosts = 0;
    let unavailableHosts = 0;
    let failure: unknown;
    let failed = false;
    const scanHost = async (ip: string) => {
      const started = Date.now();
      const host: DiscoveredHost = {
        ip,
        openPorts: [],
        services: [],
        responseTime: 0,
        reachability: "not-checked",
      };
      if (hasPing) {
        if (!(await scheduler.acquire("probe"))) return;
        try {
          if (signal.aborted) return;
          observer.start(
            "discovering",
            ip,
            config.pingMethod === "tcp" ? (config.pingPort ?? 443) : undefined,
          );
          try {
            const result = await invoke<DiscoveryProbeResult>(
              "probe_discovery_host",
              {
                host: ip,
                method: config.pingMethod,
                timeoutMs: config.pingTimeout ?? 1000,
                port: config.pingPort ?? 443,
                ...(config.pingMethods &&
                (config.pingMethod === "adaptive" ||
                  config.pingMethod === "combined")
                  ? { methods: config.pingMethods }
                  : {}),
                ...(config.pingMethod === "udp" ||
                config.pingMethod === "adaptive" ||
                config.pingMethod === "combined"
                  ? { udpPort: config.pingUdpPort ?? 53 }
                  : {}),
              },
            );
            host.reachability = result.reachable
              ? "responsive"
              : result.status === "unavailable"
                ? "unavailable"
                : "unresponsive";
            host.responseTime = result.elapsed_ms ?? Date.now() - started;
            if (result.mac_address) host.macAddress = result.mac_address;
            if (result.attempts)
              host.discoveryProbes = result.attempts.map((attempt) => ({
                method: attempt.method,
                status: attempt.status,
                elapsedMs: attempt.elapsed_ms,
                ...(attempt.error ? { error: attempt.error } : {}),
              }));
            if (host.reachability === "unavailable") {
              unavailableHosts++;
              status.discoveryWarning =
                result.error ||
                "Host discovery unavailable on this platform or target; service probes can still run.";
            }
          } finally {
            observer.finish();
          }
        } finally {
          scheduler.release("probe");
        }
        if (signal.aborted) return;
        if (host.reachability === "responsive") publishHost(host);
        else if (
          host.reachability === "unresponsive" &&
          config.scanUnresponsiveHosts === false
        ) {
          observer.skip(ports.length + (config.resolveHostnames ? 1 : 0));
          return;
        }
      }
      let nextPort = 0;
      const acceptResult = (port: number, result: ScanPortResult) => {
        if (signal.aborted || !result.isOpen) return;
        host.openPorts.push(port);
        host.services.push(
          classifyDiscoveredService(
            port,
            result.banner,
            this.getProtocolForPort(port, config),
            result,
          ),
        );
        host.responseTime = Date.now() - started;
        publishHost(host);
      };
      const batchSize = config.nativeBatchProbes === true ? 32 : 1;
      // Bound the complete run's port lanes to <= probeCap + workerCap.
      // A single host can still use the entire global probe allowance.
      const laneCount = Math.min(
        ports.length,
        Math.ceil(
          scheduler.probeCap /
            (Math.min(plan.totalHosts, scheduler.workerCap) * batchSize),
        ),
      );
      const lanes = Array.from({ length: laneCount }, async () => {
        while (!signal.aborted && nextPort < ports.length) {
          if (config.nativeBatchProbes === true) {
            // Claim real work before awaiting permits, then reserve the whole
            // granted batch atomically. No partial permits can deadlock peers.
            const chunk = ports.slice(nextPort, nextPort + batchSize);
            nextPort += chunk.length;
            let offset = 0;
            while (!signal.aborted && offset < chunk.length) {
              const count = await scheduler.acquireProbes(
                chunk.length - offset,
              );
              if (!count) return;
              const batch = chunk.slice(offset, offset + count);
              offset += count;
              try {
                if (signal.aborted) return;
                const results = await this.scanPortBatch(
                  ip,
                  batch,
                  config,
                  signal,
                  observer,
                );
                for (let index = 0; index < batch.length; index++)
                  acceptResult(batch[index], results[index]);
              } catch (error) {
                abort();
                throw error;
              } finally {
                scheduler.release("probe", count);
              }
            }
            continue;
          }
          // Reserve before admission: a paused waiter always owns real work.
          const port = ports[nextPort++];
          if (!(await scheduler.acquire("probe"))) return;
          try {
            if (signal.aborted) return;
            const result = await this.scanPort(
              ip,
              port,
              config,
              signal,
              this.getProtocolForPort(port, config),
              observer,
            );
            if (signal.aborted) return;
            // Closed/filtered ports normally time out; they are not evidence
            // of local resource pressure. Only measured capacity throttles.
            acceptResult(port, result);
          } catch (error) {
            abort();
            throw error;
          } finally {
            scheduler.release("probe");
          }
        }
      });
      const results = await Promise.allSettled(lanes);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      if (signal.aborted) return;
      if (!hosts.has(ip)) {
        if (config.resolveHostnames) {
          status.completedProbes++;
          progress();
        }
        return;
      }
      host.responseTime = Date.now() - started;
      if (
        config.resolveHostnames === true &&
        (await scheduler.acquire("probe"))
      ) {
        try {
          if (signal.aborted) return;
          status.phase = "resolving";
          status.currentHost = ip;
          status.currentPort = undefined;
          status.activeProbes++;
          emit();
          try {
            // Targets are validated literals; IPC applies this bounded timeout.
            const hostname = await this.resolveNativeHostname(
              ip,
              config.hostnameTtl,
              Math.min(config.timeout, 5000),
              signal,
            );
            if (!signal.aborted) {
              host.hostname = hostname;
              const publication = publications.get(ip);
              if (publication && onHost) publication.dirty = true;
            }
          } finally {
            status.activeProbes--;
            status.completedProbes++;
            progress();
          }
        } finally {
          scheduler.release("probe");
        }
      }
      publishHost(host, true);
    };
    try {
      Object.assign(status, scheduler.snapshot());
      emit();
      await scheduler.startSampling(() =>
        invoke<DiscoveryCapacity>("get_discovery_capacity"),
      );
      await Promise.all(
        Array.from(
          { length: Math.min(plan.totalHosts, scheduler.workerCap) },
          async () => {
            while (!signal.aborted && claimedHosts < plan.totalHosts) {
              if (!(await scheduler.acquire("worker"))) return;
              let ip: string | undefined;
              try {
                if (signal.aborted) return;
                const next = iterator.next();
                if (next.done) return;
                ip = next.value;
                claimedHosts++;
                if (claimedHosts === plan.totalHosts) scheduler.closeWorkers();
                await scanHost(ip);
              } catch (error) {
                if (!failed) {
                  failed = true;
                  failure = error;
                }
                abort();
              } finally {
                if (ip !== undefined && startedHosts.has(ip))
                  status.completedHosts++;
                scheduler.release("worker");
              }
            }
          },
        ),
      );
      if (failed) throw failure;
      if (
        !signal.aborted &&
        !ports.length &&
        unavailableHosts === plan.totalHosts
      )
        throw new Error(
          status.discoveryWarning ||
            "Host discovery unavailable for these targets.",
        );
      for (const host of hosts.values()) {
        host.openPorts.sort((a, b) => a - b);
        host.services.sort((a, b) => a.port - b.port);
      }
      return Array.from(hosts.values()).sort((a, b) =>
        this.compareIPs(a.ip, b.ip),
      );
    } finally {
      scheduler.stop();
      this.scheduler = undefined;
      externalSignal?.removeEventListener("abort", abort);
      signal.removeEventListener("abort", flushPendingHosts);
      flushPendingHosts();
      status.phase = "complete";
      status.currentHost = undefined;
      status.currentPort = undefined;
      status.paused = false;
      status.throttleReason = undefined;
      status.etaMs = null;
      emit();
    }
  }

  private async resolveNativeHostname(
    ip: string,
    ttl: number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    this.purgeCache(this.hostnameCache, ttl);
    const cached = this.hostnameCache.get(ip);
    if (cached) return cached.value ?? undefined;
    try {
      const hostname = await invoke<string | null>("discovery_reverse_dns", {
        host: ip,
        timeoutMs,
      });
      if (signal.aborted) return undefined;
      const value =
        typeof hostname === "string" && hostname.trim()
          ? hostname.trim()
          : null;
      this.hostnameCache.set(ip, { value, timestamp: Date.now() });
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }

  clearCaches(): void {
    this.hostnameCache.clear();
    this.macCache.clear();
  }

  private async *generateIPRange(cidr: string): AsyncGenerator<string> {
    let addr: ipaddr.IPv4 | ipaddr.IPv6;
    let prefix: number;

    const [ipPart] = cidr.split("/");
    // ipaddr.js accepts IPv4 addresses with fewer than four octets.
    // Reject such shorthand forms to keep input validation strict.
    if (ipPart && !ipPart.includes(":")) {
      const octetCount = ipPart.split(".").length;
      if (octetCount !== 4) {
        throw new Error(`IPv4 address must contain four octets: ${ipPart}`);
      }
    }

    try {
      [addr, prefix] = ipaddr.parseCIDR(cidr);
    } catch {
      throw new Error(`Malformed CIDR string: ${cidr}`);
    }

    if (addr.kind() === "ipv4") {
      if (prefix < 24 || prefix > (this.native ? 32 : 30)) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /24 to /${this.native ? 32 : 30} are supported`,
        );
      }
      const octets = (addr as ipaddr.IPv4).octets;
      const hostBits = 32 - prefix;
      const mask = (0xffffffff << hostBits) >>> 0;
      const ipNum =
        ((octets[0] << 24) |
          (octets[1] << 16) |
          (octets[2] << 8) |
          octets[3]) >>>
        0;
      const networkNum = ipNum & mask;
      const includeAll = this.native && prefix >= 31;
      const hostCount = Math.pow(2, hostBits) - (includeAll ? 0 : 2);
      for (
        let i = includeAll ? 0 : 1;
        i < hostCount + (includeAll ? 0 : 1);
        i++
      ) {
        const ipInt = (networkNum + i) >>> 0;
        yield `${(ipInt >>> 24) & 0xff}.${(ipInt >>> 16) & 0xff}.${
          (ipInt >>> 8) & 0xff
        }.${ipInt & 0xff}`;
      }
      return;
    }

    if (addr.kind() === "ipv6") {
      if (prefix < 112 || prefix > 128) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /112 to /128 are supported`,
        );
      }
      const parts = (addr as ipaddr.IPv6).parts;
      let ipBig = 0n;
      for (const part of parts) {
        ipBig = (ipBig << 16n) + BigInt(part);
      }
      const hostBits = 128 - prefix;
      const networkBig = (ipBig >> BigInt(hostBits)) << BigInt(hostBits);
      const hostCount = 1n << BigInt(hostBits);
      for (let i = 0n; i < hostCount; i++) {
        const ipInt = networkBig + i;
        const ipParts: number[] = [];
        for (let shift = 112n; shift >= 0n; shift -= 16n) {
          ipParts.push(Number((ipInt >> shift) & 0xffffn));
        }
        yield new (ipaddr as any).IPv6(ipParts).toString();
      }
      return;
    }

    throw new Error("Unsupported IP address type");
  }

  private getHostCount(cidr: string): number {
    let addr: ipaddr.IPv4 | ipaddr.IPv6;
    let prefix: number;

    const [ipPart] = cidr.split("/");
    if (ipPart && !ipPart.includes(":")) {
      const octetCount = ipPart.split(".").length;
      if (octetCount !== 4) {
        throw new Error(`IPv4 address must contain four octets: ${ipPart}`);
      }
    }

    try {
      [addr, prefix] = ipaddr.parseCIDR(cidr);
    } catch {
      throw new Error(`Malformed CIDR string: ${cidr}`);
    }

    if (addr.kind() === "ipv4") {
      if (prefix < 24 || prefix > (this.native ? 32 : 30)) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /24 to /${this.native ? 32 : 30} are supported`,
        );
      }
      const hostBits = 32 - prefix;
      return Math.pow(2, hostBits) - (this.native && prefix >= 31 ? 0 : 2);
    }

    if (addr.kind() === "ipv6") {
      if (prefix < 112 || prefix > 128) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /112 to /128 are supported`,
        );
      }
      const hostBits = 128 - prefix;
      return Number(1n << BigInt(hostBits));
    }

    throw new Error("Unsupported IP address type");
  }

  private async scanHost(
    ip: string,
    config: NetworkDiscoveryConfig,
    signal?: AbortSignal,
    portSemaphore = new Semaphore(config.maxPortConcurrent),
    onProbeError?: () => void,
    observer?: NativeScanObserver,
  ): Promise<DiscoveredHost | null> {
    const startTime = Date.now();
    const openPorts: number[] = [];
    const services: DiscoveredService[] = [];

    // Get ports to scan
    const portsToScan = this.getPortsToScan(config);

    let reachability: DiscoveredHost["reachability"] = "not-checked";
    const method = effectiveDiscoveryPingMethod(config);
    if (this.native && method !== "none") {
      await portSemaphore.acquire();
      try {
        if (signal?.aborted) return null;
        observer?.start(
          "discovering",
          ip,
          method === "tcp" ? (config.pingPort ?? 443) : undefined,
        );
        try {
          const result = await invoke<{
            reachable: boolean;
            elapsed_ms: number;
            error?: string;
          }>("probe_discovery_host", {
            host: ip,
            method,
            timeoutMs: config.pingTimeout ?? 1000,
            port: config.pingPort ?? 443,
          });
          reachability = result.reachable ? "responsive" : "unresponsive";
        } finally {
          observer?.finish();
        }
      } catch (error) {
        onProbeError?.();
        throw error;
      } finally {
        portSemaphore.release();
      }
      if (signal?.aborted) return null;
      if (
        reachability === "unresponsive" &&
        config.scanUnresponsiveHosts === false
      ) {
        observer?.skip(portsToScan.length);
        return null;
      }
    }

    // Scan ports with a concurrency limit
    const portPromises = portsToScan.map(async (port) => {
      await portSemaphore.acquire();
      try {
        if (signal?.aborted) {
          return { isOpen: false, elapsed: 0 };
        }
        return await this.scanPort(
          ip,
          port,
          config,
          signal,
          this.getProtocolForPort(port, config),
          observer,
        );
      } catch (error) {
        onProbeError?.();
        throw error;
      } finally {
        portSemaphore.release();
      }
    });
    // Drain each host's port tasks too: a rejected port must not let its host
    // release the run while sibling native probes are still in flight.
    const portResults = this.native
      ? (await Promise.allSettled(portPromises)).map((result) => {
          if (result.status === "rejected") throw result.reason;
          return result.value;
        })
      : await Promise.all(portPromises);

    if (signal?.aborted) {
      return null;
    }

    portResults.forEach((result, index) => {
      if (result.isOpen) {
        const port = portsToScan[index];
        const protocol = this.getProtocolForPort(port, config);
        if (
          !this.native &&
          protocol === "vnc" &&
          !isConfirmedRfbBanner(result.banner)
        ) {
          return;
        }
        openPorts.push(port);

        const service = this.identifyService(
          port,
          result.banner,
          protocol,
          result,
        );
        if (service) {
          services.push(service);
        }
      }
    });

    if (
      openPorts.length === 0 &&
      !(this.native && reachability === "responsive")
    ) {
      return null;
    }

    const responseTime = Date.now() - startTime;
    if (this.native)
      return { ip, openPorts, services, responseTime, reachability };
    const hostname = await this.resolveHostname(ip, config.hostnameTtl, signal);
    if (signal?.aborted) {
      return null;
    }
    const macAddress = await this.getMacAddress(ip, config.macTtl, signal);
    if (signal?.aborted) {
      return null;
    }

    return {
      ip,
      hostname,
      openPorts,
      services,
      responseTime,
      macAddress,
    };
  }

  private getPortsToScan(config: NetworkDiscoveryConfig): number[] {
    if (config.serviceScanEnabled === false) return [];
    const ports = new Set<number>();

    // Add ports from ranges
    config.portRanges.forEach((range) => {
      if (range.includes("-")) {
        const [start, end] = range.split("-").map(Number);
        for (let port = start; port <= end; port++) {
          ports.add(port);
        }
      } else {
        ports.add(Number(range));
      }
    });

    // Add custom ports for protocols
    config.protocols.forEach((protocol) => {
      const customPorts = config.customPorts[protocol] || [];
      customPorts.forEach((port) => ports.add(port));
    });

    return Array.from(ports).sort((a, b) => a - b);
  }

  private getProtocolForPort(
    port: number,
    config: NetworkDiscoveryConfig,
  ): string {
    const configuredProtocol = config.protocols.find((protocol) =>
      config.customPorts[protocol]?.includes(port),
    );
    return (
      DISCOVERY_SERVICE_PRESETS.find(
        (preset) => preset.id === configuredProtocol,
      )?.protocol ||
      configuredProtocol ||
      serviceMap[port]?.protocol ||
      protocolFromPort(port) ||
      "default"
    );
  }

  private getHttpScheme(
    port: number,
    config: NetworkDiscoveryConfig,
  ): "http" | "https" | undefined {
    if (config.identifyServices !== true) return undefined;
    const selected = config.protocols.find((id) =>
      config.customPorts[id]?.includes(port),
    );
    if (selected) {
      const preset = DISCOVERY_SERVICE_PRESETS.find(
        (item) => item.id === selected,
      );
      const scheme = preset?.httpScheme ?? preset?.protocol ?? selected;
      return scheme === "http" || scheme === "https" ? scheme : undefined;
    }
    const protocol = protocolFromPort(port);
    return protocol === "http" || protocol === "https" ? protocol : undefined;
  }

  private getIdentificationProtocol(
    port: number,
    config: NetworkDiscoveryConfig,
  ): string | undefined {
    if (config.identifyServices !== true) return undefined;
    const protocol = this.getProtocolForPort(port, config);
    return ["smb", "rdp", "postgresql"].includes(protocol)
      ? protocol
      : undefined;
  }

  private nativeResult(
    result: NativePortResult,
    httpScheme: "http" | "https" | undefined,
    signal?: AbortSignal,
  ): ScanPortResult {
    return {
      ...result,
      isOpen: !signal?.aborted && result.open,
      banner: result.banner?.trim(),
      elapsed: result.time_ms ?? 0,
      httpScheme,
    };
  }

  private async scanPortBatch(
    ip: string,
    ports: number[],
    config: NetworkDiscoveryConfig,
    signal: AbortSignal,
    observer: NativeScanObserver,
  ): Promise<ScanPortResult[]> {
    const probes = ports.map((port) => ({
      port,
      ...(this.getHttpScheme(port, config)
        ? { identifyHttp: this.getHttpScheme(port, config) }
        : {}),
      ...(this.getIdentificationProtocol(port, config)
        ? { identifyProtocol: this.getIdentificationProtocol(port, config) }
        : {}),
    }));
    for (const probe of probes)
      observer.start(
        probe.identifyHttp || probe.identifyProtocol
          ? "identifying"
          : "scanning",
        ip,
        probe.port,
      );
    try {
      const results = await invoke<NativePortResult[]>(
        "probe_discovery_batch",
        {
          host: ip,
          probes,
          timeoutSecs: Math.ceil(config.timeout / 1000),
          parallelism: probes.length,
        },
      );
      if (
        !Array.isArray(results) ||
        results.length !== ports.length ||
        results.some(
          (result, index) =>
            result.port !== ports[index] || typeof result.open !== "boolean",
        )
      )
        throw new Error(
          "Native discovery batch returned malformed results. Restart the app after updating the scanner.",
        );
      return results.map((result, index) =>
        this.nativeResult(result, probes[index].identifyHttp, signal),
      );
    } finally {
      for (const _port of ports) observer.finish();
    }
  }

  private async scanPort(
    ip: string,
    port: number,
    config: NetworkDiscoveryConfig,
    signal?: AbortSignal,
    protocolHint?: string,
    observer?: NativeScanObserver,
  ): Promise<ScanPortResult> {
    if (this.native) {
      if (signal?.aborted) return { isOpen: false, elapsed: 0 };
      // Existing cross-platform Tokio TCP probe. Keep the semaphore occupied
      // until this bounded call settles; cancellation prevents queued probes.
      const httpScheme = this.getHttpScheme(port, config);
      const identifyProtocol = this.getIdentificationProtocol(port, config);
      observer?.start(
        httpScheme || identifyProtocol ? "identifying" : "scanning",
        ip,
        port,
      );
      try {
        const result = await invoke<NativePortResult>("check_port", {
          host:
            !httpScheme && !identifyProtocol && ip.includes(":")
              ? `[${ip}]`
              : ip,
          port,
          timeoutSecs: Math.ceil(config.timeout / 1000),
          ...(httpScheme ? { identifyHttp: httpScheme } : {}),
          ...(identifyProtocol ? { identifyProtocol } : {}),
        });
        return this.nativeResult(result, httpScheme, signal);
      } finally {
        observer?.finish();
      }
    }
    const protocol = protocolHint || serviceMap[port]?.protocol || "default";
    if (HOST_ONLY_RAW_PROTOCOLS.has(protocol)) {
      // The prior native scan established host reachability only. A browser
      // WebSocket handshake does not prove any of these raw TCP protocols, so
      // retain them as ping-only hosts until a protocol-specific native probe
      // is implemented.
      return { isOpen: false, elapsed: 0 };
    }
    const strategies =
      protocol === "vnc"
        ? (["rfb"] as const)
        : config.probeStrategies[protocol] ||
          config.probeStrategies.default || ["websocket"];

    for (const strategy of strategies) {
      if (signal?.aborted) {
        return { isOpen: false, elapsed: 0 };
      }

      if (strategy === "websocket") {
        const wsResult = await this.probeWebSocket(
          ip,
          port,
          config.timeout,
          signal,
        );
        if (wsResult !== null) {
          if (wsResult.isOpen || strategies.length === 1) {
            return wsResult;
          }
          // If websocket reported closed and other strategies remain, continue loop
          continue;
        }
        // wsResult null means creation failed; fall through to next strategy
      } else if (strategy === "http") {
        const httpResult = await this.probeHttp(
          ip,
          port,
          config.timeout,
          signal,
        );
        if (httpResult !== null) {
          return httpResult;
        }
      } else if (strategy === "rfb") {
        const rfbResult = await this.probeVncRfb(
          ip,
          port,
          config.timeout,
          signal,
        );
        if (rfbResult !== null) {
          return rfbResult;
        }
      }
    }

    return { isOpen: false, elapsed: 0 };
  }

  private async probeVncRfb(
    ip: string,
    port: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number } | null> {
    if (signal?.aborted) {
      return { isOpen: false, elapsed: 0 };
    }

    const abortResult = Symbol("vnc-discovery-aborted");
    let abortHandler: (() => void) | undefined;
    const aborted = new Promise<typeof abortResult>((resolve) => {
      abortHandler = () => resolve(abortResult);
      signal?.addEventListener("abort", abortHandler, { once: true });
    });
    const invoked = invoke<NativeVncRfbProbeResult>("probe_vnc_rfb", {
      host: ip,
      port,
      timeoutMs: timeout,
    }).catch(() => null);

    const result = await Promise.race([invoked, aborted]);
    if (abortHandler) {
      signal?.removeEventListener("abort", abortHandler);
    }
    if (result === abortResult || signal?.aborted) {
      return { isOpen: false, elapsed: 0 };
    }
    if (!result) {
      // Browser-only builds cannot perform a raw TCP probe. Fail closed rather
      // than claiming that a WebSocket or HTTP response is a VNC endpoint.
      return null;
    }

    const confirmed =
      result.status === "rfb" && isConfirmedRfbBanner(result.banner);
    return {
      isOpen: confirmed,
      banner: confirmed ? result.banner : undefined,
      elapsed: result.elapsedMs,
    };
  }

  private async probeWebSocket(
    ip: string,
    port: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ isOpen: boolean; elapsed: number } | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let resolved = false;
      let ws: WebSocket;

      if (signal?.aborted) {
        resolve({ isOpen: false, elapsed: Date.now() - startTime });
        return;
      }

      try {
        let host = ip;
        try {
          if (ipaddr.isValid(ip)) {
            const addr = ipaddr.parse(ip);
            if (addr.kind() === "ipv6") {
              host = `[${addr.toString()}]`;
            }
          }
        } catch {
          // If the IP is malformed, fall back to the raw string.
        }
        ws = new WebSocket(`ws://${host}:${port}`);
      } catch {
        resolve(null); // Creation failed, try next strategy
        return;
      }

      const abortHandler = () => {
        ws.close();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      };
      signal?.addEventListener("abort", abortHandler);

      const timeoutId = setTimeout(() => {
        ws.close();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      }, timeout);

      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abortHandler);
      };

      ws.onopen = () => {
        cleanup();
        ws.close();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: true, elapsed: Date.now() - startTime });
        }
      };

      ws.onerror = () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      };

      ws.onclose = (event) => {
        cleanup();
        if (!resolved) {
          resolved = true;
          if (event.wasClean) {
            resolve({ isOpen: true, elapsed: Date.now() - startTime });
          } else {
            resolve({ isOpen: false, elapsed: Date.now() - startTime });
          }
        }
      };
    });
  }

  private async probeHttp(
    ip: string,
    port: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number } | null> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let host = ip;
      try {
        if (ipaddr.isValid(ip)) {
          const addr = ipaddr.parse(ip);
          if (addr.kind() === "ipv6") {
            host = `[${addr.toString()}]`;
          }
        }
      } catch {
        // If the IP is malformed, fall back to the raw string.
      }
      const url = `http://${host}:${port}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "HEAD",
          signal: signal
            ? this.mergeSignals(signal, controller.signal)
            : controller.signal,
        });
      } catch {
        response = await fetch(url, {
          method: "GET",
          signal: signal
            ? this.mergeSignals(signal, controller.signal)
            : controller.signal,
        });
      }
      clearTimeout(timer);
      const banner = response.headers.get("server") || undefined;
      return { isOpen: true, banner, elapsed: Date.now() - startTime };
    } catch {
      clearTimeout(timer);
      return { isOpen: false, elapsed: Date.now() - startTime };
    }
  }

  private mergeSignals(
    signalA: AbortSignal,
    signalB: AbortSignal,
  ): AbortSignal {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signalA.aborted || signalB.aborted) {
      controller.abort();
    } else {
      signalA.addEventListener("abort", abort);
      signalB.addEventListener("abort", abort);
    }
    return controller.signal;
  }

  private identifyService(
    port: number,
    banner?: string,
    protocolHint?: string,
    evidence?: ServiceFingerprintEvidence,
  ): DiscoveredService | null {
    return classifyDiscoveredService(port, banner, protocolHint, evidence);
  }

  private extractVersion(banner?: string): string | undefined {
    return extractVersion(banner);
  }

  private purgeCache<T>(cache: Map<string, CacheEntry<T>>, ttl: number): void {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > ttl) {
        cache.delete(key);
      }
    }
  }

  private async resolveHostname(
    ip: string,
    ttl: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    this.purgeCache(this.hostnameCache, ttl);
    const cached = this.hostnameCache.get(ip);
    if (cached) {
      // Cache stores null for negative lookups to avoid repeat network calls.
      return cached.value || undefined;
    }

    try {
      const response = await fetch(
        `/api/resolve-hostname?ip=${encodeURIComponent(ip)}`,
        { signal },
      );
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const data = await response.json();
      const hostname = data.hostname as string | undefined;
      this.hostnameCache.set(ip, {
        value: hostname ?? null,
        timestamp: Date.now(),
      });
      return hostname;
    } catch {
      if (!signal?.aborted) {
        this.hostnameCache.set(ip, { value: null, timestamp: Date.now() });
      }
      return undefined;
    }
  }

  private async getMacAddress(
    ip: string,
    ttl: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    this.purgeCache(this.macCache, ttl);
    const cached = this.macCache.get(ip);
    if (cached) {
      // Returning early prevents additional ARP lookups for frequently queried IPs.
      return cached.value || undefined;
    }

    try {
      const response = await fetch(
        `/api/arp-lookup?ip=${encodeURIComponent(ip)}`,
        { signal },
      );
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const data = await response.json();
      const mac = data.mac as string | undefined;
      this.macCache.set(ip, { value: mac ?? null, timestamp: Date.now() });
      return mac;
    } catch {
      if (!signal?.aborted) {
        this.macCache.set(ip, { value: null, timestamp: Date.now() });
      }
      return undefined;
    }
  }

  private compareIPs(a: string, b: string): number {
    const toBigInt = (ip: string): bigint => {
      const addr = ipaddr.parse(ip);
      if (addr.kind() === "ipv4") {
        const o = (addr as ipaddr.IPv4).octets;
        return BigInt(((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
      }
      const parts = (addr as ipaddr.IPv6).parts;
      return parts.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
    };

    const aBig = toBigInt(a);
    const bBig = toBigInt(b);
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
  }
}
