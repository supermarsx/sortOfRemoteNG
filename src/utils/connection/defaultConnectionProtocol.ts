/** Defaults shared by blank saved-connection drafts and Quick Connect. */
export const DEFAULT_CONNECTION_PROTOCOLS = [
  "rdp",
  "ssh",
  "vnc",
  "http",
  "https",
  "telnet",
] as const;

export type DefaultConnectionProtocol =
  (typeof DEFAULT_CONNECTION_PROTOCOLS)[number];

export const DEFAULT_CONNECTION_PROTOCOL: DefaultConnectionProtocol = "https";

/** Missing/invalid preferences do not silently opt new websites out of TLS. */
export function normalizeDefaultConnectionProtocol(
  value: unknown,
): DefaultConnectionProtocol {
  return DEFAULT_CONNECTION_PROTOCOLS.includes(
    value as DefaultConnectionProtocol,
  )
    ? (value as DefaultConnectionProtocol)
    : DEFAULT_CONNECTION_PROTOCOL;
}
