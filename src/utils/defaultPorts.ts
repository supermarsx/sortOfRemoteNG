/**
 * Utilities for working with default network ports. Provides a lookup table
 * and helper to retrieve standard port numbers.
 */

/**
 * Mapping of supported protocols to their default port numbers. When a
 * protocol is not present in this map, {@link getDefaultPort} will fall back
 * to port `22`.
 */
export const DEFAULT_PORTS: Record<string, number> = {
  rdp: 3389,
  ssh: 22,
  vnc: 5900,
  http: 80,
  https: 443,
  telnet: 23,
  rlogin: 513,
};

/**
 * Returns the default port for a given protocol name.
 *
 * @param protocol - Protocol identifier such as `ssh` or `http`.
 * @returns The default port number. If the protocol is unknown, `22` is
 * returned as a safe fallback.
 */
export const getDefaultPort = (protocol: string): number => {
  return DEFAULT_PORTS[protocol] ?? 22;
};

export default getDefaultPort;
