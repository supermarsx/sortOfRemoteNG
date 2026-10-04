import type { CloudSyncReviewItem } from "../../../../utils/services/cloudSyncConflictReview";
import {
  reviewConflictLabels,
  reviewRecordLabels,
  type ReviewRecordedDate,
} from "../../../../utils/services/cloudSyncReviewDetails";

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
          <time dateTime={date.at}>{new Date(date.at).toLocaleString()}</time> (
          {date.source})
        </>
      ) : (
        "Not recorded"
      )}
    </p>
  );
}

export default function ConflictReviewDetails({
  item,
}: {
  item: CloudSyncReviewItem;
}) {
  const details = item.details;
  if (!details && !item.conflicts?.length) return null;
  const rows = details?.records.filter((row) => row.local || row.remote) ?? [];
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
                Remote snapshot time:{" "}
                <time dateTime={details.remoteSnapshotAt}>
                  {new Date(details.remoteSnapshotAt).toLocaleString()}
                </time>
              </p>
            )}
            <p>
              Dates are informational, not evidence of which copy should win.
              Inferred or observed dates may reflect migration or when the app
              first saw a change.
            </p>
          </div>
        </>
      )}
      {!!item.conflicts?.length && (
        <ul
          aria-label={`Merge blockers for ${item.label}`}
          className="list-disc pl-4 space-y-1"
        >
          {item.conflicts.map((entry) => (
            <li key={`${entry.code}:${entry.kind}`}>
              {reviewRecordLabels[entry.kind]}:{" "}
              {reviewConflictLabels[entry.code]} ({entry.count}).
            </li>
          ))}
        </ul>
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
