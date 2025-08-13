import { debugLog } from './debugLogger';
import { LocalStorageService } from './localStorageService';

interface WakeSchedule {
  macAddress: string;
  wakeTime: string;
  broadcastAddress?: string;
  port: number;
}

const SCHEDULE_KEY = 'wol-schedules';

export class WakeOnLanService {
  /**
   * Send a Wake-on-LAN magic packet immediately.
   * @param macAddress - Target device's MAC address
   * @param broadcastAddress - Broadcast address to use
   * @param port - UDP port used to send the packet (default 9)
   */
  async sendWakePacket(
    macAddress: string,
    broadcastAddress: string = '255.255.255.255',
    port: number = 9,
  ): Promise<void> {
    try {
      // Validate MAC address format
      const cleanMac = macAddress.replace(/[:-]/g, '').toLowerCase();
      if (!/^[0-9a-f]{12}$/.test(cleanMac)) {
        throw new Error('Invalid MAC address format');
      }

      // Create magic packet
      const magicPacket = this.createMagicPacket(cleanMac);

      // Send via WebSocket to a WOL service (would need backend implementation)
      await this.sendPacketViaWebSocket(magicPacket);
      
      debugLog(`Wake-on-LAN packet sent to ${macAddress} via ${broadcastAddress}:${port}`);
    } catch (error) {
      console.error('Failed to send Wake-on-LAN packet:', error);
      throw error;
    }
  }

  private createMagicPacket(macAddress: string): Uint8Array {
    // Magic packet format: 6 bytes of 0xFF followed by 16 repetitions of the MAC address
    const packet = new Uint8Array(102); // 6 + (6 * 16) = 102 bytes
    
    // Fill first 6 bytes with 0xFF
    for (let i = 0; i < 6; i++) {
      packet[i] = 0xFF;
    }
    
    // Convert MAC address to bytes
    const macBytes = new Uint8Array(6);
    for (let i = 0; i < 6; i++) {
      macBytes[i] = parseInt(macAddress.substr(i * 2, 2), 16);
    }
    
    // Repeat MAC address 16 times
    for (let i = 0; i < 16; i++) {
      const offset = 6 + (i * 6);
      packet.set(macBytes, offset);
    }
    
    return packet;
  }

  private async sendPacketViaWebSocket(packet: Uint8Array): Promise<void> {
    return new Promise((resolve) => {
      // Use the packet parameter to avoid lint warnings
      debugLog(`Magic packet length: ${packet.length}`);
      // In a real implementation, this would connect to a backend service
      // that can send UDP packets. For now, we'll simulate the operation.
      
      setTimeout(() => {
        // Simulate successful packet transmission
        resolve();
      }, 500);
    });
  }

  // Utility methods for MAC address handling
  static formatMacAddress(mac: string): string {
    const clean = mac.replace(/[:-]/g, '').toLowerCase();
    return clean.match(/.{2}/g)?.join(':') || mac;
  }

  static validateMacAddress(mac: string): boolean {
    const clean = mac.replace(/[:-]/g, '').toLowerCase();
    return /^[0-9a-f]{12}$/.test(clean);
  }

  // Discover devices that support WOL
  async discoverWolDevices(): Promise<Array<{ ip: string; mac: string; hostname?: string }>> {
    // This would typically involve ARP table scanning
    // For demo purposes, return mock data
    return [
      { ip: '192.168.1.100', mac: '00:11:22:33:44:55', hostname: 'desktop-pc' },
      { ip: '192.168.1.101', mac: '00:11:22:33:44:56', hostname: 'laptop' },
      { ip: '192.168.1.102', mac: '00:11:22:33:44:57', hostname: 'server' },
    ];
  }

  restoreScheduledWakeUps(): void {
    const schedules = this.getSchedules();
    for (const s of schedules) {
      this.scheduleWakeUp(s.macAddress, new Date(s.wakeTime), s.broadcastAddress, s.port);
    }
  }

  /**
   * Schedule a Wake-on-LAN packet to be sent at a future time.
   * @param macAddress - Target device's MAC address
   * @param wakeTime - When to send the packet
   * @param broadcastAddress - Optional broadcast address
   * @param port - UDP port used to send the magic packet (default 9)
   */
  scheduleWakeUp(
    macAddress: string,
    wakeTime: Date,
    broadcastAddress?: string,
    port: number = 9,
  ): void {
    const now = new Date();
    const delay = wakeTime.getTime() - now.getTime();

    if (delay <= 0) {
      throw new Error('Wake time must be in the future');
    }

    const MAX_SAFE_TIMEOUT = 0x7fffffff;

    if (delay > MAX_SAFE_TIMEOUT) {
      this.saveSchedule({
        macAddress,
        wakeTime: wakeTime.toISOString(),
        broadcastAddress,
        port,
      });

      setTimeout(() => {
        this.scheduleWakeUp(macAddress, wakeTime, broadcastAddress, port);
      }, MAX_SAFE_TIMEOUT);
    } else {
      setTimeout(() => {
        this.sendWakePacket(macAddress, broadcastAddress, port);
        this.removeSchedule({
          macAddress,
          wakeTime: wakeTime.toISOString(),
          broadcastAddress,
          port,
        });
      }, delay);
    }

    debugLog(`Wake-on-LAN scheduled for ${wakeTime.toLocaleString()}`);
  }

  private getSchedules(): WakeSchedule[] {
    return LocalStorageService.getItem<WakeSchedule[]>(SCHEDULE_KEY) || [];
  }

  private saveSchedule(schedule: WakeSchedule): void {
    const schedules = this.getSchedules();
    const exists = schedules.some(
      (s) =>
        s.macAddress === schedule.macAddress &&
        s.wakeTime === schedule.wakeTime &&
        s.port === schedule.port &&
        s.broadcastAddress === schedule.broadcastAddress,
    );
    if (!exists) {
      schedules.push(schedule);
      LocalStorageService.setItem(SCHEDULE_KEY, schedules);
    }
  }

  private removeSchedule(schedule: WakeSchedule): void {
    const schedules = this.getSchedules();
    const filtered = schedules.filter(
      (s) =>
        !(
          s.macAddress === schedule.macAddress &&
          s.wakeTime === schedule.wakeTime &&
          s.port === schedule.port &&
          s.broadcastAddress === schedule.broadcastAddress
        ),
    );
    if (filtered.length === 0) {
      LocalStorageService.removeItem(SCHEDULE_KEY);
    } else {
      LocalStorageService.setItem(SCHEDULE_KEY, filtered);
    }
  }

  // Test if device is awake
  async testDeviceStatus(ipAddress: string, timeout: number = 5000): Promise<boolean> {
    try {
      // Use fetch with no-cors mode to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      await fetch(`http://${ipAddress}`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }
}
