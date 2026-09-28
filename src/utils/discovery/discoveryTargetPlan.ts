import * as ipaddr from "ipaddr.js";

export const MAX_DISCOVERY_HOSTS = 10_000;
const MAX_TARGET_INPUT_BYTES = 256 * 1024;
const MAX_TARGET_TOKENS = 10_000;
interface Interval {
  family: 4 | 6;
  start: bigint;
  end: bigint;
}

/** Validate and union intervals before allocating or iterating any hosts. */
export function createDiscoveryTargetPlan(input: string): {
  totalHosts: number;
  hosts: () => Generator<string>;
} {
  if (
    input.length > MAX_TARGET_INPUT_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_TARGET_INPUT_BYTES
  )
    throw new Error("Target input must be at most 256 KiB.");
  const tokens = input
    .trim()
    .split(/[,;\s]+/)
    .filter(Boolean);
  if (!tokens.length) throw new Error("Enter an IP address or CIDR range.");
  if (tokens.length > MAX_TARGET_TOKENS)
    throw new Error(
      "Enter at most 10,000 IP/CIDR tokens, including duplicates.",
    );
  const intervals: Interval[] = tokens.map((token) => {
    if (token.includes("%"))
      throw new Error(
        "Scoped IPv6 addresses are not supported by Network Scanner.",
      );
    const [literal, suffix, extra] = token.split("/");
    if (extra !== undefined || (suffix !== undefined && !/^\d+$/.test(suffix)))
      throw new Error(`Malformed CIDR string: ${token}`);
    if (
      !literal.includes(":") &&
      !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(literal)
    )
      throw new Error(
        `IPv4 address must contain four decimal octets without leading zeros: ${literal}`,
      );
    if (!ipaddr.isValid(literal))
      throw new Error(`Invalid IP address: ${literal}`);
    const address = ipaddr.parse(literal);
    const family = address.kind() === "ipv4" ? 4 : 6;
    const bits = family === 4 ? 32 : 128;
    const prefix = suffix === undefined ? bits : Number(suffix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits)
      throw new Error(`Invalid prefix: ${token}`);
    const hostBits = BigInt(bits - prefix);
    const value = address
      .toByteArray()
      .reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
    const base = (value >> hostBits) << hostBits;
    const excludeEdges = family === 4 && prefix < 31;
    const start = base + (excludeEdges ? 1n : 0n);
    const end = base + (1n << hostBits) - (excludeEdges ? 2n : 1n);
    if (end - start + 1n > BigInt(MAX_DISCOVERY_HOSTS))
      throw new Error(
        `Choose at most ${MAX_DISCOVERY_HOSTS.toLocaleString("en-US")} unique hosts combined.`,
      );
    return { family, start, end };
  });
  intervals.sort(
    (a, b) =>
      a.family - b.family ||
      (a.start < b.start ? -1 : a.start > b.start ? 1 : 0),
  );
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.family === interval.family &&
      interval.start <= previous.end + 1n
    ) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else merged.push({ ...interval });
  }
  const total = merged.reduce(
    (n, interval) => n + interval.end - interval.start + 1n,
    0n,
  );
  if (total > BigInt(MAX_DISCOVERY_HOSTS))
    throw new Error("Choose at most 10,000 unique hosts combined.");
  return {
    totalHosts: Number(total),
    *hosts() {
      for (const interval of merged) {
        for (let value = interval.start; value <= interval.end; value++) {
          const bytes: number[] = [];
          for (
            let shift = interval.family === 4 ? 24n : 120n;
            shift >= 0n;
            shift -= 8n
          )
            bytes.push(Number((value >> shift) & 255n));
          yield ipaddr.fromByteArray(bytes).toString();
        }
      }
    },
  };
}
