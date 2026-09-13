import type { Connection } from "../../types/connection/connection";
import type { HttpProxyPolicy } from "../../types/connection/httpProxyPolicy";
import {
  isSynologyFileConnection,
  normalizeSynologySettings,
} from "../../types/protocols/synology";
import { normalizeHttpProxyPolicy } from "../connection/httpProxyPolicy";
import { httpRedirectConnectionOrigin } from "./httpRedirectTrustIdentity";
import type { StorageData } from "../storage/storage";

/** Native invocation only. Never place this context on a saved Connection. */
export interface SynologyQuickConnectDefaults {
  version: 1;
  originalOrigin: string;
}
export interface EffectiveHttpProxyPolicy extends HttpProxyPolicy {
  synologyQuickConnectDefaults?: SynologyQuickConnectDefaults;
}

const PORTALS = [
  "https://global.quickconnect.to",
  "https://www.quickconnect.to",
];
const RESERVED = new Set([
  "global",
  "www",
  "relay",
  "account",
  "api",
  "portal",
  "help",
  "support",
  "connect",
  "discovery",
]);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REGION = /^[a-z]{2}[0-9]{1,61}$/;
const invalid = (): never => {
  throw new Error("Invalid Synology QuickConnect redirect defaults.");
};
const quickConnectHost = (host: string) =>
  host === "quickconnect.to" || host.endsWith(".quickconnect.to");

/** Runtime provenance is already canonical; never silently reinterpret it. */
function originalUrl(value: unknown): URL {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\%@*?#]/u.test(value)
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value ||
    !url.hostname ||
    url.hostname.endsWith(".") ||
    url.username ||
    url.password ||
    url.port === "0"
  )
    return invalid();
  if (
    !url.hostname.startsWith("[") &&
    (url.hostname.length > 253 ||
      !url.hostname.split(".").every((label) => LABEL.test(label)))
  )
    return invalid();
  if (quickConnectHost(url.hostname) && url.port) return invalid();
  return url;
}

/** Match native http_synology_redirect_defaults.rs: only the original alias,
 * optionally followed by a known-shape region, can imply its HTTP portal. */
export function synologyDefaultRedirectOrigins(
  originalOrigin: string,
): string[] {
  const url = originalUrl(originalOrigin);
  const result = [...PORTALS];
  if (url.hostname.endsWith(".quickconnect.to")) {
    const labels = url.hostname.slice(0, -".quickconnect.to".length).split(".");
    if (
      (labels.length === 1 ||
        (labels.length === 2 && REGION.test(labels[1]))) &&
      !RESERVED.has(labels[0])
    ) {
      result.unshift(
        `http://${labels[0]}.quickconnect.to`,
        `https://${labels[0]}.quickconnect.to`,
      );
    }
  }
  return result;
}

/** User-enabled same-NAS direct namespace: one optional DNS label, HTTPS only,
 * explicit DSM ports. This never grants background RPC or TLS exceptions. */
export function isSynologyDefaultRedirectOrigin(
  originalOrigin: string,
  candidateOrigin: string,
): boolean {
  try {
    const origins = synologyDefaultRedirectOrigins(originalOrigin);
    if (origins.includes(candidateOrigin)) return true;
    const alias = origins[0]?.match(
      /^http:\/\/([a-z0-9-]+)\.quickconnect\.to$/,
    )?.[1];
    if (!alias) return false;
    const candidate = new URL(candidateOrigin);
    if (
      candidate.origin !== candidateOrigin ||
      candidate.protocol !== "https:" ||
      !["5001", "5002"].includes(candidate.port)
    )
      return false;
    const suffix = `${alias}.direct.quickconnect.to`;
    return (
      candidate.hostname === suffix ||
      (candidate.hostname.endsWith(`.${suffix}`) &&
        LABEL.test(candidate.hostname.slice(0, -(suffix.length + 1))))
    );
  } catch {
    return false;
  }
}

function contextValue(value: unknown): SynologyQuickConnectDefaults {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const prototype = Object.getPrototypeOf(value);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(value).length !== 2 ||
    !fields.version ||
    !("value" in fields.version) ||
    fields.version.value !== 1 ||
    !fields.originalOrigin ||
    !("value" in fields.originalOrigin)
  )
    return invalid();
  const originalOrigin = originalUrl(fields.originalOrigin.value).origin;
  return { version: 1, originalOrigin };
}

export function synologyRedirectDefaultsForConnection(
  connection: Partial<Connection>,
): SynologyQuickConnectDefaults | undefined {
  if (
    connection.isGroup ||
    !["http", "https"].includes(connection.protocol ?? "") ||
    isSynologyFileConnection(connection)
  )
    return undefined;
  const settings = normalizeSynologySettings(connection.synologySettings);
  if (settings.useDefaultRedirectDestinations === false) return undefined;
  if (connection.httpApplication?.invalid) return invalid();
  let originalOrigin: string;
  let url: URL;
  try {
    originalOrigin = httpRedirectConnectionOrigin(connection as Connection);
    url = originalUrl(originalOrigin);
  } catch {
    // Unsupported default authority never prevents ordinary reviewed browsing.
    // Explicit runtime contexts still use the strict validator above.
    return undefined;
  }
  if (
    connection.httpApplication?.id !== "synology-dsm" &&
    !quickConnectHost(url.hostname)
  )
    return undefined;
  return { version: 1, originalOrigin };
}

/** Build a separate native wire value; the saved policy validator stays strict. */
export function withSynologyRedirectDefaults(
  policy: HttpProxyPolicy,
  context?: SynologyQuickConnectDefaults,
): EffectiveHttpProxyPolicy {
  const normalized = normalizeHttpProxyPolicy(policy);
  return context === undefined
    ? normalized
    : { ...normalized, synologyQuickConnectDefaults: contextValue(context) };
}

/** Exact destination-origin consent only, never an authentication or TLS grant. */
export function isSynologyDefaultRedirect(
  policy: EffectiveHttpProxyPolicy | undefined,
  sourceOrigin: string,
  destinationUrl: string,
): boolean {
  try {
    if (!policy?.synologyQuickConnectDefaults) return false;
    const context = contextValue(policy.synologyQuickConnectDefaults);
    const savedPolicy = { ...policy };
    delete savedPolicy.synologyQuickConnectDefaults;
    const normalized = normalizeHttpProxyPolicy(savedPolicy);
    const source = new URL(sourceOrigin).origin;
    if (
      source !== sourceOrigin ||
      (source !== context.originalOrigin &&
        !isSynologyDefaultRedirectOrigin(context.originalOrigin, source))
    )
      return false;
    if (
      typeof destinationUrl !== "string" ||
      destinationUrl.length > 4096 ||
      /[\s\\]/u.test(destinationUrl)
    )
      return false;
    const destination = new URL(destinationUrl);
    const authority = destinationUrl.match(/^https?:\/\/([^/?#]*)/u)?.[1];
    if (
      !authority ||
      /[@%*]/u.test(authority) ||
      destination.username ||
      destination.password ||
      destination.port === "0" ||
      destination.search ||
      destination.hash ||
      destination.toString() !== destinationUrl
    )
      return false;
    return (
      !(normalized.httpsOnly && destination.protocol === "http:") &&
      isSynologyDefaultRedirectOrigin(
        context.originalOrigin,
        destination.origin,
      )
    );
  } catch {
    return false;
  }
}

/** Exact defensive boundary for forged/imported runtime fields. Preserve all
 * other values so malformed saved policy still fails its normal validator. */
export function stripSynologyRedirectRuntimeContext<
  T extends Partial<Connection>,
>(connection: T): T {
  const copy = { ...connection };
  delete (copy as Record<string, unknown>).synologyQuickConnectDefaults;
  const policy = copy.httpProxyPolicy;
  if (
    policy &&
    typeof policy === "object" &&
    !Array.isArray(policy) &&
    Object.prototype.hasOwnProperty.call(policy, "synologyQuickConnectDefaults")
  ) {
    const clean = { ...policy } as HttpProxyPolicy & {
      synologyQuickConnectDefaults?: unknown;
    };
    delete clean.synologyQuickConnectDefaults;
    copy.httpProxyPolicy = clean;
  }
  return copy;
}

/** Last-mile reject-only guard. Never alter caller data or its content-CAS
 * identity; ordinary connection normalization strips this transient field. */
export function assertNoSynologyRedirectRuntimeContext(
  data: StorageData,
): void {
  const check = (connection: Connection) => {
    if (
      Object.prototype.hasOwnProperty.call(
        connection,
        "synologyQuickConnectDefaults",
      ) ||
      (connection.httpProxyPolicy &&
        Object.prototype.hasOwnProperty.call(
          connection.httpProxyPolicy,
          "synologyQuickConnectDefaults",
        ))
    ) {
      throw new Error(
        "Runtime redirect context cannot be saved. Reload the connection and retry.",
      );
    }
  };
  data.connections.forEach(check);
  data.recycleBin?.entries.forEach((entry) => check(entry.connection));
}
