import type { Connection } from "../../types/connection/connection";
import {
  DEFAULT_HTTP_PROXY_POLICY,
  type HttpProxyPolicy,
} from "../../types/connection/httpProxyPolicy";
import { WEBSITE_REQUEST_CLASSES } from "../../types/settings/websiteDomainPermissions";
import { stableJsonStringify } from "../core/stableJsonStringify";
import {
  normalizeWebsiteDomainPermissions,
  resolveWebsiteRequestClassDefault,
} from "../settings/websiteDomainPermissions";
import { parseCanonicalWebAuthority } from "./sanitizeHostname";

/** Old normalized false flags have no user-choice provenance. Only the ordinary
 * default-shaped policy adopts normal native browsing; custom restrictions stay. */
export function nativeBrowsingMode(
  policy: Partial<HttpProxyPolicy> | undefined,
): "standard" | "restricted" {
  if (
    policy?.nativeBrowsingMode === "standard" ||
    policy?.nativeBrowsingMode === "restricted"
  )
    return policy.nativeBrowsingMode;
  if (!policy) return "standard";
  for (const [key, value] of Object.entries(policy)) {
    if (value === undefined) continue;
    if (key === "nativeBrowsingMode") return "restricted";
    if (
      ![
        "version",
        "pageScripts",
        "allowAllScripts",
        "allowAllRequests",
        "sameOriginOnly",
        "allowExternalFonts",
        "externalFontOrigins",
        "externalResourceOrigins",
      ].includes(key)
    ) {
      if (!(key in DEFAULT_HTTP_PROXY_POLICY)) return "restricted";
      continue;
    }
    if (
      stableJsonStringify(value) !==
      stableJsonStringify(
        DEFAULT_HTTP_PROXY_POLICY[key as keyof HttpProxyPolicy],
      )
    )
      return "restricted";
  }
  return "standard";
}

/** Preview class defaults only; explicit destination rules and native checks remain. */
export function nativeBrowserContentAllowed(
  connection: Partial<Connection>,
  policy: HttpProxyPolicy,
  sharedSettings: unknown,
  scriptsOnly = false,
): boolean {
  if (
    connection.isGroup ||
    policy.sameOriginOnly ||
    policy.pageScripts !== "allow"
  )
    return false;
  const broad =
    nativeBrowsingMode(policy) === "standard" ||
    policy.allowAllRequests === true ||
    (scriptsOnly && policy.allowAllScripts === true);
  if (!broad) return false;
  try {
    if (!connection.hostname)
      return (
        normalizeWebsiteDomainPermissions(connection.websiteDomainPermissions)
          .websites.length === 0 &&
        normalizeWebsiteDomainPermissions(sharedSettings).websites.length === 0
      );
    if (!["https", "http"].includes(connection.protocol ?? "")) return false;
    const source = parseCanonicalWebAuthority(connection.hostname);
    if (source.sourceScheme && source.sourceScheme !== connection.protocol)
      return false;
    if (
      source.port !== undefined &&
      connection.port !== undefined &&
      source.port !== connection.port
    )
      return false;
    const port =
      connection.port ??
      source.port ??
      (connection.protocol === "https" ? 443 : 80);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    const url = new URL(`${connection.protocol}://${source.hostname}/`);
    url.port = String(port);
    return (scriptsOnly ? ["script" as const] : WEBSITE_REQUEST_CLASSES).every(
      (requestClass) =>
        resolveWebsiteRequestClassDefault({
          websiteOrigin: url.origin,
          requestClass,
          sharedSettings,
          connectionOverrides: connection.websiteDomainPermissions,
          applicationDefaults: Object.fromEntries(
            WEBSITE_REQUEST_CLASSES.map((key) => [key, "allow"]),
          ),
        }).decision === "allow",
    );
  } catch {
    return false;
  }
}
