import type { Connection } from "../../types/connection/connection";
import { stableJsonStringify } from "../core/stableJsonStringify";

/** Private comparison only: never log or persist this credential-bearing key.
 * Retain unknown fields so new authentication/route/trust options participate
 * automatically. Unlike website identities this has no HTTP normalization.
 */
export function tunnelSourceIdentity(
  connection: Connection | undefined,
): string {
  if (!connection) return stableJsonStringify(null);
  const source: Record<string, unknown> = { ...connection };
  for (const key of [
    "name",
    "description",
    "tags",
    "order",
    "color",
    "colorTag",
    "tabColor",
    "icon",
    "expanded",
    "favorite",
    "httpBookmarks",
    "focusOnConnect",
    "focusOnWinmgmtTool",
    "lastConnected",
    "connectionCount",
    "updatedAt",
    "lastAccessed",
    "lastUsed",
  ])
    delete source[key];
  // Keep creation identity (and invalid/missing values), but equate hydrated
  // Dates and persisted strings representing the same instant.
  const createdAt = source.createdAt;
  if (typeof createdAt === "string" || createdAt instanceof Date) {
    const timestamp = new Date(createdAt).getTime();
    if (Number.isFinite(timestamp))
      source.createdAt = new Date(timestamp).toISOString();
  }
  return stableJsonStringify(source);
}
