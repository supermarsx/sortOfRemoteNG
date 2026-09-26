import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkScanner } from "../../src/utils/network/networkScanner";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const config: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.0/30",
  portRanges: ["22", "443"],
  protocols: [],
  timeout: 1000,
  maxConcurrent: 2,
  maxPortConcurrent: 2,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
};
beforeEach(() => {
  invoke.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("WebSocket", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("native network scanner", () => {
  it("probes every usable address of the entered subnet to find a moved DHCP host", async () => {
    invoke.mockImplementation(async (_command, { host }) => ({
      open: host === "192.0.2.247",
      banner: "SSH-2.0-OpenSSH_9.6",
      time_ms: 1,
    }));
    const results = await new NetworkScanner(true).scanNetwork({
      ...config,
      ipRange: "192.0.2.0/24",
      portRanges: ["22"],
    });
    const addresses = invoke.mock.calls
      .map(([, { host }]) => host)
      .sort((a, b) => Number(a.split(".")[3]) - Number(b.split(".")[3]));
    expect(addresses).toEqual(
      Array.from({ length: 254 }, (_, index) => `192.0.2.${index + 1}`),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ip: "192.0.2.247",
      openPorts: [22],
      services: [{ port: 22, banner: "SSH-2.0-OpenSSH_9.6" }],
    });
  });
  it("uses native TCP probes for raw services without browser requests or fabricated metadata", async () => {
    invoke.mockImplementation(async (_command, { port }) => ({
      open: port === 22,
      banner: "SSH-2.0-OpenSSH_9.6",
      time_ms: 1,
    }));
    const results = await new NetworkScanner(true).scanNetwork(config);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(results.map((host) => host.ip)).toEqual(["192.0.2.1", "192.0.2.2"]);
    expect(results[0]).toMatchObject({
      openPorts: [22],
      services: [{ protocol: "ssh", port: 22 }],
    });
    expect(results[0]).not.toHaveProperty("macAddress");
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });

  it.each(["192.0.2.1", "192.0.2.1/32", "2001:db8::1"])(
    "accepts explicit single target %s",
    async (ipRange) => {
      invoke.mockResolvedValue({ open: false });
      await new NetworkScanner(true).scanNetwork({
        ...config,
        ipRange,
        portRanges: ["22"],
      });
      expect(invoke).toHaveBeenCalledExactlyOnceWith("check_port", {
        host: ipRange.includes(":") ? "[2001:db8::1]" : "192.0.2.1",
        port: 22,
        timeoutSecs: 1,
      });
    },
  );

  it.each([
    "fe80::1234%12",
    "fe80::1234%12/128",
    "fe80::%12/120",
    "fe80::1234%eth0",
    "  fe80::1234%12  ",
  ])(
    "explicitly rejects scoped IPv6 target %s without any probes",
    async (ipRange) => {
      await expect(
        new NetworkScanner(true).scanNetwork({ ...config, ipRange }),
      ).rejects.toThrow(
        "Scoped IPv6 addresses are not supported by Network Scanner.",
      );
      expect(invoke).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(WebSocket).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ipRange: "" },
    { ipRange: "192.0.2.0/16" },
    { ipRange: "2001:db8::/112" },
    { portRanges: ["0"] },
    { portRanges: ["1-65535"] },
    { portRanges: ["99999"] },
    { portRanges: ["443-22"] },
    { portRanges: ["Infinity"] },
    { maxConcurrent: 0 },
    { maxConcurrent: 101 },
    { timeout: 0 },
  ])(
    "rejects unbounded or invalid input %j before native calls",
    async (overrides) => {
      await expect(
        new NetworkScanner(true).scanNetwork({ ...config, ...overrides }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it("bounds native concurrency and stops scheduling on cancellation while pending probes settle", async () => {
    const pending: Array<(result: { open: boolean }) => void> = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const controller = new AbortController();
    const scanning = new NetworkScanner(true).scanNetwork(
      { ...config, ipRange: "192.0.2.0/24", maxPortConcurrent: 100 },
      undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    controller.abort();
    pending.forEach((resolve) => resolve({ open: true }));
    expect(await scanning).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("reports native API failure and does not silently use a browser fallback", async () => {
    invoke.mockRejectedValue(new Error("Native API unavailable"));
    await expect(
      new NetworkScanner(true).scanNetwork({
        ...config,
        ipRange: "192.0.2.1",
        portRanges: ["22"],
      }),
    ).rejects.toThrow("Native API unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(WebSocket).not.toHaveBeenCalled();
  });
});
