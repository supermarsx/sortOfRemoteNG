import type { Connection } from "../../types/connection/connection";
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "../connection/sanitizeHostname";

/** Saved HTTP authority only; a redirect or live page cannot grant this scope. */
export function configuredHttpCredentialOrigin(
  connection: Partial<Connection> | null | undefined,
): string | null {
  if (connection?.protocol !== "http") return null;
  try {
    const authority = parseCanonicalWebAuthority(connection.hostname ?? "");
    if (authority.sourceScheme && authority.sourceScheme !== "http")
      return null;
    const port = resolveCanonicalWebPort(authority.port, connection.port, 80);
    return new URL(`http://${authority.hostname}:${port}`).origin;
  } catch {
    return null;
  }
}
