import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  interfaceTargets,
  NETWORK_TARGET_HISTORY_KEY,
  NETWORK_TARGET_HISTORY_LIMIT,
  normalizeNetworkTarget,
  normalizeTargetHistory,
  readTargetHistory,
  rememberNetworkTarget,
} from "../../src/utils/discovery/networkTargets";

beforeEach(() => localStorage.removeItem(NETWORK_TARGET_HISTORY_KEY));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recent discovery targets", () => {
  it.each([
    [" 192.168.1.42 ", "192.168.1.42"],
    ["192.168.31.42/19", "192.168.0.0/19"],
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["2001:db8::4321/115", "2001:db8::4000/115"],
    ["192.0.2.1/32", "192.0.2.1/32"],
    ["2001:db8::1/128", "2001:db8::1/128"],
  ])("normalizes %s", (input, expected) =>
    expect(normalizeNetworkTarget(input)).toBe(expected),
  );

  it.each([
    null,
    {},
    12,
    "",
    "192.168.",
    "localhost",
    "127.1",
    "010.0.0.1",
    "256.0.0.1",
    "10.0.0.1/33",
    "::1/129",
    "fe80::1%eth0",
    "10.0.0.1/24/1",
    "10.0.0.1/-1",
  ])("rejects partial or malformed target %j", (value) => {
    expect(normalizeNetworkTarget(value)).toBeNull();
  });

  it("deduplicates canonical targets, preserves newest order and caps history", () => {
    const values = [
      "2001:0db8::1",
      "2001:db8::1",
      "10.0.0.42/24",
      "10.0.0.0/24",
      ...Array.from({ length: 30 }, (_, i) => `192.0.2.${i}`),
    ];
    const result = normalizeTargetHistory(values);
    expect(result).toHaveLength(NETWORK_TARGET_HISTORY_LIMIT);
    expect(result.slice(0, 3)).toEqual([
      "2001:db8::1",
      "10.0.0.0/24",
      "192.0.2.0",
    ]);
    expect(rememberNetworkTarget(result, "192.0.2.0")[0]).toBe("192.0.2.0");
    expect(
      normalizeTargetHistory([...Array(100).fill(null), "192.0.2.99"]),
    ).toEqual([]);
  });

  it("remembers individuals from comma, semicolon, whitespace and newline target lists", () => {
    expect(
      rememberNetworkTarget(
        ["192.0.2.9", "2001:db8::1"],
        "10.0.0.7/24, 2001:0db8::1;192.0.2.5\n192.0.2.9 invalid 10.0.0.0/24",
      ),
    ).toEqual(["10.0.0.0/24", "2001:db8::1", "192.0.2.5", "192.0.2.9"]);
  });

  it.each(["{", "null", "{}", "123", '"10.0.0.1"', " ".repeat(16385)])(
    "handles malformed or oversized local storage",
    (raw) => {
      localStorage.setItem(NETWORK_TARGET_HISTORY_KEY, raw);
      expect(readTargetHistory()).toEqual([]);
    },
  );

  it("filters unknown stored shapes and tolerates inaccessible storage", () => {
    localStorage.setItem(
      NETWORK_TARGET_HISTORY_KEY,
      JSON.stringify([null, {}, "2001:0DB8::1", "2001:db8::1"]),
    );
    expect(readTargetHistory()).toEqual(["2001:db8::1"]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(readTargetHistory()).toEqual([]);
  });
});

describe("actual interface subnets", () => {
  it("keeps actual parents and computes bounded slices containing each interface", () => {
    const result = interfaceTargets([
      {
        interfaceName: "Ethernet",
        address: "10.23.45.67",
        cidr: "10.23.45.67/16",
      },
      {
        interfaceName: "IPv6",
        address: "2001:db8::abcd",
        cidr: "2001:db8::abcd/64",
      },
      { interfaceName: "Small", address: "192.0.2.3", cidr: "192.0.2.3/24" },
      {
        interfaceName: "Small6",
        address: "2001:db8::abcd",
        cidr: "2001:db8::abcd/120",
      },
    ]);
    expect(
      result.map(({ cidr, target, isSlice }) => ({ cidr, target, isSlice })),
    ).toEqual([
      { cidr: "10.23.0.0/16", target: "10.23.32.0/19", isSlice: true },
      { cidr: "2001:db8::/64", target: "2001:db8::a000/115", isSlice: true },
      { cidr: "192.0.2.0/24", target: "192.0.2.0/24", isSlice: false },
      {
        cidr: "2001:db8::ab00/120",
        target: "2001:db8::ab00/120",
        isSlice: false,
      },
    ]);
    for (const item of result) {
      const prefix = Number(item.target.split("/")[1]);
      expect(
        2 ** ((item.address.includes(":") ? 128 : 32) - prefix),
      ).toBeLessThanOrEqual(10000);
    }
  });

  it("filters invalid, mismatched, loopback and unusable interface addresses", () => {
    const rows = [
      ["10.0.0.1", "192.0.2.0/24"],
      ["10.0.0.1", "2001:db8::/64"],
      ["127.0.0.1", "127.0.0.0/8"],
      ["::1", "::1/128"],
      ["0.0.0.0", "0.0.0.0/0"],
      ["::", "::/0"],
      ["224.0.0.1", "224.0.0.0/4"],
      ["ff02::1", "ff00::/8"],
      ["255.255.255.255", "0.0.0.0/0"],
      ["fe80::1", "fe80::/64"],
      ["bad", "10.0.0.0/24"],
      ["10.0.0.1/24", "10.0.0.0/24"],
    ].map(([address, cidr]) => ({ interfaceName: "eth0", address, cidr }));
    expect(
      interfaceTargets([
        null,
        {},
        ...rows,
        { interfaceName: " ", address: "10.0.0.1", cidr: "10.0.0.0/24" },
      ]),
    ).toEqual([]);
    expect(interfaceTargets({})).toEqual([]);
  });

  it("deduplicates normalized interface entries and bounds untrusted lists", () => {
    const row = {
      interfaceName: " eth0 ",
      address: "10.0.0.1",
      cidr: "10.0.0.1/24",
    };
    expect(
      interfaceTargets([
        row,
        { ...row, interfaceName: "eth0", cidr: "10.0.0.0/24" },
      ]),
    ).toHaveLength(1);
    expect(interfaceTargets([...Array(512).fill(null), row])).toEqual([]);
  });
});
