import { CheckSquare, Copy, X } from "lucide-react";
import { Checkbox } from "../ui/forms";

/** Shared selection controls for application and action log timelines. */
export function LogSelectionToolbar({
  selecting,
  selectedCount,
  allSelected,
  disabled = false,
  onToggleMode,
  onSelectAll,
  onClear,
  onCopy,
}: {
  selecting: boolean;
  selectedCount: number;
  allSelected: boolean;
  disabled?: boolean;
  onToggleMode: () => void;
  onSelectAll: (checked: boolean) => void;
  onClear: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button
        type="button"
        aria-pressed={selecting}
        onClick={onToggleMode}
        disabled={disabled && !selecting}
        className="sor-option-chip text-xs disabled:opacity-40"
      >
        {selecting ? (
          <X size={14} aria-hidden="true" />
        ) : (
          <CheckSquare size={14} aria-hidden="true" />
        )}
        {selecting ? "Done selecting" : "Select logs"}
      </button>
      {selecting && (
        <>
          <label className="flex items-center gap-2 text-[var(--color-textSecondary)]">
            <Checkbox
              checked={allSelected}
              onChange={onSelectAll}
              disabled={disabled}
            />
            Select all filtered logs
          </label>
          <span
            role="status"
            className="tabular-nums text-[var(--color-textMuted)]"
          >
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled || !selectedCount}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            <Copy size={14} aria-hidden="true" />
            Copy selected ({selectedCount})
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!selectedCount}
            className="sor-option-chip text-xs disabled:opacity-40"
          >
            Clear selection
          </button>
        </>
      )}
    </div>
  );
}
