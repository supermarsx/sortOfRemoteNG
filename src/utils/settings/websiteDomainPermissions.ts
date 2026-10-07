import {
  WEBSITE_REQUEST_CLASSES,
  type EffectiveWebsitePermission,
  type WebsiteDestinationPermissions,
  type WebsiteDomainPermissionsSettings,
  type WebsiteOriginPermissions,
  type WebsitePermissionApplicationDefaults,
  type WebsitePermissionQuery,
  type WebsitePermissionSetting,
  type WebsitePermissionSource,
  type WebsiteRequestClass,
  type WebsiteRequestClassPermissions,
} from "../../types/settings/websiteDomainPermissions";

export const MAX_WEBSITE_PERMISSION_WEBSITES = 64;
export const MAX_WEBSITE_PERMISSION_DESTINATIONS = 32;
export const MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS = 256;
export const MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH = 2048;

const invalid = (): never => {
  // Never echo an untrusted key/origin: it may contain a pasted secret.
  throw new Error("Invalid website request permissions.");
};

/** Accept origins only; never strip a path, credentials or a query into a grant. */
export function canonicalWebsitePermissionOrigin(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_WEBSITE_PERMISSION_ORIGIN_LENGTH ||
    /[\s\p{C}@%*\\?#]/u.test(value)
  )
    return invalid();
  const match =
    /^https:\/\/(\[[0-9a-f:.]+\]|[^:/]+)(?::([1-9]\d{0,4}))?\/?$/i.exec(value);
  if (!match || (match[2] && Number(match[2]) > 65535)) return invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !host
  )
    return invalid();
  if (!host.startsWith("[")) {
    if (
      host.length > 253 ||
      host
        .split(".")
        .some(
          (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      // Reject URL-parser IPv4 aliases such as 127.1, integer/hex/octal hosts.
      (/^[\d.]+$/.test(host) && host !== match[1])
    )
      return invalid();
  }
  return url.origin;
}

function record(value: unknown, allowedKeys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const row = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(row).some(
      (key) => typeof key !== "string" || !allowedKeys.includes(key),
    )
  )
    return invalid();
  return row;
}

function classes(value: unknown): WebsiteRequestClassPermissions {
  if (value === undefined) return {};
  const row = record(value, WEBSITE_REQUEST_CLASSES);
  const result: WebsiteRequestClassPermissions = {};
  for (const key of Object.keys(row) as WebsiteRequestClass[]) {
    const setting = row[key];
    if (setting !== "inherit" && setting !== "allow" && setting !== "deny")
      return invalid();
    result[key] = setting;
  }
  return result;
}

export function normalizeWebsitePermissionApplicationDefaults(
  value: unknown,
): WebsitePermissionApplicationDefaults {
  const result = classes(value);
  if (Object.values(result).some((setting) => setting === "inherit"))
    return invalid();
  return result as WebsitePermissionApplicationDefaults;
}

function uniqueOrigins<T extends WebsiteDestinationPermissions>(
  rows: T[],
): T[] {
  if (new Set(rows.map((row) => row.origin)).size !== rows.length)
    return invalid();
  return rows;
}

/** Undefined means no saved rules. Corrupt/unknown policy is never reset silently. */
export function normalizeWebsiteDomainPermissions(
  value: unknown,
): WebsiteDomainPermissionsSettings {
  if (value === undefined) return { version: 1, websites: [] };
  const row = record(value, ["version", "websites"]);
  if (
    row.version !== 1 ||
    !Array.isArray(row.websites) ||
    row.websites.length > MAX_WEBSITE_PERMISSION_WEBSITES
  )
    return invalid();
  let totalDestinations = 0;
  const websites = Array.from(
    row.websites,
    (value): WebsiteOriginPermissions => {
      const website = record(value, [
        "origin",
        "requestClasses",
        "destinations",
      ]);
      const destinations =
        website.destinations === undefined ? [] : website.destinations;
      if (
        !Array.isArray(destinations) ||
        destinations.length > MAX_WEBSITE_PERMISSION_DESTINATIONS ||
        (totalDestinations += destinations.length) >
          MAX_WEBSITE_PERMISSION_TOTAL_DESTINATIONS
      )
        return invalid();
      return {
        origin: canonicalWebsitePermissionOrigin(website.origin),
        requestClasses: classes(website.requestClasses),
        destinations: uniqueOrigins(
          Array.from(destinations, (value) => {
            const destination = record(value, ["origin", "requestClasses"]);
            return {
              origin: canonicalWebsitePermissionOrigin(destination.origin),
              requestClasses: classes(destination.requestClasses),
            };
          }),
        ),
      };
    },
  );
  return { version: 1, websites: uniqueOrigins(websites) };
}

function resolve(
  query: Omit<WebsitePermissionQuery, "destinationOrigin"> & {
    destinationOrigin?: unknown;
  },
  classDefault: boolean,
): EffectiveWebsitePermission {
  if (query.nativeConstraint === "deny")
    return { decision: "deny", source: "native-constraint" };
  if (query.nativeConstraint !== undefined)
    return { decision: "deny", source: "invalid-policy" };
  let websiteOrigin: string;
  let destinationOrigin: string | undefined;
  if (
    !WEBSITE_REQUEST_CLASSES.includes(query.requestClass as WebsiteRequestClass)
  )
    return { decision: "deny", source: "invalid-request" };
  const requestClass = query.requestClass as WebsiteRequestClass;
  try {
    websiteOrigin = canonicalWebsitePermissionOrigin(query.websiteOrigin);
    if (!classDefault)
      destinationOrigin = canonicalWebsitePermissionOrigin(
        query.destinationOrigin,
      );
  } catch {
    return { decision: "deny", source: "invalid-request" };
  }
  try {
    // Validate both entire documents, including masked or currently unused rules.
    const shared = normalizeWebsiteDomainPermissions(query.sharedSettings);
    const connection = normalizeWebsiteDomainPermissions(
      query.connectionOverrides,
    );
    const defaults = normalizeWebsitePermissionApplicationDefaults(
      query.applicationDefaults,
    );
    const own = connection.websites.find((row) => row.origin === websiteOrigin);
    const common = shared.websites.find((row) => row.origin === websiteOrigin);
    const destination = (row: WebsiteOriginPermissions | undefined) =>
      row?.destinations.find((item) => item.origin === destinationOrigin)
        ?.requestClasses[requestClass];
    const candidates: [
      WebsitePermissionSetting | undefined,
      WebsitePermissionSource,
    ][] = [
      [destination(own), "connection-destination"],
      [own?.requestClasses[requestClass], "connection-class"],
      [destination(common), "shared-destination"],
      [common?.requestClasses[requestClass], "shared-class"],
      [defaults[requestClass] ?? "deny", "application-default"],
    ];
    for (const [decision, source] of candidates) {
      if (decision === "allow" || decision === "deny")
        return { decision, source };
    }
  } catch {
    return { decision: "deny", source: "invalid-policy" };
  }
  return { decision: "deny", source: "application-default" };
}

/** Public policy evaluation only; native route/safety enforcement is mandatory. */
export function resolveWebsiteRequestPermission(
  query: WebsitePermissionQuery,
): EffectiveWebsitePermission {
  return resolve(query, false);
}

/** Editor preview for classes; actual requests must resolve an exact destination. */
export function resolveWebsiteRequestClassDefault(
  query: Omit<WebsitePermissionQuery, "destinationOrigin">,
): EffectiveWebsitePermission {
  return resolve(query, true);
}
