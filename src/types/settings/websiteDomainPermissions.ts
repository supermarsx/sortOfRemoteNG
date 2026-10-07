/** Public network policy only. No credentials, login consent or TLS exceptions. */
export const WEBSITE_REQUEST_CLASSES = [
  "script",
  "stylesheet",
  "font",
  "image-media",
  "fetch-xhr",
  "frame",
  "worker",
  "websocket",
  "navigation",
] as const;

export type WebsiteRequestClass = (typeof WEBSITE_REQUEST_CLASSES)[number];
export type WebsitePermissionDecision = "allow" | "deny";
export type WebsitePermissionSetting = "inherit" | WebsitePermissionDecision;
export type WebsiteRequestClassPermissions = Partial<
  Record<WebsiteRequestClass, WebsitePermissionSetting>
>;
export type WebsitePermissionApplicationDefaults = Partial<
  Record<WebsiteRequestClass, WebsitePermissionDecision>
>;

export interface WebsiteDestinationPermissions {
  /** Exact canonical HTTPS origin, including any non-default port. */
  origin: string;
  requestClasses: WebsiteRequestClassPermissions;
}

export interface WebsiteOriginPermissions extends WebsiteDestinationPermissions {
  destinations: WebsiteDestinationPermissions[];
}

/**
 * Use independently for app-wide defaults and each connection's overrides.
 * Overrides remain bound to their website origin when a connection URL changes.
 * Omitted request classes inherit. Domain labels never imply subdomain grants.
 */
export interface WebsiteDomainPermissionsSettings {
  version: 1;
  websites: WebsiteOriginPermissions[];
}

export type WebsitePermissionSource =
  | "native-constraint"
  | "connection-destination"
  | "connection-class"
  | "shared-destination"
  | "shared-class"
  | "application-default"
  | "invalid-policy"
  | "invalid-request";

export interface EffectiveWebsitePermission {
  decision: WebsitePermissionDecision;
  source: WebsitePermissionSource;
}

/** Inputs are validated at the persistence/native boundary, not trusted by cast. */
export interface WebsitePermissionQuery {
  websiteOrigin: unknown;
  destinationOrigin: unknown;
  requestClass: unknown;
  sharedSettings?: unknown;
  connectionOverrides?: unknown;
  applicationDefaults?: unknown;
  /** Caller-supplied native denial. An allow result never proves native readiness. */
  nativeConstraint?: "deny";
}
