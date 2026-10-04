import { canonicalSyncJson } from "./cloudSyncCodec";

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
  "invalid-data":
    "Data or checkpoint is unsupported, invalid, or exceeds safe limits",
  dependencies:
    "The combined records have incompatible dependencies or metadata",
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
  // Never echo an arbitrary timestamp string: accept real, bounded dates only.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value)) return;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= 0 || time > 253402300799999) return;
  return new Date(time).toISOString();
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
    hasBaseline,
    comparisonLimited,
    otherDifferences,
    localRecordedAt: recordedDate(local),
    remoteRecordedAt: recordedDate(remote),
    remoteSnapshotAt,
  };
}
