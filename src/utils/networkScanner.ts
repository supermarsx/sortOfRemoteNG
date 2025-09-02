import { DiscoveredHost, DiscoveredService } from "../types/connection";
import { NetworkDiscoveryConfig } from "../types/settings";
import { Semaphore } from "./semaphore";
import serviceMap from "./serviceMap";
import * as ipaddr from "ipaddr.js";

interface CacheEntry<T> {
  value: T | null;
  timestamp: number;
}

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
          const host = await this.scanHost(ip, config, signal);
          if (host) {
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

    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve()),
      ),
    ]);

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
  ): Promise<DiscoveredHost | null> {
    const startTime = Date.now();
    const openPorts: number[] = [];
    const services: DiscoveredService[] = [];

    // Get ports to scan
    const portsToScan = this.getPortsToScan(config);

    // Scan ports with a concurrency limit
    const portSemaphore = new Semaphore(config.maxPortConcurrent);
    const portPromises = portsToScan.map(async (port) => {
      await portSemaphore.acquire();
      try {
        if (signal?.aborted) {
          return { isOpen: false, elapsed: 0 };
        }
        return await this.scanPort(ip, port, config, signal);
      } finally {
        portSemaphore.release();
      }
    });
    const portResults = await Promise.all(portPromises);

    portResults.forEach((result, index) => {
      if (result.isOpen) {
        const port = portsToScan[index];
        openPorts.push(port);

        const service = this.identifyService(port, result.banner);
        if (service) {
          services.push(service);
        }
      }
    });

    if (openPorts.length === 0) {
      return null;
    }

    const responseTime = Date.now() - startTime;
    const hostname = await this.resolveHostname(ip, config.hostnameTtl);

    return {
      ip,
      hostname,
      openPorts,
      services,
      responseTime,
      macAddress: await this.getMacAddress(ip, config.macTtl),
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

  private async scanPort(
    ip: string,
    port: number,
    config: NetworkDiscoveryConfig,
    signal?: AbortSignal,
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number }> {
    const protocol = serviceMap[port]?.protocol || "default";
    const strategies =
      config.probeStrategies[protocol] || config.probeStrategies.default || ["websocket"];

    for (const strategy of strategies) {
      if (signal?.aborted) {
        return { isOpen: false, elapsed: 0 };
      }

      if (strategy === "websocket") {
        const wsResult = await this.probeWebSocket(ip, port, config.timeout, signal);
        if (wsResult !== null) {
          if (wsResult.isOpen || strategies.length === 1) {
            return wsResult;
          }
          // If websocket reported closed and other strategies remain, continue loop
          continue;
        }
        // wsResult null means creation failed; fall through to next strategy
      } else if (strategy === "http") {
        const httpResult = await this.probeHttp(ip, port, config.timeout, signal);
        if (httpResult !== null) {
          return httpResult;
        }
      }
    }

    return { isOpen: false, elapsed: 0 };
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
      const url = `http://${ip}:${port}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "HEAD",
          signal: signal ? this.mergeSignals(signal, controller.signal) : controller.signal,
        });
      } catch {
        response = await fetch(url, {
          method: "GET",
          signal: signal ? this.mergeSignals(signal, controller.signal) : controller.signal,
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

  private mergeSignals(signalA: AbortSignal, signalB: AbortSignal): AbortSignal {
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
  ): DiscoveredService | null {
    const serviceInfo = serviceMap[port];
    if (!serviceInfo) {
      return {
        port,
        protocol: "unknown",
        service: "unknown",
        banner,
      };
    }

    return {
      port,
      protocol: serviceInfo.protocol,
      service: serviceInfo.service,
      version: this.extractVersion(banner),
      banner,
    };
  }

  private extractVersion(banner?: string): string | undefined {
    if (!banner) return undefined;

    // Simple version extraction patterns
    const patterns = [
      /OpenSSH[_\s]+([\d.]+)/i,
      /Apache[\/\s]+([\d.]+)/i,
      /nginx[\/\s]+([\d.]+)/i,
      /Microsoft[_\s]+IIS[\/\s]+([\d.]+)/i,
      /MySQL[_\s]+([\d.]+)/i,
      /PostgreSQL[_\s]+([\d.]+)/i,
    ];

    for (const pattern of patterns) {
      const match = banner.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return undefined;
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
      this.hostnameCache.set(ip, { value: null, timestamp: Date.now() });
      return undefined;
    }
  }

  private async getMacAddress(
    ip: string,
    ttl: number,
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
      );
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const data = await response.json();
      const mac = data.mac as string | undefined;
      this.macCache.set(ip, { value: mac ?? null, timestamp: Date.now() });
      return mac;
    } catch {
      this.macCache.set(ip, { value: null, timestamp: Date.now() });
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
