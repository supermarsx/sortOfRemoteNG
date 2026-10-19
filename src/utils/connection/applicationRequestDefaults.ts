import type { Connection } from "../../types/connection/connection";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import {
  WEBSITE_REQUEST_CLASSES,
  type WebsiteDomainPermissionsSettings,
  type WebsiteRequestClassPermissions,
} from "../../types/settings/websiteDomainPermissions";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "./httpApplicationProfiles";
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "./sanitizeHostname";
import {
  normalizeWebsiteDomainPermissions,
  resolveWebsiteRequestClassDefault,
  resolveWebsiteRequestPermission,
} from "../settings/websiteDomainPermissions";

/** Editor preview only; the native route and request policy remain authoritative. */
export function applicationRequestDefaultOrigin(
  connection: Partial<Connection>,
): string | null {
  try {
    if (
      connection.isGroup ||
      connection.protocol !== "https" ||
      !connection.hostname
    )
      return null;
    const app = normalizeHttpApplicationSettings(connection.httpApplication);
    if (!app || app.invalid || app.id !== "zoom") return null;
    const defaults = getHttpApplicationProfile(app.id)?.requestDefaults;
    if (defaults?.allowAllRequests !== true) return null;
    const source = parseCanonicalWebAuthority(connection.hostname);
    if (source.sourceScheme && source.sourceScheme !== "https") return null;
    const port = resolveCanonicalWebPort(source.port, connection.port, 443);
    const url = new URL(`https://${source.hostname}/`);
    url.port = port === 443 ? "" : String(port);
    return url.origin === defaults.sourceOrigin ? url.origin : null;
  } catch {
    return null;
  }
}

export function applicationRequestsAllowed(
  connection: Partial<Connection>,
  policy: HttpProxyPolicy,
  sharedSettings: unknown,
): boolean {
  const origin = applicationRequestDefaultOrigin(connection);
  return (
    !!origin &&
    policy.pageScripts === "allow" &&
    !policy.sameOriginOnly &&
    WEBSITE_REQUEST_CLASSES.every(
      (requestClass) =>
        resolveWebsiteRequestClassDefault({
          websiteOrigin: origin,
          requestClass,
          connectionOverrides: connection.websiteDomainPermissions,
          sharedSettings,
          applicationDefaults: Object.fromEntries(
            WEBSITE_REQUEST_CLASSES.map((key) => [key, "allow"]),
          ),
        }).decision === "allow",
    )
  );
}

/** Persist an explicit source-bound decision; legacy normalized false is not an opt-out. */
export function setApplicationRequestPermission(
  connection: Partial<Connection>,
  allow: boolean,
  sharedSettings?: unknown,
): WebsiteDomainPermissionsSettings {
  const origin = applicationRequestDefaultOrigin(connection);
  if (!origin) throw new Error("Application request default unavailable.");
  const permissions = normalizeWebsiteDomainPermissions(
    connection.websiteDomainPermissions,
  );
  // An invalid shared document must not be frozen into new connection grants.
  normalizeWebsiteDomainPermissions(sharedSettings);
  const existing = permissions.websites.find((row) => row.origin === origin);
  const requestClasses: WebsiteRequestClassPermissions = Object.fromEntries(
    WEBSITE_REQUEST_CLASSES.map((key) => [key, allow ? "allow" : "deny"]),
  );
  let destinations = existing?.destinations ?? [];
  if (!allow) {
    // Revoking broad destinations must not revoke the website itself. Freeze
    // its existing effective source permissions, including explicit denials.
    const source = destinations.find((row) => row.origin === origin);
    const ownClasses: WebsiteRequestClassPermissions = Object.fromEntries(
      WEBSITE_REQUEST_CLASSES.map((requestClass) => [
        requestClass,
        resolveWebsiteRequestPermission({
          websiteOrigin: origin,
          destinationOrigin: origin,
          requestClass,
          connectionOverrides: connection.websiteDomainPermissions,
          sharedSettings,
          applicationDefaults: Object.fromEntries(
            WEBSITE_REQUEST_CLASSES.map((key) => [key, "allow"]),
          ),
        }).decision,
      ]),
    );
    const own = { origin, requestClasses: ownClasses };
    destinations = source
      ? destinations.map((row) => (row === source ? own : row))
      : [...destinations, own];
  }
  const changed = { origin, ...existing, requestClasses, destinations };
  return normalizeWebsiteDomainPermissions({
    ...permissions,
    websites: existing
      ? permissions.websites.map((row) => (row === existing ? changed : row))
      : [...permissions.websites, changed],
  });
}
