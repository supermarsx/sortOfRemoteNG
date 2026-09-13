import type { Connection } from "../../types/connection/connection";
import { parseCanonicalWebAuthority } from "../connection/sanitizeHostname";
import { normalizeHttpRedirectOrigin } from "./httpTrustedRedirectDestinations";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeAdvancedProtocolConnection } from "../connection/normalizeAdvancedProtocolConnection";
import { normalizeHttpAutomation } from "../connection/sessionQuickActions";

export function httpRedirectConnectionOrigin(connection: Connection): string {
  if (!["http", "https"].includes(connection.protocol))
    throw new Error("Trusted redirects require a saved HTTP(S) connection.");
  const authority = parseCanonicalWebAuthority(connection.hostname);
  if (authority.sourceScheme && authority.sourceScheme !== connection.protocol)
    throw new Error(
      "The saved web origin must be reviewed before remembering redirects.",
    );
  const port =
    connection.port ??
    authority.port ??
    (connection.protocol === "https" ? 443 : 80);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (authority.port && authority.port !== port)
  )
    throw new Error(
      "The saved web port must be reviewed before remembering redirects.",
    );
  const url = new URL(`${connection.protocol}://${authority.hostname}/`);
  url.port = String(port);
  return normalizeHttpRedirectOrigin(url.origin);
}

/** Private comparison key; never return it as UI revision, log it or persist it.
 * New security fields participate automatically. Only presentation/bookkeeping
 * and the separately re-read trusted list are excluded. */
export function httpRedirectTrustIdentity(connection: Connection): string {
  const source: Record<string, unknown> = {
    ...normalizeAdvancedProtocolConnection(connection),
  };
  // Appearance is not routing, authentication or script/macro consent. Editing
  // only these visual settings must not invalidate a live saved-source lease.
  const {
    forceDark: _forceDark,
    darkMode: _darkMode,
    ...automation
  } = normalizeHttpAutomation(connection.httpAutomation);
  source.httpAutomation = automation;
  for (const key of [
    "httpTrustedRedirectDestinations",
    "lastConnected",
    "connectionCount",
    "updatedAt",
    "lastAccessed",
    "lastUsed",
    "name",
    "description",
    "tags",
    "order",
    "color",
    "icon",
    "expanded",
  ])
    delete source[key];
  // The Provider hydrates persisted dates. Compare equivalent instants without
  // removing creation identity or collapsing missing/invalid legacy values.
  const createdAt = source.createdAt;
  if (typeof createdAt === "string" || createdAt instanceof Date) {
    const timestamp = new Date(createdAt).getTime();
    if (Number.isFinite(timestamp))
      source.createdAt = new Date(timestamp).toISOString();
  }
  source.hostname = httpRedirectConnectionOrigin(connection);
  delete source.port;
  return stableJsonStringify(source);
}
