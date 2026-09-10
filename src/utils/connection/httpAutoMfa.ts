import type {
  Connection,
  HttpAutoMfaSettings,
} from "../../types/connection/connection";
import { parseCanonicalWebAuthority } from "./sanitizeHostname";

const invalid = () =>
  new Error(
    "Automatic 2FA configuration is invalid. Review the selected authenticator and HTTPS origin in Application settings.",
  );
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !Array.from(value).some((char) => char.charCodeAt(0) < 32);

export function normalizeHttpAutoMfa(value: unknown): HttpAutoMfaSettings {
  if (value === undefined) return { version: 1, enabled: false };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "version",
          "enabled",
          "totpConfigId",
          "challengeId",
          "origin",
        ].includes(key),
    ) ||
    input.version !== 1 ||
    typeof input.enabled !== "boolean"
  )
    throw invalid();
  const result: HttpAutoMfaSettings = { version: 1, enabled: input.enabled };
  for (const key of ["totpConfigId", "challengeId"] as const) {
    if (input[key] === undefined && !input.enabled) continue;
    if (!validId(input[key])) throw invalid();
    result[key] = input[key];
  }
  if (input.origin !== undefined || input.enabled) {
    if (typeof input.origin !== "string" || input.origin.length > 512)
      throw invalid();
    try {
      const url = new URL(input.origin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.origin !== input.origin
      )
        throw invalid();
      result.origin = url.origin;
    } catch {
      throw invalid();
    }
  }
  return result;
}

export function getHttpAutoMfaOrigin(
  connection: Pick<Connection, "protocol" | "hostname" | "port">,
): string {
  if (connection.protocol !== "https")
    throw new Error("Automatic 2FA requires HTTPS.");
  const authority = parseCanonicalWebAuthority(connection.hostname);
  if (authority.sourceScheme && authority.sourceScheme !== "https")
    throw invalid();
  if (authority.port && connection.port && authority.port !== connection.port)
    throw invalid();
  const port = connection.port || authority.port || 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
  return new URL(`https://${authority.hostname}:${port}`).origin;
}
