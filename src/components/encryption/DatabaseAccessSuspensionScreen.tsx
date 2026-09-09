import { useRef } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import type { DatabaseAccessSuspension } from "../../hooks/settings/useDatabaseAccessSuspension";
import { ManagedDatabaseUnlockForm } from "./ManagedDatabaseUnlockForm";
import { useUnlockIsolation } from "./useUnlockIsolation";

export function DatabaseAccessSuspensionScreen({
  access,
  globallyLocked,
}: {
  access: DatabaseAccessSuspension;
  globallyLocked: boolean;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const visible = access.blocked && !globallyLocked;
  const keyboard = useUnlockIsolation(root, visible);
  if (!visible || !access.suspended) return null;
  const target = access.suspended;
  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="database-access-suspended-title"
      data-testid="database-access-suspended"
      onKeyDown={keyboard}
      onKeyUp={keyboard}
      onKeyPress={keyboard}
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-background text-[var(--color-text)]"
    >
      <div className="mx-4 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
        <h2
          id="database-access-suspended-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <LockKeyhole className="h-5 w-5 text-warning" aria-hidden="true" />
          Database access is suspended
        </h2>
        <p className="text-sm">
          {target.name}{" "}
          {target.access.reason === "expired"
            ? "requires authentication because its access session expired."
            : "requires authentication because its native access was revoked or protection changed."}
        </p>
        <p className="text-xs text-[var(--color-textMuted)]">
          Unsaved edits remain in memory. The existing editors are hidden and
          cannot be used until this database is authenticated again. Nothing has
          been closed, reloaded or discarded.
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
            disabled={globallyLocked || access.loading}
          />
        )}
        <button
          type="button"
          disabled={access.loading}
          onClick={() => void access.inspect()}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh unlock methods
        </button>
      </div>
    </div>
  );
}
