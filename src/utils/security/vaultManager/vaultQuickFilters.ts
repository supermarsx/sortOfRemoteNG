import type { CredentialInventoryViewMetadata } from "../../settings/credentialVaultView";

/** Presence/metadata-only chips. Weak, reused and expired checks are not
 * offered: they would need secret values or fields the vault does not store. */
export const VAULT_QUICK_FILTERS = [
  "assigned",
  "unassigned",
  "recent",
  "stale",
  "hasPassword",
  "hasTotp",
  "hasPrivateKey",
] as const;
export type VaultQuickFilter = (typeof VAULT_QUICK_FILTERS)[number];

export const RECENT_DAYS = 7;
export const STALE_DAYS = 180;
const DAY = 86_400_000;

export function quickFilterMatches(
  row: CredentialInventoryViewMetadata,
  filter: VaultQuickFilter,
  now: number,
): boolean {
  const updated = row.updatedAt === null ? NaN : Date.parse(row.updatedAt);
  switch (filter) {
    case "assigned":
      return row.assignment === "assigned";
    case "unassigned":
      return row.assignment === "unassigned";
    case "recent":
      return Number.isFinite(updated) && now - updated <= RECENT_DAYS * DAY;
    case "stale":
      return Number.isFinite(updated) && now - updated > STALE_DAYS * DAY;
    case "hasPassword":
      return row.types.includes("password");
    case "hasTotp":
      return row.types.includes("totp");
    case "hasPrivateKey":
      return row.types.includes("privateKey");
  }
}

/** Active chips combine with AND. */
export function quickFiltersMatch(
  row: CredentialInventoryViewMetadata,
  active: ReadonlySet<VaultQuickFilter>,
  now: number,
): boolean {
  for (const filter of active)
    if (!quickFilterMatches(row, filter, now)) return false;
  return true;
}

export interface VaultGroupCounts {
  all: number;
  vault: number;
  connections: number;
  unassigned: number;
  tags: { tag: string; count: number }[];
}

export function countVaultGroups(
  rows: readonly CredentialInventoryViewMetadata[],
): VaultGroupCounts {
  const tags = new Map<string, number>();
  let vault = 0,
    connections = 0,
    unassigned = 0;
  for (const row of rows) {
    if (row.source === "vault") vault += 1;
    else connections += 1;
    if (row.assignment === "unassigned") unassigned += 1;
    for (const tag of new Set(row.tags))
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return {
    all: rows.length,
    vault,
    connections,
    unassigned,
    tags: [...tags]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}
