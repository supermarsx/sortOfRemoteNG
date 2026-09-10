import type { Connection } from "../connection/connection";

/** Nonsecret saved settings. OTPs and native session receipts are never persisted. */
export interface SynologySettings {
  version: 1;
  useHttps: boolean;
}

export function normalizeSynologySettings(value: unknown): SynologySettings {
  if (value === undefined) return { version: 1, useHttps: true };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Synology connection settings.");
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    typeof input.useHttps !== "boolean" ||
    Object.keys(input).some((key) => key !== "version" && key !== "useHttps")
  )
    throw new Error(
      "Unsupported Synology connection settings. Only transport preferences can be saved.",
    );
  return { version: 1, useHttps: input.useHttps };
}

/** Native File Station currently supports direct connections and system TLS trust only. */
export function assertSynologyNativeRoute(
  connection: Partial<Connection>,
): void {
  if (
    connection.proxyChainId ||
    connection.connectionChainId ||
    connection.tunnelChainId ||
    connection.security?.proxy ||
    connection.security?.openvpn?.enabled ||
    connection.security?.sshTunnel?.enabled ||
    connection.security?.tunnelChain?.length
  )
    throw new Error(
      "Native File Station does not support this proxy/VPN/tunnel route. Use the DSM website connection or explicitly remove the route.",
    );
  if (
    connection.httpVerifySsl === false ||
    connection.httpsTrustPolicy ||
    connection.certificateTrustPolicy ||
    connection.tlsTrustPolicy
  )
    throw new Error(
      "Native File Station uses verified system TLS trust, not browser trust overrides. Use the DSM website connection for custom certificate trust.",
    );
}

/** Switch only the explicit access mode; preserve routing, trust, and saved credentials. */
export function setSynologyAccessMode(
  input: Partial<Connection>,
  mode: "native" | "website",
): Partial<Connection> {
  const settings = normalizeSynologySettings(input.synologySettings);
  if (input.protocol === "http" || input.protocol === "https")
    settings.useHttps = input.protocol === "https";
  if (mode === "native")
    return { ...input, protocol: "synology", synologySettings: settings };
  return {
    ...input,
    protocol: settings.useHttps ? "https" : "http",
    synologySettings: settings,
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    httpAutoLogin: false,
  };
}
