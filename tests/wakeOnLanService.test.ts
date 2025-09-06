import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WakeOnLanService } from "../src/utils/wakeOnLan";

const MAC = "00:11:22:33:44:55";

describe("WakeOnLanService scheduling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(WakeOnLanService.prototype, "sendWakePacket").mockResolvedValue();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists schedules", () => {
    const service = new WakeOnLanService();
    const wakeTime = new Date(Date.now() + 3600000);
    service.scheduleWakeUp(MAC, wakeTime);
    const schedules = service.listSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].macAddress).toBe(MAC);
  });

  it("keeps multiple schedules for the same device", () => {
    const service = new WakeOnLanService();
    const first = new Date(Date.now() + 3600000);
    const second = new Date(Date.now() + 7200000);
    service.scheduleWakeUp(MAC, first);
    service.scheduleWakeUp(MAC, second);
    const schedules = service.listSchedules();
    expect(schedules).toHaveLength(2);
    const times = schedules.map((s) => s.wakeTime).sort();
    expect(times).toEqual([first.toISOString(), second.toISOString()].sort());
  });

  it("handles daily recurrence", () => {
    const service = new WakeOnLanService();
    const wakeTime = new Date(Date.now() + 60000);
    service.scheduleWakeUp(MAC, wakeTime, undefined, 9, "daily");
    vi.advanceTimersByTime(60000);
    const schedules = service.listSchedules();
    expect(schedules).toHaveLength(1);
    const next = new Date(schedules[0].wakeTime).getTime();
    expect(next).toBe(wakeTime.getTime() + 24 * 60 * 60 * 1000);
  });

  it("restores past schedules to next occurrence", () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    localStorage.setItem(
      "wol-schedules",
      JSON.stringify([
        {
          macAddress: MAC,
          wakeTime: past.toISOString(),
          port: 9,
          recurrence: "daily",
        },
      ]),
    );
    const service = new WakeOnLanService();
    const spy = vi.spyOn(service, "scheduleWakeUp");
    service.restoreScheduledWakeUps();
    expect(spy).toHaveBeenCalled();
    const stored = service.listSchedules()[0];
    expect(new Date(stored.wakeTime).getTime()).toBeGreaterThan(Date.now());
  });
});
