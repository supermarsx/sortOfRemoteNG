import ipaddr from "ipaddr.js";

export const NETWORK_TARGET_HISTORY_KEY = "network-discovery-target-history-v1";
export const NETWORK_TARGET_HISTORY_LIMIT = 20;

export interface InterfaceSubnet {
  interfaceName: string;
  address: string;
  cidr: string;
}

export interface InterfaceTarget extends InterfaceSubnet {
  target: string;
  isSlice: boolean;
}

/** Canonical IP/CIDR only: never remember a partial edit, hostname, or zone ID. */
export function normalizeNetworkTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > 128 || input.includes("%")) return null;
  const [address, prefix, extra] = input.split("/");
  if (extra !== undefined) return null;
  if (
    !address.includes(":") &&
    !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)
  )
    return null;
  try {
    const parsed = ipaddr.parse(address);
    if (prefix === undefined) return parsed.toString();
    if (!/^\d{1,3}$/.test(prefix)) return null;
    const bits = Number(prefix);
    const maxBits = parsed.kind() === "ipv4" ? 32 : 128;
    if (bits > maxBits) return null;
    const cidr = `${parsed.toString()}/${bits}`;
    const network =
      parsed.kind() === "ipv4"
        ? ipaddr.IPv4.networkAddressFromCIDR(cidr)
        : ipaddr.IPv6.networkAddressFromCIDR(cidr);
    return `${network.toString()}/${bits}`;
  } catch {
    return null;
  }
}

export function normalizeTargetHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  // Bound work even if storage was edited outside the app.
  for (const item of value.slice(0, 100)) {
    const target = normalizeNetworkTarget(item);
    if (target) result.add(target);
    if (result.size === NETWORK_TARGET_HISTORY_LIMIT) break;
  }
  return [...result];
}

export function rememberNetworkTarget(
  history: string[],
  value: string,
): string[] {
  const targets = value
    .split(/[,;\s]+/)
    .map(normalizeNetworkTarget)
    .filter((target): target is string => target !== null);
  return normalizeTargetHistory([...targets, ...history]);
}

export function readTargetHistory(): string[] {
  try {
    const raw = localStorage.getItem(NETWORK_TARGET_HISTORY_KEY);
    return raw && raw.length <= 16_384
      ? normalizeTargetHistory(JSON.parse(raw))
      : [];
  } catch {
    return [];
  }
}

/** Show a bounded slice explicitly when an interface has a larger real subnet. */
export function interfaceTargets(value: unknown): InterfaceTarget[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, InterfaceTarget>();
  for (const row of value.slice(0, 512)) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.interfaceName !== "string"
    )
      continue;
    const address = normalizeNetworkTarget(row.address);
    const cidr = normalizeNetworkTarget(row.cidr);
    if (!address || address.includes("/") || !cidr?.includes("/")) continue;
    const parsed = ipaddr.parse(address);
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    if (parsed.kind() !== network.kind() || !parsed.match(network, prefix))
      continue;
    if (
      ["loopback", "unspecified", "multicast", "broadcast"].includes(
        parsed.range(),
      )
    )
      continue;
    if (parsed.kind() === "ipv6" && parsed.range() === "linkLocal") continue;
    // /19 IPv4 and /115 IPv6 fit the 10,000-host ceiling. Keep the real
    // parent subnet visible rather than pretending this is its netmask.
    const boundedPrefix = Math.max(prefix, parsed.kind() === "ipv4" ? 19 : 115);
    const target = normalizeNetworkTarget(`${address}/${boundedPrefix}`)!;
    const interfaceName = row.interfaceName.trim().slice(0, 256);
    if (!interfaceName) continue;
    result.set(`${interfaceName}\n${address}\n${cidr}`, {
      interfaceName,
      address,
      cidr,
      target,
      isSlice: boundedPrefix !== prefix,
    });
  }
  return [...result.values()];
}
