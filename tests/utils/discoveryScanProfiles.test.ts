import { describe, expect, it } from "vitest";
import {
  applyDiscoveryScanProfile,
  DISCOVERY_SCAN_PROFILES,
} from "../../src/utils/discovery/discoveryScanProfiles";
import {
  configuredDiscoveryPorts,
  DISCOVERY_SERVICE_PRESETS,
} from "../../src/utils/discovery/discoveryPresets";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";

const config: NetworkDiscoveryConfig = {
  enabled: false,
  ipRange: "192.0.2.1;2001:db8::/126",
  portRanges: ["1234", "8000-8010"],
  protocols: ["ssh", "ssh", "custom-service"],
  customPorts: { ssh: [2222], https: [4443], "custom-service": [4321] },
  identifyServices: false,
  timeout: 2200,
  maxConcurrent: 3,
  maxPortConcurrent: 5,
  absoluteMaxProbes: 4,
  adaptiveConcurrency: false,
  maxCpuPercent: 27,
  maxNetworkUtilizationPercent: 19,
  workerLaunchIntervalMs: 200,
  probeLaunchIntervalMs: 500,
  resolveHostnames: false,
  pingMethod: "icmp",
  pingTimeout: 750,
  pingPort: 444,
  scanUnresponsiveHosts: false,
  probeStrategies: { ssh: ["rfb"], default: ["http", "websocket"] },
  cacheTTL: 9876,
  hostnameTtl: 8765,
  macTtl: 7654,
};

describe("discovery scan profiles", () => {
  it("offers each requested bundle with unique IDs and valid catalog services", () => {
    const ids = DISCOVERY_SCAN_PROFILES.map((profile) => profile.id);
    expect(ids).toEqual([
      "common",
      "all",
      "remote-access",
      "windows",
      "linux",
      "databases",
      "virtualization",
      "hosting",
      "management",
      "iot",
      "servers",
      "cloud",
      "nas",
      "webapps",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of DISCOVERY_SCAN_PROFILES) {
      expect(profile.label.trim()).not.toBe("");
      expect(profile.description.trim()).not.toBe("");
      expect(profile.serviceIds.length).toBeGreaterThan(0);
      expect(new Set(profile.serviceIds).size).toBe(profile.serviceIds.length);
      for (const id of profile.serviceIds) {
        expect(
          DISCOVERY_SERVICE_PRESETS.some((service) => service.id === id),
        ).toBe(true);
      }
    }
  });
  it("includes every catalog service in All services, not every TCP port", () => {
    const result = applyDiscoveryScanProfile(config, "all");
    expect(result.protocols).toEqual(
      DISCOVERY_SERVICE_PRESETS.map(({ id }) => id),
    );
    const expected = [
      ...new Set(DISCOVERY_SERVICE_PRESETS.flatMap(({ ports }) => ports)),
    ].sort((a, b) => a - b);
    expect(configuredDiscoveryPorts(result)).toEqual(expected);
    expect(expected.length).toBeLessThan(100);
    expect(result.ipRange).toBe(config.ipRange);
  });
  it.each(DISCOVERY_SCAN_PROFILES)(
    "applies $id without changing targets, limits, discovery or caching",
    (profile) => {
      const result = applyDiscoveryScanProfile(config, profile.id);
      expect(result).not.toBe(config);
      expect(result.protocols).toEqual(profile.serviceIds);
      expect(result.portRanges).toEqual([]);
      // Only these three fields may differ, including any future tuning fields.
      expect({
        ...result,
        protocols: config.protocols,
        customPorts: config.customPorts,
        portRanges: config.portRanges,
      }).toEqual(config);
      for (const id of profile.serviceIds) {
        const service = DISCOVERY_SERVICE_PRESETS.find(
          (candidate) => candidate.id === id,
        )!;
        expect(result.customPorts[id]).toEqual(service.ports);
        expect(result.customPorts[id]).not.toBe(service.ports);
      }
      const ports = configuredDiscoveryPorts(result);
      expect(ports.length).toBeGreaterThan(0);
      expect(ports.length).toBeLessThanOrEqual(1024);
      expect(new Set(ports).size).toBe(ports.length);
      expect(
        ports.every(
          (port) => Number.isInteger(port) && port >= 1 && port <= 65535,
        ),
      ).toBe(true);
    },
  );
  it("resets selected overrides and additional ranges while retaining inactive overrides", () => {
    const result = applyDiscoveryScanProfile(config, "management");
    expect(result.customPorts.ssh).toEqual([22]);
    expect(result.customPorts.https).toEqual([443, 8443, 9443]);
    expect(result.customPorts["custom-service"]).toEqual([4321]);
    expect(result.protocols).not.toContain("custom-service");
    const ports = configuredDiscoveryPorts(result);
    expect(ports.filter((port) => port === 443)).toHaveLength(1);
    for (const port of [2222, 4443, 4321, 1234, 8001])
      expect(ports).not.toContain(port);
  });
  it("does not mutate input, profile or catalog arrays and produces independent editable ports", () => {
    const before = structuredClone(config);
    const profilesBefore = structuredClone(DISCOVERY_SCAN_PROFILES);
    const catalogBefore = structuredClone(DISCOVERY_SERVICE_PRESETS);
    const result = applyDiscoveryScanProfile(config, "common");
    result.protocols.push("changed");
    result.portRanges.push("12345");
    result.customPorts.ssh.push(12345);
    result.customPorts["custom-service"].push(5432);
    expect(config).toEqual(before);
    expect(DISCOVERY_SCAN_PROFILES).toEqual(profilesBefore);
    expect(DISCOVERY_SERVICE_PRESETS).toEqual(catalogBefore);
    expect(applyDiscoveryScanProfile(config, "common").customPorts.ssh).toEqual(
      [22],
    );
  });
  it.each(["", "unknown", "__proto__", "COMMON"])(
    "rejects unknown profile %j without mutation",
    (id) => {
      const before = structuredClone(config);
      expect(() => applyDiscoveryScanProfile(config, id)).toThrow(
        "Unknown discovery scan profile",
      );
      expect(config).toEqual(before);
    },
  );
  it("limits IoT to supported TCP families and describes cloud as reachable endpoint scanning", () => {
    const iot = DISCOVERY_SCAN_PROFILES.find(
      (profile) => profile.id === "iot",
    )!;
    const families = iot.serviceIds.map(
      (id) =>
        DISCOVERY_SERVICE_PRESETS.find((service) => service.id === id)!
          .protocol,
    );
    expect(
      families.every((protocol) =>
        ["http", "https", "ssh", "telnet"].includes(protocol),
      ),
    ).toBe(true);
    expect(iot.description).toContain("TCP");
    const cloud = DISCOVERY_SCAN_PROFILES.find(
      (profile) => profile.id === "cloud",
    )!;
    expect(cloud.description).toContain(
      "reachable VPC subnets and private endpoints",
    );
    expect(cloud.description).toContain("does not inventory cloud accounts");
  });
});
