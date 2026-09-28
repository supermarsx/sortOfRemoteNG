import type {
  DiscoveryPingMethod,
  DiscoveryProbeMethod,
  NetworkDiscoveryConfig,
} from "../../types/settings/settings";

export type { DiscoveryPingMethod, DiscoveryProbeMethod };
export const DISCOVERY_PROBE_METHODS = [
  "icmp",
  "icmp4",
  "icmp6",
  "icmp-native",
  "arp",
  "tcp",
  "udp",
] as const;
export const DISCOVERY_PING_METHODS = [
  "none",
  ...DISCOVERY_PROBE_METHODS,
  "adaptive",
  "combined",
] as const;
export const DEFAULT_DISCOVERY_PING_METHODS: DiscoveryProbeMethod[] = [
  "arp",
  "icmp",
  "tcp",
];

/** Separate stage switches retain stored methods/ports when temporarily disabled. */
export function effectiveDiscoveryPingMethod(
  config: NetworkDiscoveryConfig,
): DiscoveryPingMethod {
  if (config.hostDiscoveryEnabled === false) return "none";
  const method = config.pingMethod ?? "none";
  return method === "none" && config.hostDiscoveryEnabled === true
    ? "adaptive"
    : method;
}

export function isDiscoveryPingMethod(
  value: unknown,
): value is DiscoveryPingMethod {
  return (
    typeof value === "string" &&
    (DISCOVERY_PING_METHODS as readonly string[]).includes(value)
  );
}

export function isDiscoveryProbeMethods(
  value: unknown,
): value is DiscoveryProbeMethod[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= DISCOVERY_PROBE_METHODS.length &&
    new Set(value).size === value.length &&
    Array.from(value).every((method) =>
      (DISCOVERY_PROBE_METHODS as readonly unknown[]).includes(method),
    )
  );
}

export interface DiscoveryProbeResult {
  reachable: boolean;
  elapsed_ms?: number;
  error?: string | null;
  status?: "responsive" | "unresponsive" | "unavailable";
  attempts?: Array<{
    method: DiscoveryProbeMethod;
    status: "responsive" | "unresponsive" | "unavailable";
    elapsed_ms: number;
    error?: string | null;
  }>;
  mac_address?: string | null;
}
