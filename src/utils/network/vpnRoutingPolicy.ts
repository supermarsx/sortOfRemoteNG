import type { VpnRoutingMode, VpnRoutingPolicy } from "./vpnProviderCatalog";
import * as ipaddr from "ipaddr.js";

const FULL_TUNNEL_SUBNETS = ["0.0.0.0/0", "::/0"] as const;
const FULL_TUNNEL_SUBNET_SET = new Set<string>(FULL_TUNNEL_SUBNETS);

interface RoutingConfigLike {
  routingMode?: unknown;
  routing_mode?: unknown;
  remoteSubnets?: unknown;
  remote_subnets?: unknown;
}

export interface VpnRoutingPolicyResult {
  policy?: VpnRoutingPolicy;
  connectDisabledReason?: string;
}

/**
 * Validate the routing fields carried by a saved VPN profile. The returned
 * reason names only the field/index and never echoes profile content.
 */
export function resolveVpnRoutingPolicy(
  value: unknown,
): VpnRoutingPolicyResult {
  const config =
    value && typeof value === "object"
      ? (value as RoutingConfigLike)
      : undefined;
  const rawMode = config?.routingMode ?? config?.routing_mode ?? "full";
  if (rawMode !== "full" && rawMode !== "split") {
    return {
      connectDisabledReason:
        "VPN routing mode is invalid; choose full or split routing.",
    };
  }
  const mode: VpnRoutingMode = rawMode;
  const rawSubnets = config?.remoteSubnets ?? config?.remote_subnets ?? [];
  if (
    !Array.isArray(rawSubnets) ||
    rawSubnets.some((value) => typeof value !== "string")
  ) {
    return {
      connectDisabledReason: "VPN remote subnets must be a list of CIDRs.",
    };
  }

  const remoteSubnets: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rawSubnets.length; index += 1) {
    const subnet = rawSubnets[index].trim();
    if (!isValidCidr(subnet)) {
      return {
        connectDisabledReason: `VPN remote subnet ${index + 1} is not a valid IPv4 or IPv6 CIDR.`,
      };
    }
    if (!seen.has(subnet)) {
      seen.add(subnet);
      remoteSubnets.push(subnet);
    }
  }

  if (mode === "full") {
    if (remoteSubnets.some((subnet) => !FULL_TUNNEL_SUBNET_SET.has(subnet))) {
      return {
        connectDisabledReason:
          "Full-tunnel VPN profiles cannot define custom remote subnets; choose split routing instead.",
      };
    }
    return { policy: { mode, remoteSubnets: FULL_TUNNEL_SUBNETS } };
  }

  if (remoteSubnets.length === 0) {
    return {
      connectDisabledReason:
        "Split-tunnel VPN profiles require at least one remote subnet.",
    };
  }
  if (remoteSubnets.some((subnet) => FULL_TUNNEL_SUBNET_SET.has(subnet))) {
    return {
      connectDisabledReason:
        "Split-tunnel VPN profiles cannot include a default route; choose full routing instead.",
    };
  }
  return { policy: { mode, remoteSubnets } };
}

export function isLiteralIpAddress(value: string): boolean {
  return (
    ipaddr.IPv4.isValidFourPartDecimal(value) ||
    (!value.includes("%") && ipaddr.IPv6.isValid(value))
  );
}

export function isIpAddressInCidr(address: string, cidr: string): boolean {
  if (!isLiteralIpAddress(address) || !isValidCidr(cidr)) return false;
  const parsedAddress = ipaddr.parse(address);
  const range = ipaddr.parseCIDR(cidr);
  return parsedAddress.kind() === range[0].kind() && parsedAddress.match(range);
}

function isValidCidr(value: string): boolean {
  return (
    ipaddr.IPv4.isValidCIDRFourPartDecimal(value) ||
    (!value.includes("%") && ipaddr.IPv6.isValidCIDR(value))
  );
}
