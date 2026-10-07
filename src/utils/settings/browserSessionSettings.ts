import schema from "../../types/settings/browserSession.schema.json";
import type {
  BrowserSessionIdentity,
  BrowserSessionOverrides,
  BrowserSessionRetention,
  BrowserSessionRetentionCapabilities,
  EffectiveBrowserSessionRetention,
} from "../../types/settings/browserSession";
import type { WebBrowserSettingsConfig } from "../../types/settings/webBrowser";
import { normalizeWebBrowserSettings } from "./webBrowserSettings";
import { MAX_BROWSER_FORM_COMBINED_DELAY_MS } from "../connection/httpFormAutomation";

export const DEFAULT_BROWSER_SESSION_RETENTION: Readonly<BrowserSessionRetention> =
  Object.freeze({
    version: 1,
    mode: "ephemeral",
    idleTimeoutMinutes:
      schema.$defs.retention.properties.idleTimeoutMinutes.default,
    maxAgeHours: schema.$defs.retention.properties.maxAgeHours.default,
    clearOnDatabaseLock: false,
  });

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

/** Missing policy defaults to ephemeral; a supplied policy must be complete.
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

/** Do not materialize inherited values into saved connection records. */
export function normalizeBrowserSessionOverrides(
  value: unknown,
): BrowserSessionOverrides | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  if (row.version !== 1) return invalid();
  const result: Record<string, unknown> = { version: 1 };
  for (const [key, item] of Object.entries(row)) {
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
): WebBrowserSettingsConfig & { sessionRetention: BrowserSessionRetention } {
  const defaults = normalizeWebBrowserSettings(globalSettings);
  const connection = normalizeBrowserSessionOverrides(overrides);
  // Revalidate after inheritance, especially the combined autofill delay budget.
  const merged = normalizeWebBrowserSettings({ ...defaults, ...connection });
  return {
    ...merged,
    sessionRetention: normalizeBrowserSessionRetention(merged.sessionRetention),
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
        : { ...DEFAULT_BROWSER_SESSION_RETENTION },
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
