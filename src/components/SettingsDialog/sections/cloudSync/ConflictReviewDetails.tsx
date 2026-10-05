import { AlertTriangle } from "lucide-react";
import type { CloudSyncReviewItem } from "../../../../utils/services/cloudSyncConflictReview";
import {
  reviewConflictGuidance,
  reviewConflictLabels,
  reviewRecordLabels,
  type ReviewRecordedDate,
} from "../../../../utils/services/cloudSyncReviewDetails";
import { normalizeZonedTimestamp } from "../../../../utils/storage/recordTimestamps";

function UtcDate({ at }: { at: string }) {
  // Do not assign the viewer's timezone to an ambiguous legacy timestamp.
  const iso = normalizeZonedTimestamp(at);
  if (!iso) {
    return <>Unavailable (invalid or missing timezone)</>;
  }
  return (
    <time dateTime={iso}>{iso.replace("T", " ").replace("Z", " UTC")}</time>
  );
}

function RecordedDate({
  label,
  date,
}: {
  label: string;
  date?: ReviewRecordedDate;
}) {
  return (
    <p>
      {label}:{" "}
      {date ? (
        <>
          <UtcDate at={date.at} /> ({date.source})
        </>
      ) : (
        "Not recorded"
      )}
    </p>
  );
}

function RecordComparison({ item }: { item: CloudSyncReviewItem }) {
  const details = item.details;
  if (!details) return null;
  const rows = details.records.filter((row) => row.local || row.remote);
  return (
    <div className="space-y-2 text-xs text-[var(--color-textSecondary)]">
      {details && (
        <>
          <p>
            {details.hasBaseline
              ? "A shared smart-sync baseline is available."
              : "No shared smart-sync baseline: differences alone cannot establish which copy is newer."}
          </p>
          {rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table
                className="w-full text-left"
                aria-label={`Record comparison for ${item.label}`}
              >
                <thead>
                  <tr>
                    {[
                      "Record type",
                      "Local",
                      "Remote",
                      "Only local",
                      "Only remote",
                      "Different",
                      "Identical",
                    ].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="px-2 py-1 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.kind}>
                      <th scope="row" className="px-2 py-1 font-normal">
                        {reviewRecordLabels[row.kind]}
                        {row.reordered && " (order differs)"}
                      </th>
                      {[
                        row.local,
                        row.remote,
                        row.localOnly,
                        row.remoteOnly,
                        row.different,
                        row.same,
                      ].map((count, i) => (
                        <td key={i} className="px-2 py-1 tabular-nums">
                          {count}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No comparable records in the supported categories.</p>
          )}
          <p>
            Counts compare these copies, not changes since the last sync. “Only”
            can mean an addition or a deletion on the other side; “different”
            compares the whole record, including its metadata. Ordering and
            other metadata may also differ.
          </p>
          {details.comparisonLimited && (
            <p>
              Some data could not be summarized within supported shapes or safe
              limits; the counts are incomplete.
            </p>
          )}
          {details.otherDifferences && (
            <p>
              Other data or metadata differs outside these counts, including any
              record-history differences. Equal record counts do not mean the
              artifacts are identical.
            </p>
          )}
          <div>
            <RecordedDate
              label="Local last recorded change"
              date={details.localRecordedAt}
            />
            <RecordedDate
              label="Remote last recorded change"
              date={details.remoteRecordedAt}
            />
            {details.remoteSnapshotAt && (
              <p>
                Remote snapshot time: <UtcDate at={details.remoteSnapshotAt} />
              </p>
            )}
            <p>
              Times are shown in UTC. Timezone differences alone do not
              establish which copy is newer. Legacy dates without a recorded
              timezone remain uncertain.
            </p>
            <p>
              Dates are informational, not evidence of which copy should win.
              Inferred or observed dates may reflect migration or when the app
              first saw a change.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function ConflictReviewDetails({
  item,
}: {
  item: CloudSyncReviewItem;
}) {
  const blockers = item.state === "conflict" ? (item.conflicts ?? []) : [];
  if (!item.details && !blockers.length) return null;
  return (
    <div className="space-y-2 text-xs text-[var(--color-textSecondary)]">
      {blockers.length > 0 && (
        <section
          aria-label={`Merge blockers for ${item.label}`}
          className="sor-alert-warning space-y-2"
        >
          <h6 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Merge blockers
          </h6>
          <ul
            aria-label={`Merge blockers for ${item.label}`}
            className="list-disc space-y-2 pl-4"
          >
            {blockers.map((entry) => (
              <li key={`${entry.code}:${entry.kind}`}>
                <p className="font-medium text-[var(--color-text)]">
                  {reviewRecordLabels[entry.kind]}:{" "}
                  {reviewConflictLabels[entry.code]} ({entry.count}{" "}
                  {entry.count === 1 ? "reported blocker" : "reported blockers"}
                  ).
                </p>
                <p>{reviewConflictGuidance[entry.code]}</p>
              </li>
            ))}
          </ul>
          <p>
            These counts are reported blockers, not counts of differing records.
            History validation stops at the first detected problem, so more
            problems may remain. A history count of 1 means one reported
            rejection, not one affected record.
          </p>
        </section>
      )}
      {item.details && (
        <details
          open={item.state === "conflict"}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        >
          <summary className="cursor-pointer rounded text-xs font-medium text-[var(--color-textSecondary)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Record comparison and merge details
          </summary>
          <div className="mt-2">
            <RecordComparison item={item} />
          </div>
        </details>
      )}
      {item.state === "conflict" && (
        <p>
          Inspect the affected categories in the app before choosing a whole
          copy. Keep local or Keep remote replaces the entire artifact, not just
          the differing records; save a backup first if you need to retain both
          versions.
        </p>
      )}
    </div>
  );
}
