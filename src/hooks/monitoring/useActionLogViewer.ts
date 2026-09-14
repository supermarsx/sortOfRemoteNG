import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ActionLogEntry } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
  subscribeSessionActivityLog,
  type SessionActivitySource,
} from "../../utils/monitoring/sessionActivityLog";
import { useToastContext } from "../../contexts/ToastContext";
import { useTranslation } from "react-i18next";

export const ACTION_LOG_SOURCES = [
  { value: "application", label: "Application actions" },
  { value: "autofill", label: "Website auto-fill" },
  { value: "website_script", label: "Website scripts" },
  { value: "website_macro", label: "Website macros" },
  { value: "ssh_script", label: "SSH scripts" },
  { value: "ssh_macro", label: "SSH macros" },
] as const;
export type ActionLogSortKey =
  "timestamp" | "source" | "level" | "action" | "connection" | "duration";
type Source = "application" | SessionActivitySource;
export interface ActionLogRow extends ActionLogEntry {
  rowKey: string;
  localAlias: string;
  source: Source;
  sourceLabel: string;
  sessionId?: string;
  databaseId?: string;
}

const sourceLabel = (source: Source) =>
  ACTION_LOG_SOURCES.find((item) => item.value === source)!.label;
const timestampNumber = (value: string) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/** CSV quoting alone does not stop spreadsheet formula evaluation. */
export function actionLogCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Legacy free text is deliberately omitted, not heuristically 'redacted'. */
export function actionLogDiagnostics(row: ActionLogRow) {
  const timestamp = timestampNumber(row.timestamp);
  const base = {
    reference: row.localAlias,
    timestamp: timestamp ? new Date(timestamp).toISOString() : "",
    source: row.sourceLabel,
    level: ["debug", "info", "warn", "error"].includes(row.level)
      ? row.level
      : "info",
    action: row.source === "application" ? "Application action" : row.action,
    details:
      row.source === "application"
        ? "Legacy action, details and connection name omitted."
        : row.details,
    durationMs:
      typeof row.duration === "number" && Number.isFinite(row.duration)
        ? Math.max(0, row.duration)
        : undefined,
  };
  return row.source === "application"
    ? base
    : {
        ...base,
        sessionId: row.sessionId,
        connectionId: row.connectionId,
        databaseId: row.databaseId,
      };
}

export function useActionLogViewer(isOpen: boolean) {
  const { t } = useTranslation();
  const { toast } = useToastContext();
  const [settingsManager] = useState(() => SettingsManager.getInstance());
  const [logs, setLogs] = useState<ActionLogRow[]>([]);
  const [sessionLimit, setSessionLimit] = useState(1000);
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [connectionFilter, setConnectionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<ActionLogSortKey>("timestamp");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLegacyExportConfirm, setShowLegacyExportConfirm] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copyingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadLogs = useCallback(() => {
    const limit = settingsManager.getSettings().maxLogEntries;
    setSessionLimit(
      Number.isInteger(limit) && limit > 0 ? Math.min(1000, limit) : 1000,
    );
    const application: ActionLogRow[] = settingsManager
      .getActionLog()
      .map((log, index) => ({
        ...log,
        rowKey: `application:${log.id}:${index}`,
        localAlias: `application entry ${index + 1}`,
        source: "application",
        sourceLabel: sourceLabel("application"),
      }));
    const activity: ActionLogRow[] = getSessionActivityLog().map(
      (log, index) => ({
        ...log,
        rowKey: `activity:${log.id}`,
        localAlias: `session entry ${index + 1}`,
        sourceLabel: sourceLabel(log.source),
        connectionName: log.connectionId,
      }),
    );
    setLogs([...application, ...activity]);
  }, [settingsManager]);

  useEffect(() => {
    if (!isOpen) return;
    const unsubscribeApplication = settingsManager.subscribeActionLog(loadLogs);
    const unsubscribeActivity = subscribeSessionActivityLog(loadLogs);
    loadLogs();
    return () => {
      unsubscribeApplication();
      unsubscribeActivity();
    };
  }, [isOpen, loadLogs, settingsManager]);

  const uniqueActions = useMemo(
    () => [...new Set(logs.map((log) => log.action))].sort(),
    [logs],
  );
  const uniqueConnections = useMemo(
    () =>
      [
        ...new Set(
          logs
            .map((log) => log.connectionName)
            .filter((name): name is string => !!name),
        ),
      ].sort(),
    [logs],
  );
  const filteredLogs = useMemo(() => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const days =
      dateFilter === "week"
        ? 7
        : dateFilter === "month"
          ? 30
          : dateFilter === "yesterday"
            ? 1
            : 0;
    const after = new Date(today);
    after.setDate(after.getDate() - days);
    const term = searchTerm.trim().toLocaleLowerCase();
    const severity = { debug: 0, info: 1, warn: 2, error: 3 };
    return logs
      .filter((log) => {
        if (sourceFilter !== "all" && log.source !== sourceFilter) return false;
        if (levelFilter !== "all" && log.level !== levelFilter) return false;
        if (actionFilter !== "all" && log.action !== actionFilter) return false;
        if (
          connectionFilter !== "all" &&
          log.connectionName !== connectionFilter
        )
          return false;
        const time = timestampNumber(log.timestamp);
        if (
          dateFilter !== "all" &&
          (time < after.getTime() || time > now.getTime())
        )
          return false;
        if (dateFilter === "yesterday" && time >= today) return false;
        return (
          !term ||
          [
            log.action,
            log.details,
            log.connectionName,
            log.sourceLabel,
            log.level,
            log.sessionId,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(term)
        );
      })
      .sort((a, b) => {
        let compared: number;
        if (sortKey === "timestamp")
          compared =
            timestampNumber(a.timestamp) - timestampNumber(b.timestamp);
        else if (sortKey === "duration")
          compared = (a.duration ?? -1) - (b.duration ?? -1);
        else if (sortKey === "level")
          compared = severity[a.level] - severity[b.level];
        else if (sortKey === "connection")
          compared = (a.connectionName || "").localeCompare(
            b.connectionName || "",
          );
        else if (sortKey === "source")
          compared = a.sourceLabel.localeCompare(b.sourceLabel);
        else compared = a.action.localeCompare(b.action);
        return (
          (sortDirection === "asc" ? compared : -compared) ||
          a.rowKey.localeCompare(b.rowKey)
        );
      });
  }, [
    logs,
    searchTerm,
    sourceFilter,
    levelFilter,
    actionFilter,
    connectionFilter,
    dateFilter,
    sortKey,
    sortDirection,
  ]);
  const filteredApplicationLogs = useMemo(
    () => filteredLogs.filter((log) => log.source === "application"),
    [filteredLogs],
  );
  useEffect(() => {
    setPage(1);
  }, [
    searchTerm,
    sourceFilter,
    levelFilter,
    actionFilter,
    connectionFilter,
    dateFilter,
    sortKey,
    sortDirection,
    pageSize,
  ]);
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, pageCount));
  const pageLogs = filteredLogs.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const sortBy = (key: ActionLogSortKey) => {
    setSortDirection(
      sortKey === key && sortDirection === "asc" ? "desc" : "asc",
    );
    setSortKey(key);
  };
  const clearLogs = () => setShowClearConfirm(true);
  const confirmClearLogs = () => {
    settingsManager.clearActionLog();
    clearSessionActivityLog();
    setLogs([]);
    setShowClearConfirm(false);
    setCopied(null);
    setFeedback("Action log cleared.");
  };
  const download = (rows: unknown[][], prefix: string) => {
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const csv = rows
        .map((row) => row.map(actionLogCsvCell).join(","))
        .join("\r\n");
      const filename = `${prefix}-${new Date().toISOString().split("T")[0]}.csv`;
      url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      toast.success(
        `${t("logs.exportSuccess", "Export successful")}: ${rows.length - 1} entries exported to ${filename}`,
      );
    } catch {
      toast.error(t("logs.exportError", "Export failed"));
    } finally {
      if (link?.parentNode) document.body.removeChild(link);
      if (url) URL.revokeObjectURL(url);
    }
  };
  const exportLogs = () => {
    const safe = filteredLogs.map(actionLogDiagnostics);
    download(
      [
        [
          "Reference",
          "Timestamp",
          "Source",
          "Level",
          "Action",
          "Details",
          "Duration",
          "Session",
          "Connection",
          "Database",
        ],
        ...safe.map((row) => [
          row.reference,
          row.timestamp,
          row.source,
          row.level,
          row.action,
          row.details,
          row.durationMs,
          "sessionId" in row ? row.sessionId : "",
          "connectionId" in row ? row.connectionId : "",
          "databaseId" in row ? row.databaseId : "",
        ]),
      ],
      "action-log-diagnostics",
    );
  };
  const requestLegacyExport = () => setShowLegacyExportConfirm(true);
  const confirmLegacyExport = () => {
    setShowLegacyExportConfirm(false);
    download(
      [
        ["Timestamp", "Level", "Action", "Connection", "Details", "Duration"],
        ...filteredApplicationLogs.map((log) => [
          log.timestamp,
          log.level,
          log.action,
          log.connectionName || "",
          log.details,
          log.duration,
        ]),
      ],
      "application-log",
    );
  };
  const copyRows = async (rows: ActionLogRow[], key: string) => {
    if (
      copyingRef.current ||
      !rows.length ||
      rows.some((row) => !logs.includes(row))
    )
      return;
    copyingRef.current = true;
    setCopying(key);
    setCopied(null);
    setFeedback("");
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          rows.length === 1
            ? actionLogDiagnostics(rows[0])
            : rows.map(actionLogDiagnostics),
          null,
          2,
        ),
      );
      if (mounted.current) {
        setCopied(key);
        setFeedback(
          "Diagnostics copied. Legacy names and free text are omitted.",
        );
      }
    } catch {
      if (mounted.current)
        setFeedback(
          "Could not copy diagnostics. Check clipboard permission and try again.",
        );
    } finally {
      copyingRef.current = false;
      if (mounted.current) setCopying(null);
    }
  };
  const copyLog = (log: ActionLogRow) => copyRows([log], log.rowKey);
  const copyFilteredDiagnostics = () => copyRows(filteredLogs, "filtered");
  const resetFilters = () => {
    setSourceFilter("all");
    setLevelFilter("all");
    setActionFilter("all");
    setConnectionFilter("all");
    setDateFilter("all");
    setSearchTerm("");
  };
  const hasActiveFilters =
    sourceFilter !== "all" ||
    levelFilter !== "all" ||
    actionFilter !== "all" ||
    connectionFilter !== "all" ||
    dateFilter !== "all" ||
    !!searchTerm;
  return {
    t,
    logs,
    sessionLimit,
    filteredLogs,
    filteredApplicationLogs,
    pageLogs,
    searchTerm,
    setSearchTerm,
    sourceFilter,
    setSourceFilter,
    levelFilter,
    setLevelFilter,
    actionFilter,
    setActionFilter,
    connectionFilter,
    setConnectionFilter,
    dateFilter,
    setDateFilter,
    showClearConfirm,
    setShowClearConfirm,
    showLegacyExportConfirm,
    setShowLegacyExportConfirm,
    uniqueActions,
    uniqueConnections,
    clearLogs,
    confirmClearLogs,
    exportLogs,
    requestLegacyExport,
    confirmLegacyExport,
    resetFilters,
    hasActiveFilters,
    sortKey,
    sortDirection,
    sortBy,
    pageSize,
    setPageSize,
    currentPage,
    pageCount,
    setPage,
    feedback,
    copying,
    copied,
    copyLog,
    copyFilteredDiagnostics,
  };
}
