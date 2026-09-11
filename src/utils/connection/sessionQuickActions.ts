import {
  DEFAULT_SESSION_QUICK_ACTIONS,
  type HttpAutomationConfig,
  type QuickActionReference,
  type SessionQuickActionsSettings,
  type SshQuickActionsConfig,
} from "../../types/connection/sessionQuickActions";
import type { AutomationScope } from "../../types/recording/automationLibrary";
import { normalizeWebsiteDarkModeConfig } from "./websiteDarkMode";

export const MAX_QUICK_ACTION_ITEMS = 64;
export const MAX_QUICK_ACTION_ID_LENGTH = 128;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid session quick-action configuration.");
  return value as Record<string, unknown>;
}

export function quickActionReferenceScope(
  reference: Pick<QuickActionReference, "scope">,
): AutomationScope {
  if (reference.scope === undefined) return { kind: "app" };
  const scope = record(reference.scope);
  if (scope.kind === "app" && Object.keys(scope).length === 1)
    return { kind: "app" };
  if (
    scope.kind === "database" &&
    Object.keys(scope).length === 2 &&
    typeof scope.databaseId === "string" &&
    scope.databaseId.trim() &&
    scope.databaseId.length <= 128 &&
    !Array.from(scope.databaseId).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return { kind: "database", databaseId: scope.databaseId };
  throw new Error("Invalid quick-action library scope.");
}

export function quickActionReferenceKey(
  reference: QuickActionReference,
): string {
  const scope = quickActionReferenceScope(reference);
  return JSON.stringify([
    scope.kind,
    scope.kind === "database" ? scope.databaseId : "",
    reference.kind,
    reference.id,
  ]);
}

export function quickActionScopeLabel(
  reference: Pick<QuickActionReference, "scope">,
): string {
  return quickActionReferenceScope(reference).kind === "app"
    ? "App-wide"
    : "Database";
}

export function normalizeQuickActionReferences(
  value: unknown,
): QuickActionReference[] {
  if (!Array.isArray(value) || value.length > MAX_QUICK_ACTION_ITEMS)
    throw new Error("Quick actions require at most 64 ordered references.");
  const seen = new Set<string>();
  const result: QuickActionReference[] = [];
  for (const item of value) {
    const ref = record(item);
    if (
      (ref.kind !== "script" && ref.kind !== "macro") ||
      typeof ref.id !== "string" ||
      !ref.id.trim() ||
      ref.id.length > MAX_QUICK_ACTION_ID_LENGTH ||
      Array.from(ref.id).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      Object.keys(ref).some((key) => !["kind", "id", "scope"].includes(key))
    )
      throw new Error(
        "Invalid quick-action reference; store a script or macro ID only.",
      );
    const scope = quickActionReferenceScope(
      ref as unknown as QuickActionReference,
    );
    const normalized: QuickActionReference = {
      kind: ref.kind,
      id: ref.id,
      ...(scope.kind === "database" ? { scope } : {}),
    };
    const key = quickActionReferenceKey(normalized);
    if (!seen.has(key)) result.push(normalized);
    seen.add(key);
  }
  return result;
}

export function normalizeSshQuickActions(
  value: unknown,
): SshQuickActionsConfig {
  if (value === undefined) return { version: 1, items: [] };
  const config = record(value);
  if (
    config.version !== 1 ||
    Object.keys(config).some((key) => !["version", "items"].includes(key))
  )
    throw new Error("Unsupported SSH quick-action configuration.");
  return { version: 1, items: normalizeQuickActionReferences(config.items) };
}

export function normalizeHttpAutomation(value: unknown): HttpAutomationConfig {
  if (value === undefined)
    return {
      version: 1,
      items: [],
      interactionMacrosEnabled: false,
      scriptInjectionEnabled: false,
      forceDark: false,
    };
  const config = record(value);
  const booleans = [
    "interactionMacrosEnabled",
    "scriptInjectionEnabled",
    "forceDark",
  ] as const;
  if (
    config.version !== 1 ||
    booleans.some((key) => typeof config[key] !== "boolean") ||
    Object.keys(config).some(
      (key) => !["version", "items", "darkMode", ...booleans].includes(key),
    )
  )
    throw new Error(
      "Invalid HTTP automation consent; explicitly configure each capability.",
    );
  return {
    version: 1,
    items: normalizeQuickActionReferences(config.items),
    interactionMacrosEnabled: config.interactionMacrosEnabled === true,
    scriptInjectionEnabled: config.scriptInjectionEnabled === true,
    forceDark: config.forceDark === true,
    ...(config.darkMode !== undefined
      ? { darkMode: normalizeWebsiteDarkModeConfig(config.darkMode) }
      : {}),
  };
}

/** Older settings get defaults; malformed availability never enables execution. */
export function normalizeSessionQuickActions(
  value: unknown,
): SessionQuickActionsSettings {
  const defaults = { ...DEFAULT_SESSION_QUICK_ACTIONS };
  if (value === undefined) return defaults;
  const config =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  for (const key of Object.keys(defaults) as Array<
    keyof SessionQuickActionsSettings
  >)
    defaults[key] =
      key === "confirmBeforeScriptRun"
        ? config[key] !== false
        : config[key] === true;
  return defaults;
}

export function resolveHttpAutomationPermissions(
  global: unknown,
  connection: unknown,
) {
  const settings = normalizeSessionQuickActions(global);
  const config = normalizeHttpAutomation(connection);
  return {
    showActionBar: settings.httpEnabled,
    interactionMacrosEnabled:
      settings.allowWebMacros && config.interactionMacrosEnabled,
    scriptInjectionEnabled:
      settings.allowWebScriptInjection && config.scriptInjectionEnabled,
    forceDark: settings.allowWebForceDark && config.forceDark,
    confirmBeforeScriptRun: settings.confirmBeforeScriptRun,
  };
}
