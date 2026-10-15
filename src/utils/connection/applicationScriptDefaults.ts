import type { Connection } from "../../types/connection/connection";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import type { WebsiteDomainPermissionsSettings } from "../../types/settings/websiteDomainPermissions";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "./httpApplicationProfiles";
import { parseCanonicalWebAuthority } from "./sanitizeHostname";
import {
  normalizeWebsiteDomainPermissions,
  resolveWebsiteRequestClassDefault,
} from "../settings/websiteDomainPermissions";

/** Preview of a native origin-bound default; never a credential or network grant. */
export function applicationScriptDefaultOrigin(
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
    if (
      !app ||
      app.invalid ||
      !["instagram", "linkedin", "zoom"].includes(app.id)
    )
      return null;
    const defaults = getHttpApplicationProfile(app.id)?.scriptDefaults;
    if (defaults?.allowAllScripts !== true) return null;
    const source = parseCanonicalWebAuthority(connection.hostname);
    if (source.sourceScheme && source.sourceScheme !== "https") return null;
    if (source.port && connection.port && source.port !== connection.port)
      return null;
    const port = connection.port ?? source.port ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const url = new URL(`https://${source.hostname}/`);
    url.port = port === 443 ? "" : String(port);
    return url.origin === defaults.sourceOrigin ? url.origin : null;
  } catch {
    return null;
  }
}

export function applicationScriptsAllowed(
  connection: Partial<Connection>,
  policy: HttpProxyPolicy,
  sharedSettings: unknown,
): boolean {
  const origin = applicationScriptDefaultOrigin(connection);
  return (
    !!origin &&
    policy.pageScripts === "allow" &&
    !policy.sameOriginOnly &&
    resolveWebsiteRequestClassDefault({
      websiteOrigin: origin,
      requestClass: "script",
      connectionOverrides: connection.websiteDomainPermissions,
      sharedSettings,
      applicationDefaults: { script: "allow" },
    }).decision === "allow"
  );
}

/** The existing source-bound class override is the unambiguous block choice. */
export function setApplicationScriptPermission(
  connection: Partial<Connection>,
  allow: boolean,
): WebsiteDomainPermissionsSettings {
  const origin = applicationScriptDefaultOrigin(connection);
  if (!origin) throw new Error("Application script default unavailable.");
  const permissions = normalizeWebsiteDomainPermissions(
    connection.websiteDomainPermissions,
  );
  const existing = permissions.websites.find((row) => row.origin === origin);
  const changed = existing
    ? {
        ...existing,
        requestClasses: {
          ...existing.requestClasses,
          script: allow ? ("allow" as const) : ("deny" as const),
        },
      }
    : {
        origin,
        requestClasses: {
          script: allow ? ("allow" as const) : ("deny" as const),
        },
        destinations: [],
      };
  return normalizeWebsiteDomainPermissions({
    ...permissions,
    websites: existing
      ? permissions.websites.map((row) => (row === existing ? changed : row))
      : [...permissions.websites, changed],
  });
}
