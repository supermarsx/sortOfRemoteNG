/**
 * Portable Trust Center documents (t62 / D6).
 *
 * Export, import, clone and backup all need to move a database's trust
 * records around without going through the display-oriented
 * `src/utils/auth/trustStore.ts` cache: those flows touch databases that are
 * *not* the active one, and the cache only ever reflects the active scope.
 * These helpers talk to `trust_export_database` / `trust_import_database`
 * directly and are deliberately **best-effort** — an export must never fail
 * because the Trust Center is unavailable, and a restore must never fail
 * because a backup predates t62 and carries no `trustRecords`.
 */

import { getInvoke } from "../tauri/invoke";
import type {
  TrustExportDocument,
  TrustExportRecord,
  TrustImportMode,
  TrustImportOutcome,
} from "../auth/trustStore";

export type {
  TrustExportDocument,
  TrustExportRecord,
  TrustImportMode,
  TrustImportOutcome,
};

/** Version written by `trust_export_database` (`TRUST_EXPORT_VERSION`). */
export const TRUST_EXPORT_VERSION = 1;

/**
 * Structural check for something claiming to be a trust export document.
 * Used on untrusted input (import files, restored backups) before it is
 * handed to the native importer.
 */
export function isTrustExportDocument(
  value: unknown,
): value is TrustExportDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TrustExportDocument>;
  return Array.isArray(candidate.records);
}

/**
 * Read one database's trust records. Returns `null` when the caller opted
 * out, when there is no Tauri runtime (browser dev server, jsdom tests), or
 * when the native command fails — never throws.
 */
export async function readTrustDocument(
  databaseId?: string,
  includeTrust = true,
): Promise<TrustExportDocument | null> {
  if (!includeTrust) return null;
  try {
    const invoke = await getInvoke();
    if (!invoke) return null;
    const document = await invoke<TrustExportDocument>(
      "trust_export_database",
      databaseId ? { databaseId } : {},
    );
    return isTrustExportDocument(document) ? document : null;
  } catch (error) {
    console.warn("Trust Center: could not export trust records", error);
    return null;
  }
}

/**
 * Apply a trust export document to a database. Best-effort for the same
 * reason as {@link readTrustDocument}: a partial trust import is better than
 * a failed import/restore, and the outcome is returned so callers can report
 * it.
 *
 * `mode` defaults to `merge`, which keeps an existing record for the same
 * `type:host` unless the imported one was seen more recently and never lets
 * an unrevoked import overwrite a revoked record (enforced Rust-side).
 */
export async function applyTrustDocument(
  document: TrustExportDocument | null | undefined,
  options?: {
    databaseId?: string;
    mode?: TrustImportMode;
    includeTrust?: boolean;
  },
): Promise<TrustImportOutcome | null> {
  if (options?.includeTrust === false) return null;
  if (!isTrustExportDocument(document)) return null;
  try {
    const invoke = await getInvoke();
    if (!invoke) return null;
    return await invoke<TrustImportOutcome>("trust_import_database", {
      ...(options?.databaseId ? { databaseId: options.databaseId } : {}),
      document,
      mode: options?.mode ?? "merge",
    });
  } catch (error) {
    console.warn("Trust Center: could not import trust records", error);
    return null;
  }
}

const recordKey = (record: TrustExportRecord): string =>
  `${record.record_type}:${record.host}`;

const lastSeenOf = (record: TrustExportRecord): number => {
  const raw = record.identity?.last_seen;
  if (typeof raw !== "string") return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Fold several export documents into one, mirroring the native `merge`
 * rules so a multi-source clone behaves like a sequence of merges:
 * the more recently seen record wins, and a revoked record is never
 * replaced by an unrevoked one.
 *
 * Returns `null` when nothing was contributed, so callers can keep using
 * "absent means no trust data" everywhere.
 */
export function mergeTrustDocuments(
  documents: Array<TrustExportDocument | null | undefined>,
): TrustExportDocument | null {
  const present = documents.filter(isTrustExportDocument);
  if (present.length === 0) return null;

  const byKey = new Map<string, TrustExportRecord>();
  for (const document of present) {
    for (const record of document.records) {
      if (!record || typeof record.host !== "string") continue;
      const key = recordKey(record);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, record);
        continue;
      }
      if (existing.revoked && !record.revoked) continue;
      if (!existing.revoked && record.revoked) {
        byKey.set(key, record);
        continue;
      }
      if (lastSeenOf(record) > lastSeenOf(existing)) byKey.set(key, record);
    }
  }

  const withPolicy = present.find((document) => document.policy);
  return {
    version: present[0].version ?? TRUST_EXPORT_VERSION,
    records: Array.from(byKey.values()),
    ...(withPolicy?.policy ? { policy: withPolicy.policy } : {}),
    ...(withPolicy?.policyConfig
      ? { policyConfig: withPolicy.policyConfig }
      : {}),
  };
}
