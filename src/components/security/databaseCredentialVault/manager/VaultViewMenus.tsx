import { useRef, useState } from "react";
import { ArrowUpDown, Columns3, Check } from "lucide-react";
import { PopoverSurface } from "../../../ui/overlays/PopoverSurface";
import {
  VAULT_COLUMNS,
  type CredentialInventorySort,
  type CredentialVaultView,
  type VaultColumn,
} from "../../../../utils/settings/credentialVaultView";
import type { VaultTextKey, VaultTx } from "./vaultText";

const SORTS: [CredentialInventorySort, VaultTextKey][] = [
  ["name", "sortName"],
  ["source", "sortSource"],
  ["updated", "sortUpdated"],
];
const PANEL =
  "w-52 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-xs shadow-xl";
const ITEM =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--color-surfaceHover)]";

export function VaultSortMenu({
  sort,
  direction,
  onSort,
  onDirection,
  tx,
}: {
  sort: CredentialInventorySort;
  direction: "asc" | "desc";
  onSort: (key: CredentialInventorySort) => void;
  onDirection: (direction: "asc" | "desc") => void;
  tx: VaultTx;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="sor-icon-btn"
        aria-label={tx("sortMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={tx("sortMenu")}
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpDown size={16} aria-hidden="true" />
      </button>
      <PopoverSurface
        isOpen={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        className={PANEL}
      >
        <div role="menu" aria-label={tx("sortBy")}>
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={sort === key}
              className={ITEM}
              onClick={() => onSort(key)}
            >
              <span className="w-3">
                {sort === key && <Check size={12} aria-hidden="true" />}
              </span>
              {tx(label)}
            </button>
          ))}
          <hr className="my-1 border-[var(--color-border)]" />
          {(["asc", "desc"] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              role="menuitemradio"
              aria-checked={direction === dir}
              className={ITEM}
              onClick={() => onDirection(dir)}
            >
              <span className="w-3">
                {direction === dir && <Check size={12} aria-hidden="true" />}
              </span>
              {tx(dir === "asc" ? "sortAscending" : "sortDescending")}
            </button>
          ))}
        </div>
      </PopoverSurface>
    </>
  );
}

export type VaultDensity = "compact" | "comfortable";

export function VaultViewMenu({
  view,
  density,
  canPersist,
  onColumns,
  onMode,
  onDensity,
  tx,
}: {
  view: CredentialVaultView;
  density: VaultDensity;
  /** Column and mode choices are saved to settings; without them they are inert. */
  canPersist: boolean;
  onColumns: (columns: VaultColumn[]) => void;
  onMode: (mode: CredentialVaultView["mode"]) => void;
  onDensity: (density: VaultDensity) => void;
  tx: VaultTx;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const toggle = (id: VaultColumn) => {
    const next = view.columns.includes(id)
      ? view.columns.filter((column) => column !== id)
      : VAULT_COLUMNS.map((c) => c.id).filter(
          (column) => column === id || view.columns.includes(column),
        );
    onColumns(next);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="sor-icon-btn"
        aria-label={tx("viewMenu")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={tx("viewMenu")}
        onClick={() => setOpen((v) => !v)}
      >
        <Columns3 size={16} aria-hidden="true" />
      </button>
      <PopoverSurface
        isOpen={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        className={PANEL}
      >
        <div role="group" aria-label={tx("viewMenu")} className="space-y-2 p-1">
          <fieldset>
            <legend className="mb-1 text-[var(--color-textSecondary)]">
              {tx("viewColumns")}
            </legend>
            {VAULT_COLUMNS.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={view.columns.includes(id)}
                  disabled={!canPersist || id === "name" || id === "actions"}
                  onChange={() => toggle(id)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[var(--color-textSecondary)]">
              {tx("viewDensity")}
            </legend>
            {(["compact", "comfortable"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 py-0.5">
                <input
                  type="radio"
                  name="vault-density"
                  checked={density === value}
                  onChange={() => onDensity(value)}
                />
                {tx(
                  value === "compact" ? "densityCompact" : "densityComfortable",
                )}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[var(--color-textSecondary)]">
              {tx("viewPaging")}
            </legend>
            {(["paged", "infinite"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 py-0.5">
                <input
                  type="radio"
                  name="vault-paging"
                  disabled={!canPersist}
                  checked={view.mode === value}
                  onChange={() => onMode(value)}
                />
                {tx(value === "paged" ? "pagingPaged" : "pagingInfinite")}
              </label>
            ))}
          </fieldset>
        </div>
      </PopoverSurface>
    </>
  );
}
