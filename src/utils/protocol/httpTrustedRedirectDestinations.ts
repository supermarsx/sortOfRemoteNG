import type { HttpTrustedRedirectDestinations } from "../../types/connection/httpTrustedRedirectDestinations";
import type { Connection } from "../../types/connection/connection";

/** Local redirect consent must never travel with an imported/exported/copied connection. */
export function stripHttpTrustedRedirectDestinations(
  connection: Connection,
): Connection {
  const copy = { ...connection };
  delete copy.httpTrustedRedirectDestinations;
  return copy;
}

export const MAX_TRUSTED_REDIRECT_DESTINATIONS = 32;
export const MAX_TRUSTED_REDIRECT_ORIGIN_LENGTH = 2048;
const hasAsciiControl = (value: string): boolean =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const invalid = (): never => {
  // Imported values can contain secrets. Never echo them in diagnostics.
  throw new Error(
    "Invalid trusted redirect destinations. Use up to 32 unique HTTP(S) origins without credentials, paths, query parameters, fragments or wildcards.",
  );
};

/** User-entered origin only; canonicalize host casing and default ports. */
export function normalizeHttpRedirectOrigin(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_TRUSTED_REDIRECT_ORIGIN_LENGTH ||
    /[\s\\%*?#]/u.test(value) ||
    !/^https?:\/\//iu.test(value)
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  // Inspect the original suffix too: URL() would normalize /a/.. into /.
  const authority = value.slice(value.indexOf("://") + 3);
  const slash = authority.indexOf("/");
  if (
    (slash >= 0 && authority.slice(slash) !== "/") ||
    hasAsciiControl(value) ||
    authority.includes("@") ||
    url.username ||
    url.password ||
    !url.hostname ||
    url.hostname.startsWith(".") ||
    url.hostname.endsWith(".") ||
    url.port === "0" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin === "null" ||
    url.origin.length > MAX_TRUSTED_REDIRECT_ORIGIN_LENGTH
  )
    return invalid();
  return url.origin;
}

/** Missing is empty. Malformed present data must not become trusted. */
export function normalizeHttpTrustedRedirectDestinations(
  value: unknown,
): HttpTrustedRedirectDestinations {
  if (value === undefined)
    return { version: 1, origins: [], autoContinue: false };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const prototype = Object.getPrototypeOf(value);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== "string" ||
        !["version", "origins", "autoContinue"].includes(key),
    ) ||
    (fields.autoContinue &&
      (!("value" in fields.autoContinue) ||
        typeof fields.autoContinue.value !== "boolean")) ||
    !fields.version ||
    !fields.origins ||
    !("value" in fields.version) ||
    !("value" in fields.origins) ||
    fields.version.value !== 1 ||
    !Array.isArray(fields.origins.value) ||
    fields.origins.value.length > MAX_TRUSTED_REDIRECT_DESTINATIONS
  )
    return invalid();
  const origins: string[] = [];
  for (const input of fields.origins.value) {
    const origin = normalizeHttpRedirectOrigin(input);
    if (origins.includes(origin)) return invalid();
    origins.push(origin);
  }
  return {
    version: 1,
    origins,
    autoContinue: fields.autoContinue?.value ?? false,
  };
}

/** Exact origin membership only. Does not authorize TLS, HTTP or auth changes. */
export function isTrustedHttpRedirectDestination(
  value: unknown,
  destination: string,
): boolean {
  try {
    const settings = normalizeHttpTrustedRedirectDestinations(value);
    if (
      typeof destination !== "string" ||
      destination.length > 4096 ||
      hasAsciiControl(destination) ||
      /[\s\\]/u.test(destination)
    )
      return false;
    const url = new URL(destination);
    const authority = destination.match(/^https?:\/\/([^/?#]*)/iu)?.[1];
    if (
      !authority ||
      /[@%*]/u.test(authority) ||
      url.username ||
      url.password ||
      url.port === "0"
    )
      return false;
    const origin = normalizeHttpRedirectOrigin(url.origin);
    return settings.origins.includes(origin);
  } catch {
    return false;
  }
}
