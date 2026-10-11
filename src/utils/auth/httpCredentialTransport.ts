import type { Connection } from "../../types/connection/connection";
import { parseCanonicalWebAuthority } from "../connection/sanitizeHostname";

/** Saved HTTP authority only; a redirect or live page cannot grant this scope. */
export function configuredHttpCredentialOrigin(
  connection: Partial<Connection> | null | undefined,
): string | null {
  if (connection?.protocol !== "http") return null;
  try {
    const authority = parseCanonicalWebAuthority(connection.hostname ?? "");
    if (authority.sourceScheme && authority.sourceScheme !== "http")
      return null;
    const configuredPort = connection.port ?? undefined;
    if (authority.port && configuredPort && authority.port !== configuredPort)
      return null;
    const port = configuredPort ?? authority.port ?? 80;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return new URL(`http://${authority.hostname}:${port}`).origin;
  } catch {
    return null;
  }
}
