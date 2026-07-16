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
  ard: 5900,
  // Serial is a local COM/tty device, not a TCP endpoint.
  serial: 0,
  vnc: 5900,
  http: 80,
  https: 443,
  winrm: 5985,
  telnet: 23,
  sftp: 22,
  mysql: 3306,
  smb: 445,
  // RustDesk saved connections primarily address a remote ID; 21116 is the
  // standard rendezvous/relay control port used when a numeric port is needed.
  rustdesk: 21116,
  // Raw Socket has no wire-level standard port; 23 is the conventional
  // netcat-style plaintext starting point and remains fully editable.
  raw: 23,
  rlogin: 513,
  gcp: 22,
  azure: 22,
  "ibm-csp": 22,
  "digital-ocean": 22,
  heroku: 22,
  scaleway: 22,
  linode: 22,
  ovhcloud: 22,
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
