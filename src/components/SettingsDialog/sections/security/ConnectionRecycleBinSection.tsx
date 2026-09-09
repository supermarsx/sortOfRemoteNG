import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { useConnectionRecycleBin } from "../../../../hooks/connection/useConnectionRecycleBin";
import { DatabaseManager } from "../../../../utils/connection/databaseManager";
import { RecycleBinReviewDialog } from "../../../connection/RecycleBinReviewDialog";

export default function ConnectionRecycleBinSection() {
  const mgr = useConnectionRecycleBin();
  const daysId = useId();
  const [draft, setDraft] = useState<{
    key: string;
    days: string;
    forever: boolean;
  } | null>(null);
  const policy = mgr.snapshot?.policy;
  const value =
    draft?.key === mgr.scopeKey
      ? draft
      : {
          key: mgr.scopeKey,
          days: policy?.mode === "days" ? String(policy.days) : "15",
          forever: policy?.mode === "forever",
        };
  const days = Number(value.days);
  const valid =
    value.forever ||
    (/^\d+$/.test(value.days) &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= 36500);
  const database = DatabaseManager.getInstance().getCurrentDatabase();
  return (
    <section
      data-setting-key="currentDatabaseRecycleBin"
      className="sor-settings-card space-y-3"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Trash2 size={16} />
        Current database recycle bin
      </h3>
      {!mgr.snapshot ? (
        <p className="text-sm text-[var(--color-textSecondary)]">
          Open and unlock a database to change its recycle-bin retention. This
          is not a global setting.
        </p>
      ) : (
        <>
          <p className="text-sm break-words">
            Database:{" "}
            <strong>
              {database?.id === mgr.snapshot.scope.databaseId
                ? database.name
                : mgr.snapshot.scope.databaseId}
            </strong>
          </p>
          <p className="text-xs text-[var(--color-textSecondary)]">
            The default is 15 days from deletion. Retention applies only to this
            database, including deleted folders and their retained children.
            Expired records are removed when the database is available; backups
            and shared vault artifacts are not erased.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm pb-1">
              <input
                type="checkbox"
                checked={value.forever}
                disabled={mgr.busy}
                onChange={(event) =>
                  setDraft({ ...value, forever: event.target.checked })
                }
              />
              Keep indefinitely
            </label>
            <div>
              <label htmlFor={daysId} className="block text-xs mb-1">
                Retention in days
              </label>
              <input
                id={daysId}
                type="number"
                min={1}
                max={36500}
                step={1}
                value={value.days}
                disabled={value.forever || mgr.busy}
                onChange={(event) =>
                  setDraft({ ...value, days: event.target.value })
                }
                className="sor-form-input-xs w-28"
              />
            </div>
            <button
              className="sor-btn sor-btn-secondary text-xs"
              disabled={!valid || mgr.busy}
              onClick={() =>
                void mgr.reviewRetention(
                  value.forever ? { mode: "forever" } : { mode: "days", days },
                )
              }
            >
              Review retention change
            </button>
          </div>
          {!valid && (
            <p role="alert" className="text-xs text-error">
              Enter a whole number from 1 to 36,500 days.
            </p>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            Shortening retention may permanently delete older items. Review the
            affected count before applying it.
          </p>
        </>
      )}
      {mgr.error && (
        <p role="alert" className="text-sm text-error">
          {mgr.error}
        </p>
      )}
      {mgr.message && (
        <p role="status" className="text-sm">
          {mgr.message}
        </p>
      )}
      <RecycleBinReviewDialog
        databaseName={
          database?.id === mgr.snapshot?.scope.databaseId
            ? database?.name
            : undefined
        }
        review={mgr.review}
        busy={mgr.busy}
        onConfirm={mgr.confirm}
        onCancel={mgr.cancelReview}
      />
    </section>
  );
}
