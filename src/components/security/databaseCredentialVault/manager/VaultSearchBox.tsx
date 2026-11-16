import { useId, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PopoverSurface } from "../../../ui/overlays/PopoverSurface";
import {
  VAULT_SEARCH_SCOPES,
  type VaultSearchOptions,
  type VaultSearchScope,
} from "../../../../utils/security/vaultManager/vaultSearch";
import type { VaultTextKey, VaultTx } from "./vaultText";

const SCOPE_LABELS: Record<VaultSearchScope, VaultTextKey> = {
  name: "searchInName",
  tags: "searchInTags",
  types: "searchInTypes",
  assignments: "searchInAssignments",
};

export interface VaultSearchState extends VaultSearchOptions {
  allGroups: boolean;
}

export function VaultSearchBox({
  value,
  onChange,
  invalid,
  inputRef,
  tx,
}: {
  value: VaultSearchState;
  onChange: (next: VaultSearchState) => void;
  invalid: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  tx: VaultTx;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const patch = (next: Partial<VaultSearchState>) =>
    onChange({ ...value, ...next });
  const toggleScope = (scope: VaultSearchScope) => {
    const has = value.scopes.includes(scope);
    // At least one scope must stay on, otherwise nothing could ever match.
    if (has && value.scopes.length === 1) return;
    patch({
      scopes: has
        ? value.scopes.filter((item) => item !== scope)
        : [...value.scopes, scope],
    });
  };
  return (
    <div className="flex min-w-[10rem] max-w-md flex-1 items-center gap-1">
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 rounded border bg-[var(--color-background)] px-2 focus-within:border-primary ${invalid ? "border-error" : "border-[var(--color-border)]"}`}
      >
        <Search size={14} aria-hidden="true" className="shrink-0 opacity-70" />
        <input
          ref={inputRef}
          type="search"
          aria-label={tx("searchLabel")}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          value={value.query}
          placeholder={tx("searchPlaceholder")}
          onChange={(event) => patch({ query: event.target.value })}
        />
        {value.query && (
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label={tx("clearSearch")}
            data-tooltip={tx("clearSearch")}
            onClick={() => {
              patch({ query: "" });
              inputRef.current?.focus();
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      <button
        ref={anchor}
        type="button"
        className="sor-icon-btn"
        aria-label={tx("searchOptions")}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={tx("searchOptions")}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      {invalid && (
        <span id={errorId} role="alert" className="sr-only">
          {tx("searchInvalidRegex")}
        </span>
      )}
      <PopoverSurface
        isOpen={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        align="start"
        className="w-60 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs shadow-xl"
      >
        <div
          role="group"
          aria-label={tx("searchOptions")}
          className="space-y-1.5"
        >
          {VAULT_SEARCH_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {tx(SCOPE_LABELS[scope])}
            </label>
          ))}
          <hr className="border-[var(--color-border)]" />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.caseSensitive}
              onChange={(e) => patch({ caseSensitive: e.target.checked })}
            />
            {tx("searchMatchCase")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.regex}
              onChange={(e) => patch({ regex: e.target.checked })}
            />
            {tx("searchRegex")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.allGroups}
              onChange={(e) => patch({ allGroups: e.target.checked })}
            />
            {tx("searchAllGroups")}
          </label>
        </div>
      </PopoverSurface>
    </div>
  );
}
