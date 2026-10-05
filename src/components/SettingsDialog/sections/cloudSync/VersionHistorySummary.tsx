import { History } from "lucide-react";
import type {
  CloudSyncVersionHistory,
  VersionHistoryRelationship,
} from "../../../../utils/services/cloudSyncVersionHistory";

const descriptions: Record<VersionHistoryRelationship, string> = {
  same: "Both copies contain the same recorded revisions.",
  "local-ahead":
    "Local history includes all remote revisions plus newer revisions.",
  "remote-ahead":
    "Remote history includes all local revisions plus newer revisions.",
  diverged:
    "Both copies contain revisions absent from the other. Neither history is simply newer.",
  unrelated:
    "The copies have separate starting histories. Their versions cannot be ordered safely.",
  incompatible:
    "History evidence is invalid or inconsistent; no version order can be established.",
  unavailable:
    "Version history is missing on one or both copies. Dates alone cannot establish the newest version.",
  limited:
    "Version history exceeds the display limit. The normal merge safety checks still apply.",
};

export default function VersionHistorySummary({
  history,
}: {
  history: CloudSyncVersionHistory;
}) {
  return (
    <section
      aria-label="Version history"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2"
    >
      <h6 className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
        <History size={14} aria-hidden="true" /> Version history
      </h6>
      <p>{descriptions[history.relationship]}</p>
      {history.sharedRevisions !== undefined && (
        <dl className="grid grid-cols-3 gap-2 tabular-nums">
          <div>
            <dt>Shared revisions</dt>
            <dd>{history.sharedRevisions}</dd>
          </div>
          <div>
            <dt>Local-only revisions</dt>
            <dd>{history.localOnlyRevisions}</dd>
          </div>
          <div>
            <dt>Remote-only revisions</dt>
            <dd>{history.remoteOnlyRevisions}</dd>
          </div>
        </dl>
      )}
      <p>
        Based on recorded parent revisions, not timezone or upload time.
        Revision counts include container and deletion history, not just changed
        records. This does not choose a winner or override merge blockers.
      </p>
    </section>
  );
}
