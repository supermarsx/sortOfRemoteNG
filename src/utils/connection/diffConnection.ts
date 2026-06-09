/**
 * Diff helper for the connection audit log (P9).
 *
 * Pre-P9 the UPDATE_CONNECTION action logged a single line — `Name:
 * "X" updated` — with no hint of WHICH fields the user actually
 * changed. Re-opening the audit log to see "I saved a connection at
 * 14:03" without seeing the port changing from 22 to 2222 is useless
 * for debugging.
 *
 * This module produces a human-readable summary of the meaningful
 * deltas between an old and a new `Connection`. Goals:
 *
 * 1. **Field-level granularity.** Each changed field gets its own
 *    entry; the consumer (`ConnectionProvider.dispatch`) joins them
 *    into a single log line.
 * 2. **Secret masking.** Passwords / private keys / Bearer tokens /
 *    Basic-Auth secrets / cookies are NEVER printed — they show up
 *    as "changed" without before/after values.
 * 3. **Stable noise filter.** `updatedAt` / `lastAccessed` change on
 *    every save; they get excluded so the log stays signal-only.
 * 4. **Structural fields.** `tags`, `httpBookmarks`, `security.*`,
 *    `proxy.*` are deep-compared and surfaced as a single field
 *    delta when anything inside changes — the consumer doesn't need
 *    to enumerate every nested key.
 */
import type { Connection } from "../../types/connection/connection";

/** One field-level delta between two Connection snapshots. */
export interface ConnectionFieldDelta {
  /** Display name of the field, suitable for the log line. */
  field: string;
  /** Pre-edit value, or `null` if the field carries a secret. */
  before: string | null;
  /** Post-edit value, or `null` if the field carries a secret. */
  after: string | null;
  /** True when the field is a secret — caller may want to render
   *  this as `password changed` rather than `password: a → b`. */
  secret: boolean;
}

/**
 * Field keys that hold credentials or other secrets. Their delta
 * is reported as `<field> changed` with no before/after — even an
 * empty-to-set transition is more sensitive than a port edit.
 */
const SECRET_FIELDS = new Set<keyof Connection | string>([
  "password",
  "basicAuthPassword",
  "bearerToken",
  "privateKey",
  "passphrase",
  "privateKeyPassphrase",
  "smbPassword",
  "ftpPassword",
  "mysqlPassword",
  "vncPassword",
  "rdpPassword",
  "anydeskPassword",
  "totpSecret",
  "apiKey",
  "apiSecret",
  "clientSecret",
  "kerberosPassword",
]);

/**
 * Field keys we skip outright — they change on every save / open
 * and aren't user-visible edits.
 */
const NOISE_FIELDS = new Set<keyof Connection | string>([
  "id",
  "createdAt",
  "updatedAt",
  "lastAccessed",
  "lastUsed",
]);

/**
 * Field keys whose value is itself an object/array — we deep-compare
 * via JSON.stringify and report a single boolean delta if anything
 * inside changed. Keeps the log line bounded.
 */
const STRUCTURAL_FIELDS: Array<keyof Connection> = [
  "tags",
  "httpBookmarks",
  "customHeaders" as keyof Connection,
  "security" as keyof Connection,
  "proxy" as keyof Connection,
  "vncSettings" as keyof Connection,
  "rdpSettings" as keyof Connection,
  "sshSettings" as keyof Connection,
];

/** Display one value compactly for the log. Truncates long strings. */
function display(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") {
    if (value === "") return "(empty)";
    if (value.length > 64) return `"${value.slice(0, 61)}…"`;
    return `"${value}"`;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  // Arrays / objects: structural diff is reported as boolean
  // elsewhere; the catch-all here just keeps things readable.
  return "[...]";
}

/**
 * Compute the deltas between two Connection snapshots. Returns an
 * empty array when nothing meaningful changed.
 */
export function diffConnection(
  before: Connection | undefined,
  after: Connection,
): ConnectionFieldDelta[] {
  if (!before) return [];

  const out: ConnectionFieldDelta[] = [];
  const seen = new Set<string>();

  // Union of keys so we catch additions and removals.
  for (const key of Object.keys({ ...before, ...after })) {
    if (NOISE_FIELDS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const beforeVal = (before as unknown as Record<string, unknown>)[key];
    const afterVal = (after as unknown as Record<string, unknown>)[key];

    const isStructural = (STRUCTURAL_FIELDS as string[]).includes(key);
    if (isStructural) {
      const equal =
        JSON.stringify(beforeVal ?? null) === JSON.stringify(afterVal ?? null);
      if (equal) continue;
      out.push({
        field: key,
        before: null,
        after: null,
        secret: false,
      });
      continue;
    }

    // Primitive / shallow comparison.
    if (beforeVal === afterVal) continue;
    // Treat empty-string and undefined as the same — saves spurious
    // entries when the form normalises absent fields differently.
    if ((beforeVal ?? "") === (afterVal ?? "")) continue;

    if (SECRET_FIELDS.has(key)) {
      out.push({ field: key, before: null, after: null, secret: true });
      continue;
    }

    out.push({
      field: key,
      before: display(beforeVal),
      after: display(afterVal),
      secret: false,
    });
  }

  return out;
}

/**
 * Format a delta list into a single log-line string. Empty input
 * returns `"no changes"`.
 */
export function formatConnectionDiff(deltas: ConnectionFieldDelta[]): string {
  if (deltas.length === 0) return "no changes";
  return deltas
    .map((d) => {
      if (d.secret) return `${d.field} changed`;
      if (d.before === null && d.after === null) return `${d.field} changed`;
      return `${d.field}: ${d.before} → ${d.after}`;
    })
    .join(", ");
}
