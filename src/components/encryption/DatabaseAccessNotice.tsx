import { useState } from "react";
import { ChevronDown, ChevronUp, LockKeyhole, RefreshCw } from "lucide-react";
import type { DatabaseAccessSuspension } from "../../hooks/settings/useDatabaseAccessSuspension";
import { ManagedDatabaseUnlockForm } from "./ManagedDatabaseUnlockForm";

/** Database access is scoped: losing it must not lock the application shell. */
export function DatabaseAccessNotice({
  access,
  globallyLocked,
}: {
  access: DatabaseAccessSuspension;
  globallyLocked: boolean;
}) {
  if (globallyLocked || !access.suspended) return null;
  return (
    <LockedDatabaseNotice
      key={`${access.suspended.databaseId}:${access.suspended.access.accessEpoch}:${access.suspended.access.securityRevision}`}
      access={access}
    />
  );
}

function LockedDatabaseNotice({
  access,
}: {
  access: DatabaseAccessSuspension;
}) {
  const [expanded, setExpanded] = useState(false);
  const target = access.suspended;
  if (!target) return null;
  return (
    <div
      data-testid="database-access-notice"
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <LockKeyhole
          className="h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <p role="status" className="min-w-0 flex-1 break-words">
          <span className="font-medium">{target.name} — Database locked.</span>{" "}
          Database tools require unlocking; other tabs remain available.
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="database-unlock-details"
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded) void access.inspect();
          }}
          className="sor-btn sor-btn-ghost inline-flex shrink-0 items-center gap-1 text-xs"
        >
          {expanded ? "Hide unlock options" : "Unlock…"}
          {expanded ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </button>
      </div>
      {expanded && (
        <div
          id="database-unlock-details"
          className="max-h-[40vh] max-w-lg space-y-3 overflow-y-auto px-3 pb-3"
        >
          <p className="text-xs text-[var(--color-textMuted)]">
            {target.access.reason === "expired"
              ? "The database access session expired. Unlock it when you want to resume database work."
              : "The database was locked or its protection changed. Unlock it when you want to resume database work."}
          </p>
          {access.loading && (
            <p role="status" className="text-sm">
              Inspecting database unlock methods…
            </p>
          )}
          {access.error && (
            <p role="alert" className="text-sm text-error">
              {access.error}
            </p>
          )}
          {access.status && (
            <ManagedDatabaseUnlockForm
              key={`${target.databaseId}:${target.access.accessEpoch}:${access.status.securityRevision}`}
              databaseId={target.databaseId}
              status={access.status}
              disabled={access.loading}
            />
          )}
          <button
            type="button"
            disabled={access.loading}
            onClick={() => void access.inspect()}
            className="sor-btn sor-btn-secondary inline-flex items-center gap-2 text-xs disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh unlock methods
          </button>
        </div>
      )}
    </div>
  );
}
