import { describe, expect, it } from "vitest";
import { createDiscoveryTargetPlan } from "../../src/utils/discovery/discoveryTargetPlan";

describe("native discovery target planning", () => {
  it.each([
    "010.0.0.1",
    "192.168.001.1/24",
    "001.2.3.4",
    "00.0.0.0",
    "0x7f.0.0.1",
  ])("rejects ambiguous IPv4 %s rather than redirecting the scan", (input) => {
    expect(() => createDiscoveryTargetPlan(input)).toThrow();
  });
  it("bounds input length and token count before parsing or merging intervals", () => {
    expect(() => createDiscoveryTargetPlan("x".repeat(256 * 1024 + 1))).toThrow(
      "256 KiB",
    );
    expect(() => createDiscoveryTargetPlan("\u2003".repeat(100000))).toThrow(
      "256 KiB",
    );
    expect(() =>
      createDiscoveryTargetPlan(Array(10001).fill("192.0.2.1").join(",")),
    ).toThrow("10,000 IP/CIDR tokens");
    expect(
      createDiscoveryTargetPlan(Array(10000).fill("192.0.2.1").join(","))
        .totalHosts,
    ).toBe(1);
  });
  it("normalizes mixed separators and unions overlapping IPv4/IPv6 ranges", () => {
    const plan = createDiscoveryTargetPlan(
      "192.0.2.5/30,192.0.2.5;192.0.2.4/31\n2001:0db8:0::1 2001:db8::/126\t2001:db8::2",
    );
    expect(plan.totalHosts).toBe(7);
    expect([...plan.hosts()]).toEqual([
      "192.0.2.4",
      "192.0.2.5",
      "192.0.2.6",
      "2001:db8::",
      "2001:db8::1",
      "2001:db8::2",
      "2001:db8::3",
    ]);
  });
  it("accepts exactly 10,000 unique addresses, including repeated inputs", () => {
    const input =
      "2001:db8::/115;2001:db8::2000/118;2001:db8::2400/119;2001:db8::2600/120;2001:db8::2700/124";
    const plan = createDiscoveryTargetPlan(`${input},${input}`);
    expect(plan.totalHosts).toBe(10_000);
    expect([...plan.hosts()]).toHaveLength(10_000);
    expect(() => createDiscoveryTargetPlan(`${input},192.0.2.1`)).toThrow(
      "10,000",
    );
  });
  it.each(["0.0.0.0/0", "10.0.0.0/18", "::/0", "2001:db8::/64", "::/114"])(
    "rejects oversized %s before returning a generator",
    (input) => {
      expect(() => createDiscoveryTargetPlan(input)).toThrow("10,000");
    },
  );
  it.each([
    "",
    "192.0.2",
    "192.0.2.1/33",
    "::/129",
    "::/-1",
    "::/64/1",
    "::/",
    "example.com",
    "fe80::1%3",
  ])("rejects malformed or nonliteral %s", (input) =>
    expect(() => createDiscoveryTargetPlan(input)).toThrow(),
  );
  it("accepts larger native IPv4 networks without expanding before counting", () => {
    const plan = createDiscoveryTargetPlan("10.0.1.8/19,10.0.1.8/24");
    expect(plan.totalHosts).toBe(8190);
    expect(plan.hosts().next().value).toBe("10.0.0.1");
  });
  it("orders unsigned IPv4 addresses and retains IPv4 /31 and /32 edges", () => {
    expect([
      ...createDiscoveryTargetPlan(
        "255.255.255.255,128.0.0.0/31,1.0.0.0/32",
      ).hosts(),
    ]).toEqual(["1.0.0.0", "128.0.0.0", "128.0.0.1", "255.255.255.255"]);
  });
});
