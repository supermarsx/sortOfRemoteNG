import { DiscoveredHost, DiscoveredService } from '../types/connection';
import { NetworkDiscoveryConfig } from '../types/settings';
import { Semaphore } from './semaphore';
import serviceMap from './serviceMap';

export class NetworkScanner {
  async scanNetwork(
    config: NetworkDiscoveryConfig,
    onProgress?: (progress: number) => void
  ): Promise<DiscoveredHost[]> {
    const hosts = this.generateIPRange(config.ipRange);
    const discoveredHosts: DiscoveredHost[] = [];
    let completed = 0;

    // Limit concurrent scans
    const semaphore = new Semaphore(config.maxConcurrent);

    const scanPromises = hosts.map(async (ip) => {
      await semaphore.acquire();
      
      try {
        const host = await this.scanHost(ip, config);
        if (host) {
          discoveredHosts.push(host);
        }
      } catch (error) {
        console.error(`Failed to scan ${ip}:`, error);
      } finally {
        completed++;
        onProgress?.(completed / hosts.length * 100);
        semaphore.release();
      }
    });

    await Promise.all(scanPromises);
    return discoveredHosts.sort((a, b) => this.compareIPs(a.ip, b.ip));
  }

  private generateIPRange(cidr: string): string[] {
    const parts = cidr.split('/');
    if (parts.length !== 2) {
      throw new Error(`Malformed CIDR string: ${cidr}`);
    }

    const [network, prefixLength] = parts;

    if (!prefixLength || isNaN(Number(prefixLength))) {
      throw new Error(`Invalid prefix length in CIDR: ${cidr}`);
    }

    const prefix = parseInt(prefixLength, 10);

    if (prefix < 24 || prefix > 30) {
      throw new Error(`Unsupported prefix length /${prefix}. Only /24 to /30 are supported`);
    }

    const networkPartsRaw = network.split('.');
    if (networkPartsRaw.length !== 4) {
      throw new Error(`CIDR IP must have 4 octets: ${network}`);
    }

    const octets = networkPartsRaw.map(part => {
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
      ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    const networkNum = ipNum & mask;
    const hostCount = Math.pow(2, hostBits) - 2; // Exclude network and broadcast

    const ips: string[] = [];
    for (let i = 1; i <= hostCount; i++) {
      const ipInt = (networkNum + i) >>> 0;
      ips.push(
        `${(ipInt >>> 24) & 0xff}.${(ipInt >>> 16) & 0xff}.${(ipInt >>> 8) & 0xff}.${
          ipInt & 0xff
        }`
      );
    }

    return ips;
  }

  private async scanHost(ip: string, config: NetworkDiscoveryConfig): Promise<DiscoveredHost | null> {
    const startTime = Date.now();
    const openPorts: number[] = [];
    const services: DiscoveredService[] = [];

    // Get ports to scan
    const portsToScan = this.getPortsToScan(config);

    // Scan ports concurrently
    const portPromises = portsToScan.map(port =>
      this.scanPort(ip, port, config.timeout, config.tcpBackendUrl)
    );
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
    const hostname = await this.resolveHostname(ip);

    return {
      ip,
      hostname,
      openPorts,
      services,
      responseTime,
      macAddress: await this.getMacAddress(ip),
    };
  }

  private getPortsToScan(config: NetworkDiscoveryConfig): number[] {
    const ports = new Set<number>();

    // Add ports from ranges
    config.portRanges.forEach(range => {
      if (range.includes('-')) {
        const [start, end] = range.split('-').map(Number);
        for (let port = start; port <= end; port++) {
          ports.add(port);
        }
      } else {
        ports.add(Number(range));
      }
    });

    // Add custom ports for protocols
    config.protocols.forEach(protocol => {
      const customPorts = config.customPorts[protocol] || [];
      customPorts.forEach(port => ports.add(port));
    });

    return Array.from(ports).sort((a, b) => a - b);
  }

  private async scanPort(
    ip: string,
    port: number,
    timeout: number,
    backendUrl?: string
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number }> {
    const startTime = Date.now();
    const serviceInfo = serviceMap[port];

    // Use HTTP(S) requests for common web services
    if (serviceInfo?.protocol === 'http' || serviceInfo?.protocol === 'https') {
      const scheme = serviceInfo.protocol;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(`${scheme}://${ip}:${port}`, {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return {
          isOpen: true,
          banner: response.headers.get('server') ?? undefined,
          elapsed: Date.now() - startTime,
        };
      } catch {
        return { isOpen: false, elapsed: Date.now() - startTime };
      }
    }

    // If a backend is configured, ask it to perform a TCP check
    if (backendUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const url = `${backendUrl}?ip=${encodeURIComponent(ip)}&port=${port}`;
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          return {
            isOpen: Boolean(data.open),
            banner: data.banner,
            elapsed: Date.now() - startTime,
          };
        }
      } catch {
        // fall through to WebSocket fallback
      }
    }

    // Fallback to WebSocket-based detection
    return new Promise((resolve) => {
      let resolved = false;
      const ws = new WebSocket(`ws://${ip}:${port}`);

      const timeoutId = setTimeout(() => {
        ws.close();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        ws.close();
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: true, elapsed: Date.now() - startTime });
        }
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        if (!resolved) {
          resolved = true;
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      };

      ws.onclose = (event) => {
        clearTimeout(timeoutId);
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

  private identifyService(port: number, banner?: string): DiscoveredService | null {
    const serviceInfo = serviceMap[port];
    if (!serviceInfo) {
      return {
        port,
        protocol: 'unknown',
        service: 'unknown',
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

  private async resolveHostname(ip: string): Promise<string | undefined> {
    try {
      // Browser DNS resolution is limited, so we'll skip this for now
      // In a real implementation, this would use a backend service
      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  private async getMacAddress(ip: string): Promise<string | undefined> {
    try {
      // MAC address resolution requires ARP table access
      // This would need a backend service in a real implementation
      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  private compareIPs(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) {
        return aParts[i] - bParts[i];
      }
    }

    return 0;
  }
}
