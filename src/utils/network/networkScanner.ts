import { invoke } from "@tauri-apps/api/core";
import {
  DiscoveredHost,
  DiscoveredService,
} from "../../types/connection/connection";
import { NetworkDiscoveryConfig } from "../../types/settings/settings";
import { Semaphore } from "../core/semaphore";
import serviceMap from "../discovery/serviceMap";
import {
  FALLBACK_PROTOCOL,
  normalizeImportedProtocol,
  protocolFromPort,
} from "../connection/normalizeImportedProtocol";
import * as ipaddr from "ipaddr.js";

interface CacheEntry<T> {
  value: T | null;
  timestamp: number;
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
 * Classify an open port into a discovered service using, in order: the
 * caller's VNC hint, the static service map, banner evidence, and the
 * port-evidence table of the protocol normaliser. A port with no evidence is
 * reported as `raw` (generic TCP) — never RDP.
 */
export const classifyDiscoveredService = (
  port: number,
  banner?: string,
  protocolHint?: string,
): DiscoveredService => {
  if (protocolHint === "vnc") {
    return {
      port,
      protocol: "vnc",
      service: "vnc",
      version: extractVersion(banner),
      banner,
    };
  }
  const serviceInfo = serviceMap[port];
  if (serviceInfo) {
    return {
      port,
      protocol: serviceInfo.protocol,
      service: serviceInfo.service,
      version: extractVersion(banner),
      banner,
    };
  }
  const sniffed = sniffBannerProtocol(banner, port);
  if (sniffed) {
    return {
      port,
      protocol: sniffed,
      service: sniffed,
      version: extractVersion(banner),
      banner,
    };
  }
  const normalized = normalizeImportedProtocol({ port });
  if (normalized.source === "port") {
    return {
      port,
      protocol: normalized.protocol,
      service: normalized.protocol,
      version: extractVersion(banner),
      banner,
    };
  }
  return {
    port,
    protocol: FALLBACK_PROTOCOL,
    service: "unknown",
    banner,
  };
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
 * The scanner limits concurrency with semaphores to avoid overwhelming the
 * browser or target network. Hostname and MAC lookups are cached with TTLs to
 * minimise repeated HTTP calls. Results are sorted for deterministic output.
 */
export class NetworkScanner {
  private hostnameCache = new Map<string, CacheEntry<string>>();
  private macCache = new Map<string, CacheEntry<string>>();
  /**
   * Scan an IP range and return metadata about responsive hosts.
   *
   * Hosts are generated from the CIDR range and probed in parallel. A
   * semaphore throttles concurrency to `config.maxConcurrent`. Each host
   * scan is abortable via an `AbortSignal`, and progress callbacks receive a
   * percentage of completed tasks. Results are sorted by IP for stability.
   */
  async scanNetwork(
    config: NetworkDiscoveryConfig,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<DiscoveredHost[]> {
    const totalHosts = this.getHostCount(config.ipRange);
    const discoveredHosts: DiscoveredHost[] = [];
    let completed = 0;

    const semaphore = new Semaphore(config.maxConcurrent);
    const portSemaphore = new Semaphore(config.maxPortConcurrent);
    const tasks: Promise<void>[] = [];

    for await (const ip of this.generateIPRange(config.ipRange)) {
      if (signal?.aborted) {
        break;
      }

      const task = (async () => {
        await semaphore.acquire();
        try {
          if (signal?.aborted) {
            return;
          }
          const host = await this.scanHost(ip, config, signal, portSemaphore);
          if (host && !signal?.aborted) {
            discoveredHosts.push(host);
          }
        } catch (error) {
          console.error(`Failed to scan ${ip}:`, error);
        } finally {
          completed++;
          onProgress?.((completed / totalHosts) * 100);
          semaphore.release();
        }
      })();

      tasks.push(task);
    }

    // Every in-flight probe observes the same signal. Waiting for the bounded
    // task set to drain ensures semaphore waiters are released before the scan
    // resolves, while native RFB invokes are fenced promptly by `probeVncRfb`.
    await Promise.all(tasks);

    return discoveredHosts.sort((a, b) => this.compareIPs(a.ip, b.ip));
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
      if (prefix < 24 || prefix > 30) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /24 to /30 are supported`,
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
      const hostCount = Math.pow(2, hostBits) - 2;
      for (let i = 1; i <= hostCount; i++) {
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
      if (prefix < 24 || prefix > 30) {
        throw new Error(
          `Unsupported prefix length /${prefix}. Only /24 to /30 are supported`,
        );
      }
      const hostBits = 32 - prefix;
      return Math.pow(2, hostBits) - 2;
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
  ): Promise<DiscoveredHost | null> {
    const startTime = Date.now();
    const openPorts: number[] = [];
    const services: DiscoveredService[] = [];

    // Get ports to scan
    const portsToScan = this.getPortsToScan(config);

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
        );
      } finally {
        portSemaphore.release();
      }
    });
    const portResults = await Promise.all(portPromises);

    if (signal?.aborted) {
      return null;
    }

    portResults.forEach((result, index) => {
      if (result.isOpen) {
        const port = portsToScan[index];
        const protocol = this.getProtocolForPort(port, config);
        if (protocol === "vnc" && !isConfirmedRfbBanner(result.banner)) {
          return;
        }
        openPorts.push(port);

        const service = this.identifyService(port, result.banner, protocol);
        if (service) {
          services.push(service);
        }
      }
    });

    if (openPorts.length === 0) {
      return null;
    }

    const responseTime = Date.now() - startTime;
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
      configuredProtocol ||
      serviceMap[port]?.protocol ||
      protocolFromPort(port) ||
      "default"
    );
  }

  private async scanPort(
    ip: string,
    port: number,
    config: NetworkDiscoveryConfig,
    signal?: AbortSignal,
    protocolHint?: string,
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number }> {
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
  ): DiscoveredService | null {
    return classifyDiscoveredService(port, banner, protocolHint);
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
        return BigInt((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]);
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
