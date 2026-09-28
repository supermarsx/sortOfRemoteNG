import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkDiscoveryConfig } from "../../src/types/settings/settings";
import {
  cloneDiscoveryPresetConfig,
  DISCOVERY_PRESET_LIMIT,
  DISCOVERY_PRESET_MAX_BYTES,
  DISCOVERY_PRESET_STORAGE_KEY,
  mutateDiscoveryPresets,
  normalizeDiscoveryPresetName,
  readDiscoveryPresets,
  type SavedDiscoveryPreset,
} from "../../src/utils/discovery/savedDiscoveryPresets";

const config = (): NetworkDiscoveryConfig => ({
  enabled: true,
  ipRange: "10.0.0.0/24, 2001:db8::1",
  protocols: ["ssh", "https"],
  portRanges: ["8000-8002"],
  customPorts: { ssh: [22, 2222], https: [443] },
  probeStrategies: { default: ["websocket"], https: ["http"], vnc: ["rfb"] },
  timeout: 5000,
  maxConcurrent: 50,
  maxPortConcurrent: 100,
  cacheTTL: 300000,
  hostnameTtl: 60000,
  macTtl: 0,
  identifyServices: true,
  pingMethod: "tcp",
  pingTimeout: 1000,
  pingPort: 443,
  scanUnresponsiveHosts: false,
  adaptiveConcurrency: true,
  nativeBatchProbes: true,
  absoluteMaxProbes: 256,
  maxCpuPercent: 80,
  maxNetworkUtilizationPercent: 75,
  workerLaunchIntervalMs: 25,
  probeLaunchIntervalMs: 0,
  resolveHostnames: false,
});
const preset = (id = "one"): SavedDiscoveryPreset => ({
  id,
  name: id,
  createdAt: 1,
  updatedAt: 2,
  config: config(),
});
beforeEach(() => localStorage.removeItem(DISCOVERY_PRESET_STORAGE_KEY));
afterEach(() => vi.restoreAllMocks());

describe("discovery preset snapshots", () => {
  it.each([true, false, undefined])(
    "round trips optional scan toggles and pause policy: %s",
    (value) => {
      const flags = {
        hostDiscoveryEnabled: value,
        serviceScanEnabled: value,
        pauseOnHighLoad: value,
      };
      mutateDiscoveryPresets((items) =>
        items.push({ ...preset(), config: { ...config(), ...flags } }),
      );
      const saved = readDiscoveryPresets()[0].config;
      for (const key of Object.keys(flags) as Array<keyof typeof flags>) {
        if (value === undefined) expect(saved).not.toHaveProperty(key);
        else expect(saved[key]).toBe(value);
      }
    },
  );

  it("copies every current config field and detaches all containers", () => {
    const source = config();
    const copy = cloneDiscoveryPresetConfig(source);
    expect(copy).toEqual(source);
    copy.protocols.push("rdp");
    copy.customPorts.ssh.push(2022);
    copy.probeStrategies.default.push("http");
    copy.portRanges.push("80");
    expect(source).toEqual(config());
    expect(cloneDiscoveryPresetConfig({ ...source, ipRange: "" }).ipRange).toBe(
      "",
    );
  });

  it("does not carry unknown extensions, credentials, results or inherited map entries", () => {
    const source = Object.assign(config(), {
      password: "secret",
      credentials: { token: "secret" },
      results: [{ banner: "secret" }],
      toJSON: () => ({ password: "secret" }),
    });
    source.customPorts = Object.assign(Object.create({ rdp: [3389] }), {
      ssh: [22],
      credentials: [123],
      constructor: [123],
    });
    source.probeStrategies = { default: ["http"], password: ["http"] };
    const copy = cloneDiscoveryPresetConfig(source);
    expect(copy.customPorts).toEqual({ ssh: [22] });
    expect(copy.probeStrategies).toEqual({ default: ["http"] });
    expect(copy).not.toHaveProperty("password");
    expect(copy).not.toHaveProperty("credentials");
    expect(copy).not.toHaveProperty("results");
    expect(copy).not.toHaveProperty("toJSON");
    expect(JSON.stringify(copy)).not.toContain("secret");
  });

  it("permits a full 10,000-host target plan and rejects excess or non-target text", () => {
    const targets = Array.from(
      { length: 10000 },
      (_, i) => `10.0.${Math.floor(i / 256)}.${i % 256}`,
    ).join("\n");
    expect(
      cloneDiscoveryPresetConfig({ ...config(), ipRange: targets }).ipRange,
    ).toBe(targets);
    mutateDiscoveryPresets((items) =>
      items.push({ ...preset(), config: { ...config(), ipRange: targets } }),
    );
    expect(readDiscoveryPresets()[0].config.ipRange).toBe(targets);
    expect(() =>
      cloneDiscoveryPresetConfig({ ...config(), ipRange: "10.0.0.0/16" }),
    ).toThrow(/10,000/);
    expect(() =>
      cloneDiscoveryPresetConfig({
        ...config(),
        ipRange: "https://user:secret@host",
      }),
    ).toThrow();
    expect(() =>
      cloneDiscoveryPresetConfig({
        ...config(),
        ipRange: " ".repeat(256 * 1024 + 1),
      }),
    ).toThrow(/256 KiB/);
  });

  it.each([
    { timeout: NaN },
    { timeout: Infinity },
    { maxConcurrent: 513 },
    { maxPortConcurrent: 0 },
    { enabled: "yes" },
    { identifyServices: 1 },
    { hostDiscoveryEnabled: "false" },
    { serviceScanEnabled: 0 },
    { pauseOnHighLoad: null },
    { pingMethod: "unsupported" },
    { pingPort: 65536 },
    { pingTimeout: 0 },
    { absoluteMaxProbes: 1025 },
    { maxCpuPercent: 101 },
    { maxNetworkUtilizationPercent: -1 },
    { workerLaunchIntervalMs: 5001 },
    { probeLaunchIntervalMs: 0.5 },
    { cacheTTL: -1 },
    { macTtl: "100" },
    { protocols: ["unknown-service"] },
    { customPorts: { ssh: [0] } },
    { customPorts: { ssh: Array(1) } },
    { portRanges: ["1-65535"] },
    { portRanges: ["443-22"] },
    { portRanges: ["bad"] },
    { probeStrategies: { default: ["credentials"] } },
    { protocols: null },
    { customPorts: [] },
    { probeStrategies: null },
  ])("rejects malformed fields: %j", (patch) => {
    expect(() =>
      cloneDiscoveryPresetConfig({
        ...config(),
        ...patch,
      } as NetworkDiscoveryConfig),
    ).toThrow();
  });

  it("omits absent optional fields and enforces trimmed bounded names", () => {
    const source = config();
    delete source.pingMethod;
    delete source.identifyServices;
    expect(cloneDiscoveryPresetConfig(source)).not.toHaveProperty("pingMethod");
    expect(cloneDiscoveryPresetConfig(source)).not.toHaveProperty(
      "identifyServices",
    );
    expect(normalizeDiscoveryPresetName("  Common  ")).toBe("Common");
    expect(normalizeDiscoveryPresetName("x".repeat(80))).toHaveLength(80);
    for (const name of [" ", "x".repeat(81), "a\nb", null])
      expect(() => normalizeDiscoveryPresetName(name as string)).toThrow();
  });
});

describe("versioned preset storage", () => {
  it("round trips detached allowlisted records and rereads before each mutation", () => {
    expect(readDiscoveryPresets()).toEqual([]);
    const first = preset();
    mutateDiscoveryPresets((items) => items.push(first));
    first.config.customPorts.ssh.push(22222);
    expect(readDiscoveryPresets()).toEqual([preset()]);
    const read = readDiscoveryPresets();
    read[0].name = "edited snapshot";
    read[0].config.probeStrategies.default.push("rfb");
    mutateDiscoveryPresets((items) => items.push(preset("two")));
    expect(readDiscoveryPresets()).toEqual([preset(), preset("two")]);
    expect(
      JSON.parse(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)!),
    ).toEqual({
      version: 1,
      presets: [preset(), preset("two")],
    });
  });

  it.each([
    "",
    "{bad",
    "null",
    "[]",
    '{"version":2,"presets":[]}',
    '{"version":1,"presets":{}}',
    JSON.stringify({ version: 1, presets: [{ ...preset(), config: {} }] }),
    JSON.stringify({ version: 1, presets: [preset(), preset()] }),
    JSON.stringify({
      version: 1,
      presets: [preset(), { ...preset("two"), name: " ONE " }],
    }),
    JSON.stringify({ version: 1, presets: [{ ...preset(), updatedAt: 0 }] }),
  ])("never overwrites unreadable or unsupported storage: %s", (raw) => {
    localStorage.setItem(DISCOVERY_PRESET_STORAGE_KEY, raw);
    const change = vi.fn();
    expect(() => readDiscoveryPresets()).toThrow();
    expect(() => mutateDiscoveryPresets(change)).toThrow();
    expect(change).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)).toBe(raw);
  });

  it("enforces count and case-insensitive uniqueness before writing", () => {
    mutateDiscoveryPresets((items) => {
      for (let i = 0; i < DISCOVERY_PRESET_LIMIT; i++)
        items.push(preset(`preset-${i}`));
    });
    const raw = localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY);
    expect(() =>
      mutateDiscoveryPresets((items) => items.push(preset("extra"))),
    ).toThrow(/50/);
    expect(() =>
      mutateDiscoveryPresets((items) => {
        items[1].name = " PRESET-0 ";
      }),
    ).toThrow(/already exists/);
    expect(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)).toBe(raw);
  });

  it("bounds bytes on reads and writes without truncation or eviction", () => {
    mutateDiscoveryPresets((items) => items.push(preset()));
    const raw = localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY);
    expect(() =>
      mutateDiscoveryPresets((items) => {
        for (let i = 0; i < 5; i++) {
          const item = preset(`large-${i}`);
          item.config.ipRange = " ".repeat(256 * 1024);
          items.push(item);
        }
      }),
    ).toThrow(/2 MiB/);
    expect(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)).toBe(raw);
    localStorage.setItem(
      DISCOVERY_PRESET_STORAGE_KEY,
      " ".repeat(DISCOVERY_PRESET_MAX_BYTES / 2 + 1),
    );
    expect(() => readDiscoveryPresets()).toThrow(/2 MiB/);
  });

  it("propagates read and quota errors without successful writes", () => {
    mutateDiscoveryPresets((items) => items.push(preset()));
    const raw = localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY);
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("read denied");
      });
    expect(() =>
      mutateDiscoveryPresets((items) => items.push(preset("two"))),
    ).toThrow("read denied");
    read.mockRestore();
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    expect(() =>
      mutateDiscoveryPresets((items) => items.push(preset("two"))),
    ).toThrow("quota");
    write.mockRestore();
    expect(localStorage.getItem(DISCOVERY_PRESET_STORAGE_KEY)).toBe(raw);
  });
});
