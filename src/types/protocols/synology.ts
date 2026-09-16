import type { Connection } from "../connection/connection";

/** Nonsecret saved settings. OTPs and native session receipts are never persisted. */
export interface SynologySettings {
  version: 1;
  useHttps: boolean;
  accessMode?: "native" | "website";
  /** Missing enables only the closed website redirect defaults, never login forwarding. */
  useDefaultRedirectDestinations?: boolean;
  /**
   * NAS API: ask DSM to trust this device after a successful two-factor sign-in.
   * Only the preference is saved here; the device token lives in the vault.
   */
  trustDevice?: boolean;
  /**
   * NAS API: id of the connection-local authenticator (`totpConfigs[].id`)
   * that answers DSM code challenges. Only the reference is saved here; the
   * secret stays in `totpConfigs`. Vault credentials use `credentialSource.totpId`.
   */
  otpAuthenticatorId?: string;
}

/** Longest accepted `otpAuthenticatorId`. */
export const SYNOLOGY_OTP_AUTHENTICATOR_ID_MAX_LENGTH = 128;

export function isValidSynologyOtpAuthenticatorId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SYNOLOGY_OTP_AUTHENTICATOR_ID_MAX_LENGTH &&
    // eslint-disable-next-line no-control-regex -- rejects C0/C1 control characters.
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function normalizeSynologySettings(value: unknown): SynologySettings {
  if (value === undefined) return { version: 1, useHttps: true };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Synology connection settings.");
  const input = value as Record<string, unknown>;
  if (
    input.version !== 1 ||
    typeof input.useHttps !== "boolean" ||
    (input.accessMode !== undefined &&
      input.accessMode !== "native" &&
      input.accessMode !== "website") ||
    (Object.prototype.hasOwnProperty.call(
      input,
      "useDefaultRedirectDestinations",
    ) &&
      typeof input.useDefaultRedirectDestinations !== "boolean") ||
    (Object.prototype.hasOwnProperty.call(input, "trustDevice") &&
      typeof input.trustDevice !== "boolean") ||
    (Object.prototype.hasOwnProperty.call(input, "otpAuthenticatorId") &&
      !isValidSynologyOtpAuthenticatorId(input.otpAuthenticatorId)) ||
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "useHttps",
          "accessMode",
          "useDefaultRedirectDestinations",
          "trustDevice",
          "otpAuthenticatorId",
        ].includes(key),
    )
  )
    throw new Error(
      "Unsupported Synology connection settings. Only transport, view, website redirect, trusted-device preferences and an authenticator reference can be saved.",
    );
  return {
    version: 1,
    useHttps: input.useHttps,
    ...(input.accessMode !== undefined
      ? { accessMode: input.accessMode as "native" | "website" }
      : {}),
    ...(input.useDefaultRedirectDestinations !== undefined
      ? {
          useDefaultRedirectDestinations:
            input.useDefaultRedirectDestinations as boolean,
        }
      : {}),
    ...(input.trustDevice !== undefined
      ? { trustDevice: input.trustDevice as boolean }
      : {}),
    ...(input.otpAuthenticatorId !== undefined
      ? { otpAuthenticatorId: input.otpAuthenticatorId as string }
      : {}),
  };
}

/** Legacy discriminator remains readable; new records use HTTP(S) plus a view. */
export function isSynologyFileConnection(
  connection: Partial<Connection>,
): boolean {
  return (
    connection.protocol === "synology" ||
    ((connection.protocol === "http" || connection.protocol === "https") &&
      connection.httpApplication?.id === "synology-dsm" &&
      connection.synologySettings?.accessMode === "native")
  );
}

/** Per-connection chains and custom TLS are unsupported. The explicit app-wide
 * HTTP(S) proxy is captured separately at runtime, never saved in this schema. */
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
      "Native File Station does not support per-connection proxy/VPN/tunnel chains. Use the app-wide HTTP(S) proxy, the DSM website connection, or explicitly remove this route.",
    );
  if (
    connection.httpVerifySsl === false ||
    (connection.httpsTrustPolicy && connection.httpsTrustPolicy !== "strict") ||
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
  return {
    ...input,
    protocol: settings.useHttps ? "https" : "http",
    synologySettings: { ...settings, accessMode: mode },
    httpApplication: { version: 1, id: "synology-dsm", loginMode: "manual" },
    httpAutoLogin: false,
  };
}
