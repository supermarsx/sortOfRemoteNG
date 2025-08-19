import { DiscoveredHost, DiscoveredService } from "../types/connection";
import { NetworkDiscoveryConfig } from "../types/settings";
import { Semaphore } from "./semaphore";
import serviceMap from "./serviceMap";

interface CacheEntry<T> {
  value: T | null;
  timestamp: number;
}

export class NetworkScanner {
  private hostnameCache = new Map<string, CacheEntry<string>>();
  private macCache = new Map<string, CacheEntry<string>>();
  async scanNetwork(
    config: NetworkDiscoveryConfig,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<DiscoveredHost[]> {
    const hosts = this.generateIPRange(config.ipRange);
    const discoveredHosts: DiscoveredHost[] = [];
    let completed = 0;

    // Limit concurrent scans
    const semaphore = new Semaphore(config.maxConcurrent);

    const scanPromises = hosts.map(async (ip) => {
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
        onProgress?.((completed / hosts.length) * 100);
        semaphore.release();
      }
    });

    await Promise.race([
      Promise.all(scanPromises),
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

  private generateIPRange(cidr: string): string[] {
    const parts = cidr.split("/");
    if (parts.length !== 2) {
      throw new Error(`Malformed CIDR string: ${cidr}`);
    }

    const [network, prefixLength] = parts;

    if (!prefixLength || isNaN(Number(prefixLength))) {
      throw new Error(`Invalid prefix length in CIDR: ${cidr}`);
    }

    const prefix = parseInt(prefixLength, 10);

    if (prefix < 24 || prefix > 30) {
      throw new Error(
        `Unsupported prefix length /${prefix}. Only /24 to /30 are supported`,
      );
    }

    const networkPartsRaw = network.split(".");
    if (networkPartsRaw.length !== 4) {
      throw new Error(`CIDR IP must have 4 octets: ${network}`);
    }

    const octets = networkPartsRaw.map((part) => {
      if (!/^\d+$/.test(part)) {
        throw new Error(`Invalid IPv4 address in CIDR: ${network}`);
      }
      const num = Number(part);
      if (num < 0 || num > 255) {
        throw new Error(`Invalid IPv4 address in CIDR: ${network}`);
      }
      return num;
    });

    const hostBits = 32 - prefix;
    const mask = (0xffffffff << hostBits) >>> 0;
    const ipNum =
      ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
      0;
    const networkNum = ipNum & mask;
    const hostCount = Math.pow(2, hostBits) - 2; // Exclude network and broadcast

    const ips: string[] = [];
    for (let i = 1; i <= hostCount; i++) {
      const ipInt = (networkNum + i) >>> 0;
      ips.push(
        `${(ipInt >>> 24) & 0xff}.${(ipInt >>> 16) & 0xff}.${(ipInt >>> 8) & 0xff}.${
          ipInt & 0xff
        }`,
      );
    }

    return ips;
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
        return await this.scanPort(ip, port, config.timeout, signal);
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
    const hostname = await this.resolveHostname(ip, config.cacheTTL);

    return {
      ip,
      hostname,
      openPorts,
      services,
      responseTime,
      macAddress: await this.getMacAddress(ip, config.cacheTTL),
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
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let resolved = false;
      let ws: WebSocket;

      if (signal?.aborted) {
        resolve({ isOpen: false, elapsed: Date.now() - startTime });
        return;
      }

      // Use WebSocket for port scanning (limited but works for many services)
      try {
        ws = new WebSocket(`ws://${ip}:${port}`);
      } catch (error) {
        resolve({ isOpen: false, elapsed: Date.now() - startTime });
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
    ttl: number
  ): Promise<string | undefined> {
    this.purgeCache(this.hostnameCache, ttl);
    const cached = this.hostnameCache.get(ip);
    if (cached) {
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
      this.hostnameCache.set(ip, { value: hostname ?? null, timestamp: Date.now() });
      return hostname;
    } catch {
      this.hostnameCache.set(ip, { value: null, timestamp: Date.now() });
      return undefined;
    }
  }

  private async getMacAddress(
    ip: string,
    ttl: number
  ): Promise<string | undefined> {
    this.purgeCache(this.macCache, ttl);
    const cached = this.macCache.get(ip);
    if (cached) {
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
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);

    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) {
        return aParts[i] - bParts[i];
      }
    }

    return 0;
  }
}
