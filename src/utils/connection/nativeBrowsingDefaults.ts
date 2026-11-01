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
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "./sanitizeHostname";

/** Old normalized false flags have no user-choice provenance. Only the ordinary
 * default-shaped policy adopts normal native browsing; custom restrictions stay. */
export function nativeBrowsingMode(
  policy: Partial<HttpProxyPolicy> | undefined,
): NonNullable<HttpProxyPolicy["nativeBrowsingMode"]> {
  if (
    policy?.nativeBrowsingMode === "standard" ||
    policy?.nativeBrowsingMode === "restricted" ||
    policy?.nativeBrowsingMode === "strict"
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

export const NATIVE_BROWSING_MODE_OPTIONS = [
  { value: "standard", label: "Standard browsing" },
  { value: "restricted", label: "Restricted browsing" },
  { value: "strict", label: "Strict browsing" },
];

export const NATIVE_BROWSING_MODE_HELP =
  "Standard is recommended for everyday websites: scripts, media and embedded content load normally. Restricted allows approved external sources. Strict keeps requests on this website only and can break sign-in. All three use the private proxy and respect your saved website blocks.";

/** Selecting a level applies its content defaults; domain blocks and TLS trust stay separate. */
export function nativeBrowsingPreset(
  mode: NonNullable<HttpProxyPolicy["nativeBrowsingMode"]>,
): Partial<HttpProxyPolicy> {
  return {
    nativeBrowsingMode: mode,
    pageScripts: "allow",
    sameOriginOnly: mode === "strict",
    allowAllScripts: false,
    allowAllRequests: false,
    allowExternalFonts: mode !== "strict",
  };
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
    nativeBrowsingMode(policy) === "strict" ||
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
    const port = resolveCanonicalWebPort(
      source.port,
      connection.port,
      connection.protocol === "https" ? 443 : 80,
    );
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
