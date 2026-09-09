import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAllTrustRecords,
  getAllPerConnectionTrustRecords,
  getTrustStoreScope,
  getTrustRecordStorageKey,
  retryTrustStoreHydration,
  refreshTrustStoreScope,
  updateTrustRecordNickname,
  parseTrustRecordAddress,
  type TrustRecord,
  type TrustExportDocument,
  type TrustExportRecord,
  type TrustImportOutcome,
  type TrustPolicy,
} from "../../utils/auth/trustStore";
import {
  DatabaseManager,
  onCurrentDatabaseChange,
} from "../../utils/connection/databaseManager";
import { getInvoke } from "../../utils/tauri/invoke";

export interface TrustCenterRow {
  id: string;
  record: TrustRecord;
  connectionId?: string;
}
export type TrustCenterAction =
  "revoke" | "reinstate" | "forget" | "policy" | "tags";
interface TrustSummary {
  total_records: number;
  revoked_count: number;
  expired_count: number;
  records_with_history: number;
  total_verifications: number;
  total_mismatches: number;
  average_trust_score: number;
}
type Review = {
  databaseId: string;
  databaseName: string;
  generation: number;
} & (
  | {
      action: TrustCenterAction;
      rows: TrustCenterRow[];
      policy?: TrustPolicy;
      tags?: string[];
    }
  | {
      action: "import";
      document: TrustExportDocument;
      expectedRecords: TrustExportRecord[];
      warnings?: string[];
      skipped?: number;
    }
);
const errorText = (value: unknown) =>
  value instanceof Error ? value.message : String(value);
const rowKey = (record: TrustRecord, connectionId?: string) =>
  JSON.stringify([connectionId ?? null, record.type, record.host]);

export function useTrustCenter(connectionName?: (id: string) => string) {
  const [rows, setRows] = useState<TrustCenterRow[]>([]);
  const [databaseName, setDatabaseName] = useState<string | null>(null);
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [summary, setSummary] = useState<TrustSummary | null>(null);
  const [inspection, setInspection] = useState<{
    rowId: string;
    history: unknown;
    stats: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<Review | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("host");
  const [scopeFilter, setScopeFilter] = useState("all");
  const mounted = useRef(true);
  const generation = useRef(0);
  const loadingGeneration = useRef(0);
  const busyRef = useRef(false);
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const refresh = useCallback(async (clearError = true) => {
    const epoch = generation.current;
    const load = ++loadingGeneration.current;
    setLoading(true);
    if (clearError) setError(null);
    try {
      await refreshTrustStoreScope();
      await retryTrustStoreHydration();
      if (
        !mounted.current ||
        epoch !== generation.current ||
        load !== loadingGeneration.current
      )
        return;
      const scope = getTrustStoreScope();
      if (!scope.resolved || !scope.databaseId)
        throw new Error("Open a database to manage its trusted identities.");
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error("Trust management requires the desktop app.");
      const inspectedSummary = await invoke<TrustSummary>("trust_get_summary", {
        expectedDatabaseId: scope.databaseId,
      });
      if (
        !mounted.current ||
        epoch !== generation.current ||
        load !== loadingGeneration.current ||
        getTrustStoreScope().databaseId !== scope.databaseId
      )
        return;
      setSummary(inspectedSummary);
      const next = [
        ...getAllTrustRecords().map((record) => ({
          id: rowKey(record),
          record,
        })),
        ...getAllPerConnectionTrustRecords().flatMap((group) =>
          group.records.map((record) => ({
            id: rowKey(record, group.connectionId),
            record,
            connectionId: group.connectionId,
          })),
        ),
      ];
      setRows(next);
      setDatabaseId(scope.databaseId);
      setDatabaseName(
        DatabaseManager.getInstance().getCurrentDatabase()?.name ??
          scope.databaseId,
      );
      const nextIds = new Set(next.map((row) => row.id));
      setSelected(
        (previous) => new Set([...previous].filter((id) => nextIds.has(id))),
      );
    } catch (e) {
      if (
        mounted.current &&
        epoch === generation.current &&
        load === loadingGeneration.current
      ) {
        setError(errorText(e));
        setRows([]);
      }
    } finally {
      if (
        mounted.current &&
        epoch === generation.current &&
        load === loadingGeneration.current
      )
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const lifecycle = generation;
    const stop = onCurrentDatabaseChange(() => {
      lifecycle.current++;
      reviewRef.current = null;
      setReview(null);
      setRows([]);
      setSelected(new Set());
      setDatabaseName(null);
      setDatabaseId(null);
      setSummary(null);
      setInspection(null);
      setMessage(null);
      void refresh();
    });
    // Native cache hydration emits trustStoreChanged too; use current cached
    // records on notifications without recursively forcing another hydration.
    const cacheChanged = () => {
      if (busyRef.current) return;
      setRows([
        ...getAllTrustRecords().map((record) => ({
          id: rowKey(record),
          record,
        })),
        ...getAllPerConnectionTrustRecords().flatMap((group) =>
          group.records.map((record) => ({
            id: rowKey(record, group.connectionId),
            record,
            connectionId: group.connectionId,
          })),
        ),
      ]);
    };
    void refresh();
    window.addEventListener("trustStoreChanged", cacheChanged);
    return () => {
      mounted.current = false;
      lifecycle.current++;
      stop();
      window.removeEventListener("trustStoreChanged", cacheChanged);
    };
  }, [refresh]);
  const capture = () => {
    const scope = getTrustStoreScope();
    if (!scope.resolved || !scope.databaseId)
      throw new Error("Open a database first.");
    return {
      databaseId: scope.databaseId,
      databaseName: databaseName ?? scope.databaseId,
      generation: generation.current,
    };
  };
  const assertCurrent = (target: ReturnType<typeof capture>) => {
    if (
      !mounted.current ||
      target.generation !== generation.current ||
      getTrustStoreScope().databaseId !== target.databaseId
    )
      throw new Error(
        "The active database changed. Refresh and review the action again.",
      );
  };
  const begin = () => {
    if (busyRef.current || loading) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    return true;
  };
  const finish = () => {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  };
  const requestAction = (
    action: TrustCenterAction,
    targets: TrustCenterRow[],
    policy?: TrustPolicy,
    tags?: string[],
  ) => {
    if (busyRef.current || loading || !targets.length) return;
    try {
      const next: Review = {
        ...capture(),
        action,
        policy,
        tags,
        rows: targets.map((row) => ({
          ...row,
          record: { ...row.record, identity: { ...row.record.identity } },
        })),
      };
      reviewRef.current = next;
      setReview(next);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const dismissReview = () => {
    reviewRef.current = null;
    setReview(null);
  };
  const apply = async () => {
    const target = reviewRef.current;
    if (!target || !begin()) return;
    dismissReview();
    try {
      assertCurrent(target);
      if (target.action === "import") {
        const invoke = await getInvoke();
        if (!invoke) throw new Error("Trust import requires the desktop app.");
        assertCurrent(target);
        const result = await invoke<TrustImportOutcome>(
          "trust_import_database",
          {
            databaseId: target.databaseId,
            document: target.document,
            mode: "merge",
            expectedRecords: target.expectedRecords,
          },
        );
        assertCurrent(target);
        setMessage(
          `Imported ${result.imported}; skipped ${result.skipped} into ${target.databaseName}. Existing revoked identities were not reinstated.`,
        );
      } else {
        const targets = target.rows.map((row) => ({
          host: getTrustRecordStorageKey(row.record, row.connectionId).slice(
            row.record.type.length + 1,
          ),
          recordType: row.record.type,
          fingerprint: row.record.identity.fingerprint,
        }));
        const invoke = await getInvoke();
        if (!invoke)
          throw new Error("Trust management requires the desktop app.");
        assertCurrent(target);
        const result = await invoke<{ updated: number }>(
          "trust_apply_reviewed_batch",
          {
            databaseId: target.databaseId,
            action: target.action,
            targets,
            ...(target.action === "policy"
              ? { policy: target.policy ?? null }
              : {}),
            ...(target.action === "tags"
              ? {
                  tags: [
                    ...new Set(
                      (target.tags ?? [])
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    ),
                  ],
                }
              : {}),
          },
        );
        assertCurrent(target);
        if (result.updated !== targets.length)
          throw new Error(
            "Native batch result was incomplete; refresh before retrying.",
          );
        setSelected(new Set());
        setMessage(
          `${target.action}: ${result.updated} identities updated in ${target.databaseName}.`,
        );
      }
    } catch (e) {
      if (mounted.current && target.generation === generation.current)
        setError(errorText(e));
    } finally {
      if (mounted.current) await refresh(false);
      finish();
    }
  };
  const exportRows = async (targets?: TrustCenterRow[]) => {
    if (!begin()) return;
    let target: ReturnType<typeof capture> | undefined;
    try {
      target = capture();
      const keys = targets
        ? new Set(
            targets.map((row) =>
              getTrustRecordStorageKey(row.record, row.connectionId),
            ),
          )
        : null;
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Trust export requires the desktop app.");
      assertCurrent(target);
      const document = await invoke<TrustExportDocument>(
        "trust_export_database",
        { databaseId: target.databaseId },
      );
      assertCurrent(target);
      const records = keys
        ? document.records.filter((row) =>
            keys.has(`${row.record_type}:${row.host}`),
          )
        : document.records;
      if (keys && records.length !== keys.size)
        throw new Error("Trust records changed; refresh before exporting.");
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "trusted-identities.json",
        filters: [{ name: "Trust identities JSON", extensions: ["json"] }],
      });
      if (!path) return;
      assertCurrent(target);
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      assertCurrent(target);
      await writeTextFile(
        path,
        JSON.stringify({ version: document.version, records }, null, 2),
      );
      assertCurrent(target);
      setMessage(
        `Exported ${records.length} identities from ${target.databaseName}. No password or private-key credentials were included.`,
      );
    } catch (e) {
      if (
        mounted.current &&
        (!target || target.generation === generation.current)
      )
        setError(errorText(e));
    } finally {
      finish();
    }
  };
  const importFile = async () => {
    if (!begin()) return;
    let target: ReturnType<typeof capture> | undefined;
    try {
      target = capture();
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Trust import requires the desktop app.");
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Trust identities JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      assertCurrent(target);
      const { readTextFile, stat } = await import("@tauri-apps/plugin-fs");
      if ((await stat(path)).size > 8 * 1024 * 1024)
        throw new Error("Trust import exceeds the 8 MB review limit.");
      const parsed = JSON.parse(await readTextFile(path));
      assertCurrent(target);
      const document = parsed?.trustRecords ?? parsed;
      if (
        document?.version !== 1 ||
        !Array.isArray(document.records) ||
        document.records.length > 10000 ||
        !document.records.length ||
        document.records.some(
          (row: unknown) =>
            !row ||
            typeof row !== "object" ||
            typeof (row as { host?: unknown }).host !== "string" ||
            typeof (row as { record_type?: unknown }).record_type !== "string",
        )
      )
        throw new Error(
          "Select a valid version 1 trust identity export (1–10,000 records).",
        );
      const records: TrustExportRecord[] = document.records;
      if (
        new Set(records.map((row) => `${row.record_type}:${row.host}`)).size !==
          records.length ||
        records.some(
          (row) =>
            !row.identity ||
            typeof row.identity.fingerprint !== "string" ||
            !row.identity.fingerprint.trim(),
        )
      )
        throw new Error(
          "Import identities must have unique host/type pairs and a fingerprint.",
        );
      const existing = await invoke<TrustExportDocument>(
        "trust_export_database",
        { databaseId: target.databaseId },
      );
      assertCurrent(target);
      const next: Review = {
        ...target,
        action: "import",
        document: { version: 1, records },
        expectedRecords: existing.records,
      };
      reviewRef.current = next;
      setReview(next);
    } catch (e) {
      if (
        mounted.current &&
        (!target || target.generation === generation.current)
      )
        setError(errorText(e));
    } finally {
      finish();
    }
  };
  const importKnownHosts = async (chooseFile = false) => {
    if (!begin()) return;
    let target: ReturnType<typeof capture> | undefined;
    try {
      target = capture();
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error("Known hosts preview requires the desktop app.");
      let path: string | undefined;
      if (chooseFile) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const chosen = await open({
          multiple: false,
          directory: false,
          title: "Choose an OpenSSH known_hosts file",
        });
        if (typeof chosen !== "string") return;
        path = chosen;
      }
      assertCurrent(target);
      const document = await invoke<
        TrustExportDocument & { warnings?: string[]; skipped?: number }
      >("trust_preview_known_hosts", path ? { path } : {});
      assertCurrent(target);
      if (!document.records.length)
        throw new Error(
          "No supported, named SSH identities were found in that known_hosts file.",
        );
      const existing = await invoke<TrustExportDocument>(
        "trust_export_database",
        { databaseId: target.databaseId },
      );
      assertCurrent(target);
      const next: Review = {
        ...target,
        action: "import",
        document: { version: 1, records: document.records },
        expectedRecords: existing.records,
        warnings: document.warnings,
        skipped: document.skipped,
      };
      reviewRef.current = next;
      setReview(next);
    } catch (e) {
      if (
        mounted.current &&
        (!target || target.generation === generation.current)
      )
        setError(errorText(e));
    } finally {
      finish();
    }
  };
  const inspect = async (row: TrustCenterRow) => {
    if (!begin()) return;
    let target: ReturnType<typeof capture> | undefined;
    setInspection(null);
    try {
      target = capture();
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error("Trust inspection requires the desktop app.");
      assertCurrent(target);
      const key = getTrustRecordStorageKey(row.record, row.connectionId);
      const args = {
        host: key.slice(row.record.type.length + 1),
        recordType: row.record.type,
        expectedDatabaseId: target.databaseId,
        expectedFingerprint: row.record.identity.fingerprint,
      };
      const [history, stats] = await Promise.all([
        invoke("trust_get_identity_history", args),
        invoke("trust_get_verification_stats", args),
      ]);
      assertCurrent(target);
      setInspection({ rowId: row.id, history, stats });
    } catch (e) {
      if (
        mounted.current &&
        (!target || target.generation === generation.current)
      )
        setError(errorText(e));
    } finally {
      finish();
    }
  };
  const rename = async (row: TrustCenterRow, nickname: string) => {
    if (!begin()) return;
    let target: ReturnType<typeof capture> | undefined;
    try {
      target = capture();
      assertCurrent(target);
      const { host, port } = parseTrustRecordAddress(row.record);
      await updateTrustRecordNickname(
        host,
        port,
        row.record.type,
        nickname,
        row.connectionId,
      );
      assertCurrent(target);
      setMessage("Identity label updated.");
    } catch (e) {
      if (
        mounted.current &&
        (!target || target.generation === generation.current)
      )
        setError(errorText(e));
    } finally {
      if (mounted.current) await refresh(false);
      finish();
    }
  };
  const searchableRows = useMemo(
    () =>
      rows.map((row) => ({
        row,
        text: [
          row.record.host,
          row.record.nickname,
          row.connectionId,
          row.connectionId && connectionName?.(row.connectionId),
          row.record.type,
          JSON.stringify(row.record.identity),
          row.record.trustExpires,
          row.record.tags?.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      })),
    [rows, connectionName],
  );
  const visible = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return searchableRows
      .filter(
        ({ row, text }) =>
          (type === "all" || row.record.type === type) &&
          (status === "all" ||
            (status === "revoked"
              ? row.record.revoked
              : !row.record.revoked)) &&
          (scopeFilter === "all" ||
            (scopeFilter === "database"
              ? !row.connectionId
              : !!row.connectionId)) &&
          terms.every((term) => text.includes(term)),
      )
      .map((item) => item.row)
      .sort((a, b) =>
        sort === "recent"
          ? Date.parse(b.record.identity.lastSeen) -
            Date.parse(a.record.identity.lastSeen)
          : (sort === "type"
              ? a.record.type.localeCompare(b.record.type)
              : 0) || a.record.host.localeCompare(b.record.host),
      );
  }, [searchableRows, query, type, status, sort, scopeFilter]);
  return {
    rows,
    visible,
    databaseName,
    databaseId,
    summary,
    inspection,
    inspect,
    loading,
    busy,
    error,
    message,
    selected,
    setSelected,
    review,
    query,
    setQuery,
    type,
    setType,
    status,
    setStatus,
    sort,
    setSort,
    scopeFilter,
    setScopeFilter,
    refresh,
    requestAction,
    dismissReview,
    apply,
    exportRows,
    importFile,
    importKnownHosts,
    rename,
  };
}
