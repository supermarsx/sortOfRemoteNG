import {
  normalizeRecordLedger,
  RecordLedgerError,
  type RecordLedger,
} from "../storage/recordLedger";

export type VersionHistoryRelationship =
  | "same"
  | "local-ahead"
  | "remote-ahead"
  | "diverged"
  | "unrelated"
  | "incompatible"
  | "unavailable"
  | "limited";

export interface CloudSyncVersionHistory {
  relationship: VersionHistoryRelationship;
  sharedRevisions?: number;
  localOnlyRevisions?: number;
  remoteOnlyRevisions?: number;
}

// This is a bounded display projection, not another copy of the private ledger.
// The merge validator remains authoritative, including body/hash verification.
const MAX_REVIEW_EVENTS = 5_000;
const REVIEW_LIMITS = { maxBytes: 512 * 1024 };
const field = (value: unknown, name: string): unknown =>
  value && typeof value === "object"
    ? Object.getOwnPropertyDescriptor(value, name)?.value
    : undefined;

/** Compare revision ancestry, never wall clocks. Return counts and fixed labels
 * only: record paths, IDs, hashes and payloads stay inside the encrypted ledger. */
export function summarizeCloudSyncVersionHistory(
  local: unknown,
  remote: unknown,
): CloudSyncVersionHistory {
  const a = field(local, "recordMetadata"),
    b = field(remote, "recordMetadata");
  for (const value of [a, b]) {
    const journal = field(value, "journal");
    if (Array.isArray(journal) && journal.length > MAX_REVIEW_EVENTS)
      return { relationship: "limited" };
  }
  try {
    // Validate each present side before classifying legacy absence. Falsy but
    // present metadata is corrupt, not an old database with no ledger.
    const left = normalizeRecordLedger(a, REVIEW_LIMITS),
      right = normalizeRecordLedger(b, REVIEW_LIMITS);
    if (!left || !right) return { relationship: "unavailable" };
    const localEvents = new Map(
      left.journal.map((event) => [event.revision, event]),
    );
    let sharedRevisions = 0;
    for (const event of right.journal) {
      const other = localEvents.get(event.revision);
      if (!other) continue;
      if (JSON.stringify(other) !== JSON.stringify(event))
        return { relationship: "incompatible" };
      sharedRevisions++;
    }
    const roots = (ledger: RecordLedger) => {
      const result = new Map<string, Set<string>>();
      for (const event of ledger.journal) {
        if (event.parentRevision || event.parentRevisions?.length) continue;
        const revisions = result.get(event.record) ?? new Set<string>();
        revisions.add(event.revision);
        result.set(event.record, revisions);
      }
      return result;
    };
    const localRoots = roots(left),
      remoteRoots = roots(right);
    for (const [key, revisions] of localRoots) {
      const other = remoteRoots.get(key);
      // A reconciled record can have multiple retained roots. A returning old
      // branch is comparable when one of those roots is its own, even though
      // its current summary creation date differs from the joined summary.
      if (other && ![...revisions].some((revision) => other.has(revision)))
        return { relationship: "unrelated" };
    }
    for (const event of right.journal) {
      if (event.parentRevision || event.parentRevisions?.length) continue;
      if (!localRoots.get(event.record)?.has(event.revision)) continue;
      const original =
        left.origins?.[event.revision] ?? left.records[event.record];
      const other =
        right.origins?.[event.revision] ?? right.records[event.record];
      if (
        original.createdAt !== other.createdAt ||
        original.createdAtSource !== other.createdAtSource
      )
        return { relationship: "incompatible" };
    }
    for (const [key, stamp] of Object.entries(left.records)) {
      const other = right.records[key];
      if (!other) continue;
      if (
        stamp.revision === other.revision &&
        JSON.stringify(stamp) !== JSON.stringify(other)
      )
        return { relationship: "incompatible" };
    }
    const localOnlyRevisions = left.journal.length - sharedRevisions;
    const remoteOnlyRevisions = right.journal.length - sharedRevisions;
    return {
      relationship: localOnlyRevisions
        ? remoteOnlyRevisions
          ? "diverged"
          : "local-ahead"
        : remoteOnlyRevisions
          ? "remote-ahead"
          : "same",
      sharedRevisions,
      localOnlyRevisions,
      remoteOnlyRevisions,
    };
  } catch (error) {
    return {
      relationship:
        error instanceof RecordLedgerError && error.code === "safety-limit"
          ? "limited"
          : "incompatible",
    };
  }
}
