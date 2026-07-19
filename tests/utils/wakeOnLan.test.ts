import { describe, it, expect, vi, beforeEach } from "vitest";
import { WakeOnLanService } from "../../src/utils/network/wakeOnLan";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

beforeEach(async () => {
  // @ts-expect-error - no type declarations for jsdom
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  (global as any).localStorage = dom.window.localStorage;
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("WakeOnLanService", () => {
  it("formats MAC addresses", () => {
    expect(WakeOnLanService.formatMacAddress("AABBCCDDEEFF")).toBe(
      "aa:bb:cc:dd:ee:ff",
    );
    expect(WakeOnLanService.formatMacAddress("aa-bb-cc-dd-ee-ff")).toBe(
      "aa:bb:cc:dd:ee:ff",
    );
  });

  it("validates MAC addresses", () => {
    expect(WakeOnLanService.validateMacAddress("aa:bb:cc:dd:ee:ff")).toBe(true);
    expect(WakeOnLanService.validateMacAddress("gg:hh:ii:jj:kk:ll")).toBe(
      false,
    );
  });

  it("sends through the shared Tauri WOL path with an optional DNS target", async () => {
    const service = new WakeOnLanService();
    await service.sendWakePacket(
      "aa:bb:cc:dd:ee:ff",
      "192.168.1.255",
      7,
      "host.example.com",
    );
    expect(invoke).toHaveBeenCalledWith("wake_on_lan", {
      macAddress: "aa:bb:cc:dd:ee:ff",
      broadcastAddress: "192.168.1.255",
      port: 7,
      targetAddress: "host.example.com",
    });
  });

  it("schedules long delays, persists schedule, and passes port", async () => {
    vi.useFakeTimers();
    const service = new WakeOnLanService();
    const sendSpy = vi
      .spyOn(service, "sendWakePacket")
      .mockResolvedValue(undefined);
    const wakeTime = new Date(Date.now() + 0x7fffffff + 1000);

    service.scheduleWakeUp("00:11:22:33:44:55", wakeTime, undefined, 7);

    const stored = JSON.parse(localStorage.getItem("wol-schedules") || "[]");
    expect(stored).toHaveLength(1);

    vi.advanceTimersByTime(0x7fffffff);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("wol-schedules") || "[]"),
    ).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(sendSpy).toHaveBeenCalledWith(
      "00:11:22:33:44:55",
      undefined,
      7,
      undefined,
    );
    expect(localStorage.getItem("wol-schedules")).toBeNull();

    vi.useRealTimers();
  });

  it("preserves literal broadcast calls without requiring a target", async () => {
    const service = new WakeOnLanService();
    await service.sendWakePacket("aa:bb:cc:dd:ee:ff", "192.168.1.255", 7);
    expect(invoke).toHaveBeenCalledWith("wake_on_lan", {
      macAddress: "aa:bb:cc:dd:ee:ff",
      broadcastAddress: "192.168.1.255",
      port: 7,
      targetAddress: undefined,
    });
  });
});
