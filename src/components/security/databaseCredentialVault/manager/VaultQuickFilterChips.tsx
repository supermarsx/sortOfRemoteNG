import {
  VAULT_QUICK_FILTERS,
  type VaultQuickFilter,
} from "../../../../utils/security/vaultManager/vaultQuickFilters";
import type { VaultTextKey, VaultTx } from "./vaultText";

const CHIP_LABELS: Record<VaultQuickFilter, VaultTextKey> = {
  assigned: "chipAssigned",
  unassigned: "chipUnassigned",
  recent: "chipRecent",
  stale: "chipStale",
  hasPassword: "chipHasPassword",
  hasTotp: "chipHasTotp",
  hasPrivateKey: "chipHasPrivateKey",
};

/** Mutually exclusive pairs: a row cannot be both. */
const EXCLUDES: Partial<Record<VaultQuickFilter, VaultQuickFilter>> = {
  assigned: "unassigned",
  unassigned: "assigned",
  recent: "stale",
  stale: "recent",
};

export function toggleQuickFilter(
  active: ReadonlySet<VaultQuickFilter>,
  filter: VaultQuickFilter,
): Set<VaultQuickFilter> {
  const next = new Set(active);
  if (next.has(filter)) next.delete(filter);
  else {
    next.add(filter);
    const other = EXCLUDES[filter];
    if (other) next.delete(other);
  }
  return next;
}

export function VaultQuickFilterChips({
  active,
  onToggle,
  tx,
}: {
  active: ReadonlySet<VaultQuickFilter>;
  onToggle: (filter: VaultQuickFilter) => void;
  tx: VaultTx;
}) {
  return (
    <div
      role="group"
      aria-label={tx("filtersLabel")}
      className="flex flex-wrap items-center gap-1.5"
    >
      {VAULT_QUICK_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          aria-pressed={active.has(filter)}
          className={`sor-option-chip text-xs ${active.has(filter) ? "sor-option-chip-active" : ""}`}
          onClick={() => onToggle(filter)}
        >
          {tx(CHIP_LABELS[filter])}
        </button>
      ))}
    </div>
  );
}
