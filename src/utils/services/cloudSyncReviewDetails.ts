import { canonicalSyncJson } from "./cloudSyncCodec";
import { normalizeZonedTimestamp } from "../storage/recordTimestamps";
import {
  summarizeCloudSyncVersionHistory,
  type CloudSyncVersionHistory,
} from "./cloudSyncVersionHistory";

// Only these product-authored labels leave this module. Keys, IDs, record names,
// paths, values, revisions and content hashes are deliberately not returned.
export const reviewRecordLabels = {
  connections: "Connections and folders",
  credentials: "Saved credentials",
  documents: "Documents",
  attachments: "Document attachments",
  people: "Document people",
  tickets: "Document tickets",
  terminalScripts: "Terminal scripts",
  terminalDefaults: "Customized default scripts",
  terminalMacros: "Terminal macros",
  websiteScripts: "Website scripts",
  websiteMacros: "Website macros",
  tabGroups: "Tab groups",
  recycleBin: "Recycle bin entries",
  preferences: "Preferences",
  databasePreferences: "Database preferences",
  other: "Other data or metadata",
} as const;
export type ReviewRecordKind = keyof typeof reviewRecordLabels;
export type SmartSyncConflictCode =
  | "concurrent-edit"
  | "concurrent-addition"
  | "delete-versus-edit"
  | "ordering"
  | "incompatible-shape"
  | "missing-baseline"
  | "unavailable-baseline"
  | "history-removed"
  | "history-mismatch"
  | "history-incompatible"
  | "history-unrelated"
  | "history-revision-collision"
  | "history-stamp-collision"
  | "history-creation-provenance"
  | "history-missing-head"
  | "history-deleted-content"
  | "history-safety-limit"
  | "history-timestamp-overflow"
  | "history-invalid"
  | "invalid-data"
  | "dependencies";
export const reviewConflictLabels: Record<SmartSyncConflictCode, string> = {
  "concurrent-edit":
    "Both copies edited the same record or property differently",
  "concurrent-addition":
    "Both copies added different data with the same identity",
  "delete-versus-edit":
    "One copy deleted a record or property that the other edited",
  ordering: "The copies have incompatible or ambiguous record ordering",
  "incompatible-shape": "The copies changed the structure of the same data",
  "missing-baseline":
    "No shared smart-sync baseline is available to identify which edits are new",
  "unavailable-baseline":
    "A detailed baseline is unavailable within safe indexing limits",
  "history-removed": "One copy is missing previously recorded history",
  "history-mismatch": "Recorded history does not match the current data",
  "history-incompatible": "The record histories cannot be safely combined",
  "history-unrelated":
    "The same record has separate starting histories with no shared origin",
  "history-revision-collision":
    "The same revision identifies different history events in the two copies",
  "history-stamp-collision":
    "The same revision has different record metadata in the two copies",
  "history-creation-provenance":
    "The copies disagree about a record's creation time or how it was recorded",
  "history-missing-head":
    "A history branch is missing its current record metadata",
  "history-deleted-content":
    "A deleted record has different last-known contents across the two histories",
  "history-safety-limit":
    "Combining the histories would exceed a safe processing limit",
  "history-timestamp-overflow":
    "A history timestamp is too large to record a later merge event",
  "history-invalid": "The combined history failed record-ledger validation",
  "invalid-data":
    "Data or checkpoint is unsupported, invalid, or exceeds safe limits",
  dependencies:
    "The combined records have incompatible dependencies or metadata",
};

/** Fixed, actionable guidance only. Never surface an exception message or a
 * private history path/revision from either copy in the review receipt. */
export const reviewConflictGuidance: Record<SmartSyncConflictCode, string> = {
  "concurrent-edit":
    "Compare the affected category in both copies and preserve the edits you need before choosing a whole copy.",
  "concurrent-addition":
    "Check the added records in both copies. Preserve distinct additions before choosing a whole copy.",
  "delete-versus-edit":
    "Decide whether the deletion or the edited record should be kept; a timestamp alone cannot make this decision.",
  ordering:
    "Compare the order of the affected records in both copies and decide which order should be retained.",
  "incompatible-shape":
    "Use the same app version on both devices, then review the affected data structures before choosing a copy.",
  "missing-baseline":
    "Back up both copies and reconcile their contents before choosing a whole copy. A successful sync establishes a shared baseline.",
  "unavailable-baseline":
    "Detailed indexing could not be used for this artifact. Back up and compare both copies before choosing a whole copy.",
  "history-removed":
    "Look for a backup that retains the missing history. Do not remove the other copy's metadata to force a merge.",
  "history-mismatch":
    "Reload the owning database and refresh this review. If the problem remains, compare a known-good backup; do not erase the history.",
  "history-incompatible":
    "Refresh review to run the current history checks and obtain a more specific reason where available. Back up both copies before choosing either one.",
  "history-unrelated":
    "These records have separately initialized histories, not necessarily missing origins. When a shared baseline proves the content can be combined safely, choose Reconcile histories and merge to preserve both histories and join them for future syncs. This is a one-time reviewed repair, never an automatic choice by date. If that option is unavailable, preserve both copies and resolve the other reported blockers first.",
  "history-revision-collision":
    "Do not reset the ledger or choose by date. Retain backups of both copies and compare a known-good backup before choosing a whole copy.",
  "history-stamp-collision":
    "Do not regenerate revision identifiers to force a merge. Retain backups and compare a known-good backup before choosing a whole copy.",
  "history-creation-provenance":
    "Changing the displayed timezone will not reconcile this evidence. Retain both copies and check their migration or import history before choosing a whole copy.",
  "history-missing-head":
    "Reload and refresh the review. If the branch metadata remains missing, compare a known-good backup without deleting either history.",
  "history-deleted-content":
    "Review the affected deleted records or recycle bins in both copies. Preserve anything you may need to restore before choosing a whole copy.",
  "history-safety-limit":
    "History was not truncated. Keep backups of both copies and use a reviewed whole-copy resolution if appropriate; reducing current file contents may not reduce historical data.",
  "history-timestamp-overflow":
    "Check for invalid future dates in a known-good backup. Do not rewrite ledger timestamps, because revisions depend on them.",
  "history-invalid":
    "Reload both copies in the same app version and refresh review. If validation still fails, retain backups and investigate the history before choosing a whole copy.",
  "invalid-data":
    "Reload the database and refresh review using the same app version on both devices. Retain backups if validation continues to fail.",
  dependencies:
    "Check linked connections, saved credentials, documents and scripts in the affected database. Repair missing references before retrying the merge.",
};
export interface SmartSyncConflictDetail {
  code: SmartSyncConflictCode;
  kind: ReviewRecordKind;
  count: number;
}
export interface ReviewRecordComparison {
  kind: ReviewRecordKind;
  local: number;
  remote: number;
  same: number;
  different: number;
  localOnly: number;
  remoteOnly: number;
  reordered: boolean;
}
export interface ReviewRecordedDate {
  at: string;
  source: "record" | "inferred" | "observed";
}
export interface CloudSyncReviewDetails {
  versionHistory?: CloudSyncVersionHistory;
  records: ReviewRecordComparison[];
  localRecordedAt?: ReviewRecordedDate;
  remoteRecordedAt?: ReviewRecordedDate;
  remoteSnapshotAt?: string;
  hasBaseline: boolean;
  comparisonLimited: boolean;
  otherDifferences: boolean;
}

type Spec = { path: string; kind: ReviewRecordKind; properties?: boolean };
const documentSpecs: Spec[] = [
  { path: "documents", kind: "documents" },
  { path: "attachments", kind: "attachments" },
  { path: "people", kind: "people" },
  { path: "tickets", kind: "tickets" },
];
const automationSpecs: Spec[] = [
  { path: "terminalScripts/customScripts", kind: "terminalScripts" },
  { path: "terminalScripts/modifiedDefaults", kind: "terminalDefaults" },
  { path: "terminalMacros", kind: "terminalMacros" },
  { path: "website/scripts", kind: "websiteScripts" },
  { path: "website/macros", kind: "websiteMacros" },
];
const databaseSpecs: Spec[] = [
  { path: "settings", kind: "preferences", properties: true },
  { path: "databaseSettings", kind: "databasePreferences", properties: true },
  { path: "connections", kind: "connections" },
  { path: "credentialVault/entries", kind: "credentials" },
  { path: "tabGroups", kind: "tabGroups" },
  { path: "recycleBin/entries", kind: "recycleBin" },
  ...documentSpecs.map((spec) => ({ ...spec, path: `documents/${spec.path}` })),
  ...automationSpecs.map((spec) => ({
    ...spec,
    path: `automationLibrary/${spec.path}`,
  })),
];
const terminalSpecs: Spec[] = [
  { path: "customScripts", kind: "terminalScripts" },
  { path: "modifiedDefaults", kind: "terminalDefaults" },
];
function specs(id: string): Spec[] {
  if (id.startsWith("database:")) return databaseSpecs;
  switch (id) {
    case "app:settings":
      return [{ path: "", kind: "preferences", properties: true }];
    case "app:documents.app-wide.v1":
      return documentSpecs;
    case "app:recording.managed-scripts":
      return terminalSpecs;
    case "app:recording.terminal-macros":
      return [{ path: "macros", kind: "terminalMacros" }];
    case "app:recording.web-automation.v1":
      return [
        { path: "scripts", kind: "websiteScripts" },
        { path: "macros", kind: "websiteMacros" },
      ];
    default:
      return [];
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const field = (value: unknown, key: string): unknown =>
  object(value)
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
const at = (value: unknown, path: string): unknown =>
  path ? path.split("/").reduce(field, value) : value;

/** Classify an internal merge path, never return any part of that private path. */
export function reviewRecordKind(
  path: string,
  section: unknown,
): ReviewRecordKind {
  const shape =
    field(section, "format") === "sorng-full-database"
      ? databaseSpecs
      : [
          ...automationSpecs,
          ...terminalSpecs,
          ...documentSpecs,
          { path: "connections", kind: "connections" } as const,
          { path: "scripts", kind: "websiteScripts" } as const,
          {
            path: "macros",
            kind:
              field(section, "scripts") !== undefined
                ? "websiteMacros"
                : "terminalMacros",
          } as const,
        ];
  const found = shape.find(
    (spec) => path === spec.path || path.startsWith(`${spec.path}/`),
  );
  if (found) return found.kind;
  if (
    [
      "settings",
      "databaseSettings",
      "theme",
      "language",
      "colorScheme",
      "animationsEnabled",
      "sidebarWidth",
    ].some((key) => path === key || path.startsWith(`${key}/`))
  )
    return "preferences";
  return "other";
}

function isoDate(value: unknown): string | undefined {
  // Never infer the source timezone from the device performing the review.
  // Use the ledger's strict calendar/offset validation, not permissive Date.parse.
  const normalized = normalizeZonedTimestamp(value);
  return normalized && Date.parse(normalized) > 0 ? normalized : undefined;
}

function recordedDate(value: unknown): ReviewRecordedDate | undefined {
  const root = field(field(field(value, "recordMetadata"), "records"), "$");
  const date = isoDate(field(root, "updatedAt"));
  const source = field(root, "updatedAtSource");
  if (
    date &&
    (source === "record" || source === "observed" || source === "inferred")
  )
    return { at: date, source };
  return undefined;
}

/** Read-only, bounded summaries of already validated JSON sections. The
 * comparison describes the two copies, NOT additions/deletions since baseline. */
export function summarizeCloudSyncReview(
  id: string,
  local: unknown,
  remote: unknown,
  hasBaseline: boolean,
  remoteSnapshotTime?: number,
): CloudSyncReviewDetails {
  const records: ReviewRecordComparison[] = [];
  const categories = specs(id);
  const comparedPaths = new Set<string>();
  let comparisonLimited = !categories.length;
  let remaining = 200_000;
  const index = (
    value: unknown,
    spec: Spec,
  ): Map<string, unknown> | undefined => {
    const entries = at(value, spec.path);
    if (entries === undefined) return new Map();
    if (spec.properties && object(entries)) {
      const pairs = Object.entries(entries).filter(
        ([key]) => key !== "recordMetadata",
      );
      if (pairs.length > remaining) return;
      remaining -= pairs.length;
      return new Map(pairs);
    }
    if (!Array.isArray(entries) || entries.length > remaining) return;
    remaining -= entries.length;
    const result = new Map<string, unknown>();
    for (const entry of entries) {
      const key = field(entry, "id");
      if (typeof key !== "string" || !key || result.has(key)) return;
      result.set(key, entry);
    }
    return result;
  };
  for (const spec of categories) {
    const a = index(local, spec),
      b = index(remote, spec);
    if (!a || !b) {
      comparisonLimited = true;
      continue;
    }
    comparedPaths.add(spec.path);
    let same = 0,
      different = 0;
    for (const [key, value] of a)
      if (b.has(key)) {
        if (canonicalSyncJson(value) === canonicalSyncJson(b.get(key))) same++;
        else different++;
      }
    const ao = [...a.keys()].filter((key) => b.has(key));
    const bo = [...b.keys()].filter((key) => a.has(key));
    records.push({
      kind: spec.kind,
      local: a.size,
      remote: b.size,
      same,
      different,
      localOnly: a.size - same - different,
      remoteOnly: b.size - same - different,
      reordered: !spec.properties && ao.some((key, i) => key !== bo[i]),
    });
  }
  const remoteSnapshotAt =
    typeof remoteSnapshotTime === "number" &&
    Number.isFinite(remoteSnapshotTime) &&
    remoteSnapshotTime > 0 &&
    remoteSnapshotTime <= 253402300799999
      ? new Date(remoteSnapshotTime).toISOString()
      : undefined;
  // Prune counted paths from the comparison, not from either source. Unknown
  // fields and history still matter, even when every visible record is equal.
  const equal = (a: unknown, b: unknown) =>
    a === undefined || b === undefined
      ? a === b
      : canonicalSyncJson(a) === canonicalSyncJson(b);
  const otherChanged = (a: unknown, b: unknown, path: string): boolean => {
    if (comparedPaths.has(path)) {
      // An app settings object is counted by property, except its private ledger.
      return (
        path === "" &&
        !equal(field(a, "recordMetadata"), field(b, "recordMetadata"))
      );
    }
    if (
      object(a) &&
      object(b) &&
      [...comparedPaths].some((entry) => !path || entry.startsWith(`${path}/`))
    )
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].some((key) =>
        otherChanged(
          field(a, key),
          field(b, key),
          path ? `${path}/${encodeURIComponent(key)}` : encodeURIComponent(key),
        ),
      );
    return !equal(a, b);
  };
  const otherDifferences = otherChanged(local, remote, "");
  return {
    records,
    versionHistory: summarizeCloudSyncVersionHistory(local, remote),
    hasBaseline,
    comparisonLimited,
    otherDifferences,
    localRecordedAt: recordedDate(local),
    remoteRecordedAt: recordedDate(remote),
    remoteSnapshotAt,
  };
}
