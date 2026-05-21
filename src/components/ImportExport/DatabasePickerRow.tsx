/**
 * Shared row shell for the database pickers in Export, Import and
 * Clone. Renders a consistent lock-badge + (optional) inline
 * "Unlock…" button across all three tabs so the user can flip a
 * locked database to selectable without leaving the dialog.
 *
 * Each caller composes its own selection control (checkbox or
 * radio) into the `control` slot — the row only owns the layout +
 * lock affordances, not the picking semantics.
 */

import React from "react";
import { Lock } from "lucide-react";
import type { ExportDatabaseOption } from "./types";

export interface DatabasePickerRowProps {
  option: ExportDatabaseOption;

  /** Selection control (checkbox / radio) for this row. */
  control: React.ReactNode;

  /** Inline-unlock click handler. Only called for encrypted +
   *  not-yet-exportable rows. Returns a Promise so the row can
   *  optionally show a "working…" state during the prompt loop. */
  onUnlock?: (databaseId: string) => Promise<boolean> | void;

  /** Optional override for the description line under the name.
   *  When omitted, the row uses `lockedReason` for locked rows and
   *  the empty string for unlocked rows. */
  detail?: React.ReactNode;

  dataTestId?: string;

  /** Optional extra classes for the outer wrapper. */
  className?: string;
}

export const DatabasePickerRow: React.FC<DatabasePickerRowProps> = ({
  option,
  control,
  onUnlock,
  detail,
  dataTestId,
  className,
}) => {
  // "Unlockable" means: encrypted, not currently exportable (the
  // session hasn't remembered the password yet), and a handler is
  // wired. We don't show the button for non-encrypted-but-unwritable
  // rows (rare — typically a read-only file mode) because the user
  // can't fix those with a password.
  const showUnlock = Boolean(
    option.isEncrypted && !option.isExportable && onUnlock,
  );
  const detailNode =
    detail ??
    (option.isExportable
      ? null
      : option.lockedReason ?? "Encrypted database is locked.");

  return (
    <div
      data-testid={dataTestId}
      className={`flex items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
        option.isExportable ? "" : "opacity-70"
      } ${className ?? ""}`}
    >
      <div className="mt-0.5 shrink-0">{control}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <span className="truncate">{option.name}</span>
          {option.isCurrent && (
            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-normal text-primary">
              Current
            </span>
          )}
          {option.isEncrypted && (
            <span
              className={`inline-flex items-center gap-1 text-xs ${
                option.isExportable
                  ? "text-[var(--color-textMuted)]"
                  : "text-warning"
              }`}
              aria-label={option.isExportable ? "Unlocked" : "Locked"}
              title={option.isExportable ? "Unlocked" : "Locked"}
            >
              <Lock size={13} />
              {option.isExportable ? "Unlocked" : "Locked"}
            </span>
          )}
        </div>
        {detailNode && (
          <div className="mt-1 text-xs text-[var(--color-textSecondary)]">
            {detailNode}
          </div>
        )}
      </div>
      {showUnlock && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onUnlock?.(option.id);
          }}
          className="shrink-0 self-center rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning hover:bg-warning/20"
          data-testid={`database-picker-unlock-${option.id}`}
          aria-label={`Unlock "${option.name}"`}
        >
          Unlock…
        </button>
      )}
    </div>
  );
};
