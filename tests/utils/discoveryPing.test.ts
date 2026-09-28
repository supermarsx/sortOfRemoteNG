import { describe, expect, it } from "vitest";
import {
  DISCOVERY_PING_METHODS,
  isDiscoveryPingMethod,
  isDiscoveryProbeMethods,
} from "../../src/utils/discovery/discoveryPing";
import { cloneDiscoveryPresetConfig } from "../../src/utils/discovery/savedDiscoveryPresets";
import { normalizeDiscoveryScan } from "../../src/utils/discovery/scanHistory";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const config: NetworkDiscoveryConfig = {
  enabled: true,
  ipRange: "192.0.2.1",
  protocols: [],
  portRanges: [],
  timeout: 1000,
  maxConcurrent: 4,
  maxPortConcurrent: 8,
  customPorts: {},
  probeStrategies: {},
  cacheTTL: 0,
  hostnameTtl: 0,
  macTtl: 0,
  pingMethod: "combined",
  pingMethods: ["arp", "icmp-native", "udp"],
  pingUdpPort: 5353,
};

describe("discovery ping contracts", () => {
  it.each(DISCOVERY_PING_METHODS)("recognizes %s", (method) =>
    expect(isDiscoveryPingMethod(method)).toBe(true),
  );
  it.each([
    [],
    ["none"],
    ["adaptive"],
    ["icmp", "icmp"],
    ["ARP"],
    null,
    new Array(2),
  ])("rejects invalid method selection %j", (methods) => {
    expect(isDiscoveryProbeMethods(methods)).toBe(false);
    expect(() =>
      cloneDiscoveryPresetConfig({ ...config, pingMethods: methods as never }),
    ).toThrow();
  });
  it("round trips sweep settings and detached method arrays through presets", () => {
    const copy = cloneDiscoveryPresetConfig(config);
    expect(copy).toEqual(config);
    expect(copy.pingMethods).not.toBe(config.pingMethods);
  });
  it("persists discovery outcomes without unknown credential extensions", () => {
    const scan = normalizeDiscoveryScan({
      id: "scan",
      startedAt: 1,
      elapsedMs: 2,
      outcome: "complete",
      config,
      hosts: [
        {
          ip: "192.0.2.1",
          services: [],
          openPorts: [],
          responseTime: 2,
          reachability: "responsive",
          macAddress: "02:00:00:00:00:01",
          discoveryProbes: [
            {
              method: "arp",
              status: "unavailable",
              elapsedMs: 0,
              error: "helper missing",
              password: "do-not-save",
            },
            { method: "udp", status: "responsive", elapsedMs: 2 },
          ],
        },
      ],
    });
    expect(scan.config).toEqual(config);
    expect(scan.hosts[0].discoveryProbes).toEqual([
      {
        method: "arp",
        status: "unavailable",
        elapsedMs: 0,
        error: "helper missing",
      },
      { method: "udp", status: "responsive", elapsedMs: 2 },
    ]);
    expect(JSON.stringify(scan)).not.toContain("do-not-save");
  });
});
