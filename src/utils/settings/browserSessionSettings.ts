import schema from "../../types/settings/browserSession.schema.json";
import type {
  BrowserHttpCacheOverride,
  BrowserHttpCacheSettings,
  BrowserSessionIdentity,
  BrowserSessionOverrides,
  BrowserSessionRetention,
  BrowserSessionRetentionCapabilities,
  BrowserTlsInterception,
  EffectiveBrowserSessionRetention,
} from "../../types/settings/browserSession";
import type { WebBrowserSettingsConfig } from "../../types/settings/webBrowser";
import { normalizeWebBrowserSettings } from "./webBrowserSettings";
import { MAX_BROWSER_FORM_COMBINED_DELAY_MS } from "../connection/httpFormAutomation";

export const DEFAULT_BROWSER_SESSION_RETENTION: Readonly<BrowserSessionRetention> =
  Object.freeze({
    version: 1,
    mode: schema.$defs.retention.properties.mode
      .default as BrowserSessionRetention["mode"],
    idleTimeoutMinutes:
      schema.$defs.retention.properties.idleTimeoutMinutes.default,
    maxAgeHours: schema.$defs.retention.properties.maxAgeHours.default,
    clearOnDatabaseLock:
      schema.$defs.retention.properties.clearOnDatabaseLock.default,
  });

const httpCacheRules = schema.$defs.httpCache.properties;

/** Global page-cache defaults, read from the schema (the single source of defaults and ranges). */
export const DEFAULT_BROWSER_HTTP_CACHE: Readonly<BrowserHttpCacheSettings> =
  Object.freeze({
    enabled: httpCacheRules.enabled.default,
    perConnectionMb: httpCacheRules.perConnectionMb.default,
    totalMb: httpCacheRules.totalMb.default,
    clearOnDatabaseLock: httpCacheRules.clearOnDatabaseLock.default,
  });

/** Default HTTPS handling, read from the schema: the app inspects HTTPS. */
export const DEFAULT_BROWSER_TLS_INTERCEPTION = schema.$defs.tlsInterception
  .default as BrowserTlsInterception;

/** Missing uses the schema default; anything but "auto" or "off" is rejected. */
export function normalizeBrowserTlsInterception(
  value: unknown,
): BrowserTlsInterception {
  if (value === undefined) return DEFAULT_BROWSER_TLS_INTERCEPTION;
  if (!validate(value, schema.$defs.tlsInterception)) return invalid();
  return value as BrowserTlsInterception;
}

/** Effective policy when retention is unsupported or disabled: never retains cookies. */
const ephemeralFallback = (
  requested: BrowserSessionRetention,
): BrowserSessionRetention => ({ ...requested, mode: "ephemeral" });

const invalid = (): never => {
  throw new Error(
    "Invalid browser session settings. Review overrides and retention before connecting.",
  );
};

type Rule = {
  type?: string;
  minimum?: number;
  maximum?: number;
  const?: number;
  enum?: string[];
};
function validate(value: unknown, rule: Rule): boolean {
  if (rule.const !== undefined) return value === rule.const;
  if (rule.enum) return typeof value === "string" && rule.enum.includes(value);
  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "integer")
    return (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= rule.minimum! &&
      value <= rule.maximum!
    );
  return false;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

/** Missing policy uses the schema default (encrypted database, 7-day idle / 30-day max);
 * a supplied policy must be complete. Unsupported runtimes resolve it to ephemeral.
 * The legacy mode alias migrates configuration only, never cookie payloads.
 */
export function normalizeBrowserSessionRetention(
  value: unknown,
): BrowserSessionRetention {
  if (value === undefined) return { ...DEFAULT_BROWSER_SESSION_RETENTION };
  const row = record(value);
  const properties = schema.$defs.retention.properties;
  if (
    Object.keys(row).some(
      (key) => !Object.prototype.hasOwnProperty.call(properties, key),
    ) ||
    Object.entries(properties).some(([key, rule]) => !validate(row[key], rule))
  )
    return invalid();
  return {
    version: 1,
    mode: row.mode === "encrypted-local" ? "encrypted-database" : row.mode,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    maxAgeHours: row.maxAgeHours,
    clearOnDatabaseLock: row.clearOnDatabaseLock,
  } as BrowserSessionRetention;
}

/** Missing fields inherit the schema defaults; malformed values are rejected, never coerced. */
export function normalizeBrowserHttpCacheSettings(
  value: unknown,
): BrowserHttpCacheSettings {
  if (value === undefined) return { ...DEFAULT_BROWSER_HTTP_CACHE };
  const row = record(value);
  const result: Record<string, unknown> = { ...DEFAULT_BROWSER_HTTP_CACHE };
  for (const [key, item] of Object.entries(row)) {
    if (!Object.prototype.hasOwnProperty.call(httpCacheRules, key))
      return invalid();
    if (!validate(item, httpCacheRules[key as keyof typeof httpCacheRules]))
      return invalid();
    result[key] = item;
  }
  return result as unknown as BrowserHttpCacheSettings;
}

/** Sparse per-connection override; an empty override is dropped by the caller. */
export function normalizeBrowserHttpCacheOverride(
  value: unknown,
): BrowserHttpCacheOverride {
  const row = record(value);
  const result: BrowserHttpCacheOverride = {};
  for (const [key, item] of Object.entries(row)) {
    if (key === "enabled" && validate(item, httpCacheRules.enabled))
      result.enabled = item as boolean;
    else if (
      key === "perConnectionMb" &&
      validate(item, httpCacheRules.perConnectionMb)
    )
      result.perConnectionMb = item as number;
    else return invalid();
  }
  return result;
}

/** Do not materialize inherited values into saved connection records. */
export function normalizeBrowserSessionOverrides(
  value: unknown,
): BrowserSessionOverrides | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  if (row.version !== 1) return invalid();
  const result: Record<string, unknown> = { version: 1 };
  for (const [key, item] of Object.entries(row)) {
    // Validated against $defs.httpCacheOverride; not yet a top-level schema property.
    if (key === "httpCache") {
      const cache = normalizeBrowserHttpCacheOverride(item);
      if (Object.keys(cache).length) result[key] = cache;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(schema.properties, key))
      return invalid();
    if (key === "sessionRetention") {
      if (item === undefined) return invalid();
      result[key] = normalizeBrowserSessionRetention(item);
    } else {
      if (
        !validate(
          item,
          schema.properties[key as keyof typeof schema.properties] as Rule,
        )
      )
        return invalid();
      result[key] = item;
    }
  }
  if (
    Number(result.minimumFormFillDelayMs ?? 0) +
      Number(result.minimumFormSubmitDelayMs ?? 0) >
    MAX_BROWSER_FORM_COMBINED_DELAY_MS
  )
    return invalid();
  return result as BrowserSessionOverrides;
}

/** Connection overrides affect preferences only. Policies and login consent are untouched. */
export function resolveConnectionBrowserSettings(
  globalSettings: unknown,
  overrides: unknown,
): WebBrowserSettingsConfig & {
  sessionRetention: BrowserSessionRetention;
  httpCache: BrowserHttpCacheSettings;
  tlsInterception: BrowserTlsInterception;
} {
  const defaults = normalizeWebBrowserSettings(globalSettings);
  const connection = normalizeBrowserSessionOverrides(overrides);
  // Revalidate after inheritance, especially the combined autofill delay budget.
  // The cache override is sparse: missing fields inherit the global cache settings.
  const merged = normalizeWebBrowserSettings({
    ...defaults,
    ...connection,
    httpCache: { ...defaults.httpCache, ...connection?.httpCache },
  });
  return {
    ...merged,
    sessionRetention: normalizeBrowserSessionRetention(merged.sessionRetention),
    httpCache: normalizeBrowserHttpCacheSettings(merged.httpCache),
    tlsInterception: normalizeBrowserTlsInterception(merged.tlsInterception),
  };
}

/** Native capabilities must be positively established; absent capability means ephemeral. */
export function resolveBrowserSessionRetention(
  value: unknown,
  capabilities: BrowserSessionRetentionCapabilities = {
    memory: false,
    encryptedDatabase: false,
  },
): EffectiveBrowserSessionRetention {
  const requested = normalizeBrowserSessionRetention(value);
  const supported =
    requested.mode === "ephemeral" ||
    (requested.mode === "memory" && capabilities.memory === true) ||
    (requested.mode === "encrypted-database" &&
      capabilities.encryptedDatabase === true);
  const disabledByExpiry =
    requested.mode !== "ephemeral" && requested.idleTimeoutMinutes === 0;
  return {
    requested,
    effective:
      supported && !disabledByExpiry
        ? { ...requested }
        : ephemeralFallback(requested),
    supported,
    ...(!supported
      ? {
          reason: `Requested ${requested.mode} retention is unavailable. This attempt uses ephemeral storage and is cleared when closed.`,
        }
      : disabledByExpiry
        ? {
            reason:
              "Cookie retention is disabled by zero idle expiry. This attempt uses ephemeral storage.",
          }
        : {}),
  };
}

/** Collision-free logical identity, never a filesystem path or a native authorization token. */
export function browserSessionIsolationKey(
  identity: BrowserSessionIdentity,
): string {
  const fields = [
    identity.owningDatabaseId,
    identity.connectionId,
    identity.attemptId,
  ];
  if (fields.some((field) => typeof field !== "string" || !field.trim()))
    return invalid();
  return JSON.stringify(fields);
}
