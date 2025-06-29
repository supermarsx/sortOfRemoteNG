import { NetworkDiscoveryConfig, DiscoveredHost, DiscoveredService } from '../types/connection';

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
    const [network, prefixLength] = cidr.split('/');
    const prefix = parseInt(prefixLength);
    
    if (prefix < 24 || prefix > 30) {
      throw new Error('Only /24 to /30 networks are supported');
    }

    const networkParts = network.split('.').map(Number);
    const hostBits = 32 - prefix;
    const hostCount = Math.pow(2, hostBits) - 2; // Exclude network and broadcast
    
    const ips: string[] = [];
    
    for (let i = 1; i <= hostCount; i++) {
      const ip = [...networkParts];
      let carry = i;
      
      for (let j = 3; j >= 0 && carry > 0; j--) {
        ip[j] += carry % 256;
        carry = Math.floor(carry / 256);
      }
      
      ips.push(ip.join('.'));
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
    const portPromises = portsToScan.map(port => this.scanPort(ip, port, config.timeout));
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
    timeout: number
  ): Promise<{ isOpen: boolean; banner?: string; elapsed: number }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Use WebSocket for port scanning (limited but works for many services)
      const ws = new WebSocket(`ws://${ip}:${port}`);
      
      const timeoutId = setTimeout(() => {
        ws.close();
        resolve({ isOpen: false, elapsed: Date.now() - startTime });
      }, timeout);

      ws.onopen = () => {
        clearTimeout(timeoutId);
        ws.close();
        resolve({ isOpen: true, elapsed: Date.now() - startTime });
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        resolve({ isOpen: false, elapsed: Date.now() - startTime });
      };

      ws.onclose = (event) => {
        clearTimeout(timeoutId);
        if (event.wasClean) {
          resolve({ isOpen: true, elapsed: Date.now() - startTime });
        } else {
          resolve({ isOpen: false, elapsed: Date.now() - startTime });
        }
      };
    });
  }

  private identifyService(port: number, banner?: string): DiscoveredService | null {
    const commonServices: Record<number, { service: string; protocol: string }> = {
      21: { service: 'ftp', protocol: 'ftp' },
      22: { service: 'ssh', protocol: 'ssh' },
      23: { service: 'telnet', protocol: 'telnet' },
      25: { service: 'smtp', protocol: 'smtp' },
      53: { service: 'dns', protocol: 'dns' },
      80: { service: 'http', protocol: 'http' },
      110: { service: 'pop3', protocol: 'pop3' },
      143: { service: 'imap', protocol: 'imap' },
      443: { service: 'https', protocol: 'https' },
      993: { service: 'imaps', protocol: 'imaps' },
      995: { service: 'pop3s', protocol: 'pop3s' },
      3306: { service: 'mysql', protocol: 'mysql' },
      3389: { service: 'rdp', protocol: 'rdp' },
      5432: { service: 'postgresql', protocol: 'postgresql' },
      5900: { service: 'vnc', protocol: 'vnc' },
      5901: { service: 'vnc', protocol: 'vnc' },
      5902: { service: 'vnc', protocol: 'vnc' },
    };

    const serviceInfo = commonServices[port];
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

class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}
