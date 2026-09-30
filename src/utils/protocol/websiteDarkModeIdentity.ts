import type { Connection } from "../../types/connection/connection";
import { normalizeAdvancedProtocolConnection } from "../connection/normalizeAdvancedProtocolConnection";
import { normalizeHttpAutomation } from "../connection/sessionQuickActions";
import { stableJsonStringify } from "../core/stableJsonStringify";

/** Private identity: retain target/auth/policy fields; never expose this key. */
export function websiteDarkModeSourceIdentity(connection: Connection): string {
  const normalized = normalizeAdvancedProtocolConnection(connection);
  const source: Record<string, unknown> = { ...normalized };
  // Match the trust identity's presentation/bookkeeping exclusions, while
  // retaining the trusted destination list as part of this consent scope.
  // Optimistic metadata edits must not reset consent or a failed-save fence.
  for (const key of [
    "name",
    "httpBookmarks",
    "description",
    "tags",
    "order",
    "color",
    "icon",
    "expanded",
    "lastConnected",
    "connectionCount",
    "updatedAt",
    "lastAccessed",
    "lastUsed",
  ])
    delete source[key];
  const {
    forceDark: _enabled,
    darkMode: _theme,
    // Favorites are references for the bar, not consent to execute. The runner
    // checks the retained permission flags and resolves the exact library item.
    items: _favorites,
    ...automation
  } = normalizeHttpAutomation(normalized.httpAutomation);
  const timestamp = new Date(normalized.createdAt).getTime();
  return stableJsonStringify({
    ...source,
    createdAt: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : source.createdAt,
    httpAutomation: automation,
  });
}
