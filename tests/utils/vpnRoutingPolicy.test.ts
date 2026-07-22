import { describe, expect, it } from "vitest";
import {
  isIpAddressInCidr,
  isLiteralIpAddress,
  resolveVpnRoutingPolicy,
} from "../../src/utils/network/vpnRoutingPolicy";

describe("VPN routing policy", () => {
  it("canonicalizes an omitted or explicit full-tunnel profile", () => {
    expect(resolveVpnRoutingPolicy(undefined)).toEqual({
      policy: { mode: "full", remoteSubnets: ["0.0.0.0/0", "::/0"] },
    });
    expect(
      resolveVpnRoutingPolicy({
        routingMode: "full",
        remoteSubnets: ["::/0", "0.0.0.0/0"],
      }),
    ).toEqual({
      policy: { mode: "full", remoteSubnets: ["0.0.0.0/0", "::/0"] },
    });
  });

  it("accepts and deduplicates explicit split-tunnel CIDRs", () => {
    expect(
      resolveVpnRoutingPolicy({
        routing_mode: "split",
        remote_subnets: ["10.20.0.0/16", "2001:db8:42::/48", "10.20.0.0/16"],
      }),
    ).toEqual({
      policy: {
        mode: "split",
        remoteSubnets: ["10.20.0.0/16", "2001:db8:42::/48"],
      },
    });
  });

  it("fails closed for empty, malformed, or default-route split policies", () => {
    expect(
      resolveVpnRoutingPolicy({ routingMode: "split", remoteSubnets: [] }),
    ).toEqual({
      connectDisabledReason:
        "Split-tunnel VPN profiles require at least one remote subnet.",
    });
    expect(
      resolveVpnRoutingPolicy({
        routingMode: "split",
        remoteSubnets: ["10.0.0.0/33"],
      }).connectDisabledReason,
    ).toContain("remote subnet 1");
    expect(
      resolveVpnRoutingPolicy({
        routingMode: "split",
        remoteSubnets: ["0.0.0.0/0"],
      }).connectDisabledReason,
    ).toContain("default route");
  });

  it("never includes invalid profile content in validation errors", () => {
    const marker = "secret-host.example/24";
    const result = resolveVpnRoutingPolicy({
      routingMode: "split",
      remoteSubnets: [marker],
    });
    expect(result.connectDisabledReason).toBeDefined();
    expect(result.connectDisabledReason).not.toContain(marker);
  });

  it("matches only strict literal addresses against same-family CIDRs", () => {
    expect(isLiteralIpAddress("10.20.30.40")).toBe(true);
    expect(isLiteralIpAddress("2001:db8:42::7")).toBe(true);
    expect(isLiteralIpAddress("vpn.example.test")).toBe(false);
    expect(isLiteralIpAddress("010.020.030.040")).toBe(false);
    expect(isIpAddressInCidr("10.20.30.40", "10.20.0.0/16")).toBe(true);
    expect(isIpAddressInCidr("10.21.30.40", "10.20.0.0/16")).toBe(false);
    expect(isIpAddressInCidr("2001:db8:42::7", "2001:db8:42::/48")).toBe(true);
    expect(isIpAddressInCidr("10.20.30.40", "2001:db8::/32")).toBe(false);
  });
});
