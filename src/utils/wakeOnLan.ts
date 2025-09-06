import { debugLog } from "./debugLogger";
import { LocalStorageService } from "./localStorageService";

export type WakeRecurrence = "daily" | "weekly";

export interface WakeSchedule {
  macAddress: string;
  wakeTime: string;
  broadcastAddress?: string;
  port: number;
  recurrence?: WakeRecurrence;
}

const SCHEDULE_KEY = "wol-schedules";

export class WakeOnLanService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Send a Wake-on-LAN magic packet immediately.
   * @param macAddress - Target device's MAC address
   * @param broadcastAddress - Broadcast address to use
   * @param port - UDP port used to send the packet (default 9)
   */
  async sendWakePacket(
    macAddress: string,
    broadcastAddress: string = "255.255.255.255",
    port: number = 9,
  ): Promise<void> {
    try {
      // Validate MAC address format
      const cleanMac = macAddress.replace(/[:-]/g, "").toLowerCase();
      if (!/^[0-9a-f]{12}$/.test(cleanMac)) {
        throw new Error("Invalid MAC address format");
      }

      // Create magic packet
      const magicPacket = this.createMagicPacket(cleanMac);

      // Send via REST endpoint to a WOL service
      await this.sendPacketViaHttp(magicPacket, broadcastAddress, port);

      debugLog(
        `Wake-on-LAN packet sent to ${macAddress} via ${broadcastAddress}:${port}`,
      );
    } catch (error) {
      console.error("Failed to send Wake-on-LAN packet:", error);
      throw error;
    }
  }

  private createMagicPacket(macAddress: string): Uint8Array {
    // Magic packet format: 6 bytes of 0xFF followed by 16 repetitions of the MAC address
    const packet = new Uint8Array(102); // 6 + (6 * 16) = 102 bytes

    // Fill first 6 bytes with 0xFF
    for (let i = 0; i < 6; i++) {
      packet[i] = 0xff;
    }

    // Convert MAC address to bytes
    const macBytes = new Uint8Array(6);
    for (let i = 0; i < 6; i++) {
      macBytes[i] = parseInt(macAddress.substr(i * 2, 2), 16);
    }

    // Repeat MAC address 16 times
    for (let i = 0; i < 16; i++) {
      const offset = 6 + i * 6;
      packet.set(macBytes, offset);
    }

    return packet;
  }

  private async sendPacketViaHttp(
    packet: Uint8Array,
    broadcastAddress: string,
    port: number,
  ): Promise<void> {
    const response = await fetch("/api/wol", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packet: Array.from(packet),
        broadcastAddress,
        port,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to send Wake-on-LAN packet");
    }
  }

  // Utility methods for MAC address handling
  static formatMacAddress(mac: string): string {
    const clean = mac.replace(/[:-]/g, "").toLowerCase();
    return clean.match(/.{2}/g)?.join(":") || mac;
  }

  static validateMacAddress(mac: string): boolean {
    const clean = mac.replace(/[:-]/g, "").toLowerCase();
    return /^[0-9a-f]{12}$/.test(clean);
  }

  // Discover devices that support WOL
  async discoverWolDevices(): Promise<
    Array<{ ip: string; mac: string; hostname?: string }>
  > {
    // This would typically involve ARP table scanning
    // For demo purposes, return mock data
    return [
      { ip: "192.168.1.100", mac: "00:11:22:33:44:55", hostname: "desktop-pc" },
      { ip: "192.168.1.101", mac: "00:11:22:33:44:56", hostname: "laptop" },
      { ip: "192.168.1.102", mac: "00:11:22:33:44:57", hostname: "server" },
    ];
  }

  restoreScheduledWakeUps(): void {
    const schedules = this.getSchedules();
    const now = new Date();
    for (const s of schedules) {
      let nextTime = new Date(s.wakeTime);
      if (s.recurrence) {
        while (nextTime.getTime() <= now.getTime()) {
          nextTime = this.getNextWakeTime(nextTime, s.recurrence);
        }
        this.removeSchedule(s);
        this.scheduleWakeUp(
          s.macAddress,
          nextTime,
          s.broadcastAddress,
          s.port,
          s.recurrence,
        );
      } else if (nextTime.getTime() > now.getTime()) {
        this.scheduleWakeUp(
          s.macAddress,
          nextTime,
          s.broadcastAddress,
          s.port,
        );
      } else {
        this.removeSchedule(s);
      }
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
    recurrence?: WakeRecurrence,
  ): void {
    const now = new Date();
    const delay = wakeTime.getTime() - now.getTime();

    if (delay <= 0) {
      throw new Error("Wake time must be in the future");
    }

    const schedule: WakeSchedule = {
      macAddress,
      wakeTime: wakeTime.toISOString(),
      broadcastAddress,
      port,
      recurrence,
    };
    this.saveSchedule(schedule);

    const MAX_SAFE_TIMEOUT = 0x7fffffff;

    const execute = () => {
      this.sendWakePacket(macAddress, broadcastAddress, port);
      this.timers.delete(this.getScheduleKey(schedule));
      this.removeSchedule(schedule);

      if (recurrence) {
        const next = this.getNextWakeTime(new Date(schedule.wakeTime), recurrence);
        this.scheduleWakeUp(macAddress, next, broadcastAddress, port, recurrence);
      }
    };

    if (delay > MAX_SAFE_TIMEOUT) {
      const timer = setTimeout(() => {
        this.scheduleWakeUp(macAddress, wakeTime, broadcastAddress, port, recurrence);
      }, MAX_SAFE_TIMEOUT);
      this.timers.set(this.getScheduleKey(schedule), timer);
    } else {
      const timer = setTimeout(execute, delay);
      this.timers.set(this.getScheduleKey(schedule), timer);
    }

    debugLog(`Wake-on-LAN scheduled for ${wakeTime.toLocaleString()}`);
  }

  private getNextWakeTime(current: Date, recurrence: WakeRecurrence): Date {
    const next = new Date(current);
    if (recurrence === "daily") {
      next.setDate(next.getDate() + 1);
    } else if (recurrence === "weekly") {
      next.setDate(next.getDate() + 7);
    }
    return next;
  }

  listSchedules(): WakeSchedule[] {
    return this.getSchedules();
  }

  cancelSchedule(schedule: WakeSchedule): void {
    const key = this.getScheduleKey(schedule);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.removeSchedule(schedule);
  }

  private getScheduleKey(schedule: WakeSchedule): string {
    return `${schedule.macAddress}-${schedule.wakeTime}-${schedule.broadcastAddress ?? ""}-${schedule.port}`;
  }

  private getSchedules(): WakeSchedule[] {
    return LocalStorageService.getItem<WakeSchedule[]>(SCHEDULE_KEY) || [];
  }

  private saveSchedule(schedule: WakeSchedule): void {
    const schedules = this.getSchedules();
    const index = schedules.findIndex(
      (s) =>
        s.macAddress === schedule.macAddress &&
        s.broadcastAddress === schedule.broadcastAddress &&
        s.port === schedule.port &&
        s.wakeTime === schedule.wakeTime,
    );
    if (index >= 0) {
      schedules[index] = schedule;
    } else {
      schedules.push(schedule);
    }
    LocalStorageService.setItem(SCHEDULE_KEY, schedules);
  }

  private removeSchedule(schedule: WakeSchedule): void {
    const schedules = this.getSchedules();
    const filtered = schedules.filter(
      (s) =>
        !(
          s.macAddress === schedule.macAddress &&
          s.broadcastAddress === schedule.broadcastAddress &&
          s.port === schedule.port &&
          s.wakeTime === schedule.wakeTime
        ),
    );
    if (filtered.length === 0) {
      LocalStorageService.removeItem(SCHEDULE_KEY);
    } else {
      LocalStorageService.setItem(SCHEDULE_KEY, filtered);
    }
  }

  // Test if device is awake
  async testDeviceStatus(
    ipAddress: string,
    timeout: number = 5000,
  ): Promise<boolean> {
    try {
      // Use fetch with no-cors mode to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      await fetch(`http://${ipAddress}`, {
        method: "HEAD",
        mode: "no-cors",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }
}
