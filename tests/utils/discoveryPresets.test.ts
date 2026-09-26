import { describe, expect, it } from "vitest";
import {
  DISCOVERY_SERVICE_PRESETS,
  DEFAULT_DISCOVERY_PROTOCOLS,
  defaultDiscoveryPorts,
  configuredDiscoveryPorts,
} from "../../src/utils/discovery/discoveryPresets";

describe("service discovery presets", () => {
  it("has unique, valid editable targets for supported service families", () => {
    expect(new Set(DISCOVERY_SERVICE_PRESETS.map(({ id }) => id)).size).toBe(
      DISCOVERY_SERVICE_PRESETS.length,
    );
    for (const preset of DISCOVERY_SERVICE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.ports.length).toBeGreaterThan(0);
      for (const port of preset.ports) {
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65535);
      }
    }
    for (const id of [
      "ssh",
      "rdp",
      "vnc",
      "http",
      "https",
      "mysql",
      "postgresql",
      "mssql",
      "ilo",
      "idrac",
      "synology",
      "cpanel",
      "tactical-rmm",
      "portainer",
      "smb",
    ])
      expect(DISCOVERY_SERVICE_PRESETS.some((preset) => preset.id === id)).toBe(
        true,
      );
  });

  it("deduplicates shared ports and keeps deselected presets out of the scan", () => {
    const customPorts = defaultDiscoveryPorts();
    expect(
      configuredDiscoveryPorts({
        protocols: ["https", "ilo", "idrac", "pfsense"],
        customPorts,
        portRanges: ["443", "8443-8444"],
      }),
    ).toEqual([443, 8443, 8444, 9443]);
    expect(
      configuredDiscoveryPorts({ protocols: [], customPorts, portRanges: [] }),
    ).toEqual([]);
    customPorts.ssh = [2222];
    expect(
      configuredDiscoveryPorts({
        protocols: ["ssh"],
        customPorts,
        portRanges: [],
      }),
    ).toEqual([2222]);
    expect(defaultDiscoveryPorts().ssh).toEqual([22]);
    expect(
      configuredDiscoveryPorts({
        protocols: [...DEFAULT_DISCOVERY_PROTOCOLS],
        customPorts: defaultDiscoveryPorts(),
        portRanges: [],
      }).length,
    ).toBeLessThan(30);
  });

  it("does not expand oversized or malformed draft ranges", () => {
    expect(
      configuredDiscoveryPorts({
        protocols: [],
        customPorts: {},
        portRanges: ["1-65535", "bad", "-1", "65536", "22"],
      }),
    ).toEqual([22]);
  });
});
