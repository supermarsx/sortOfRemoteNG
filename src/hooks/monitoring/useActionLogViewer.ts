import { useState, useEffect, useCallback, useMemo } from "react";
import { ActionLogEntry } from "../../types/settings";
import { SettingsManager } from "../../utils/settingsManager";
import { useToastContext } from "../../contexts/ToastContext";
import { useTranslation } from "react-i18next";

export function useActionLogViewer(isOpen: boolean) {
  const { t } = useTranslation();
  const { toast } = useToastContext();
  const [logs, setLogs] = useState<ActionLogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<ActionLogEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [connectionFilter, setConnectionFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const settingsManager = SettingsManager.getInstance();

  const uniqueActions = useMemo(() => {
    const actions = new Set(logs.map((log) => log.action));
    return Array.from(actions).sort();
  }, [logs]);

  const uniqueConnections = useMemo(() => {
    const connections = new Set(
      logs
        .filter((log) => log.connectionName)
        .map((log) => log.connectionName!),
    );
    return Array.from(connections).sort();
  }, [logs]);

  const loadLogs = useCallback(() => {
    const actionLogs = settingsManager.getActionLog();
    setLogs(actionLogs);
  }, [settingsManager]);

  const filterLogs = useCallback(() => {
    let filtered = logs;

    if (levelFilter !== "all") {
      filtered = filtered.filter((log) => log.level === levelFilter);
    }
    if (actionFilter !== "all") {
      filtered = filtered.filter((log) => log.action === actionFilter);
    }
    if (connectionFilter !== "all") {
      filtered = filtered.filter(
        (log) => log.connectionName === connectionFilter,
      );
    }
    if (dateFilter !== "all") {
      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      switch (dateFilter) {
        case "today":
          filtered = filtered.filter((log) => log.timestamp >= startOfToday);
          break;
        case "yesterday": {
          const startOfYesterday = new Date(startOfToday);
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
          filtered = filtered.filter(
            (log) =>
              log.timestamp >= startOfYesterday && log.timestamp < startOfToday,
          );
          break;
        }
        case "week": {
          const startOfWeek = new Date(startOfToday);
          startOfWeek.setDate(startOfWeek.getDate() - 7);
          filtered = filtered.filter((log) => log.timestamp >= startOfWeek);
          break;
        }
        case "month": {
          const startOfMonth = new Date(startOfToday);
          startOfMonth.setMonth(startOfMonth.getMonth() - 1);
          filtered = filtered.filter((log) => log.timestamp >= startOfMonth);
          break;
        }
      }
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.action.toLowerCase().includes(term) ||
          log.details.toLowerCase().includes(term) ||
          log.connectionName?.toLowerCase().includes(term),
      );
    }

    setFilteredLogs(filtered);
  }, [
    logs,
    searchTerm,
    levelFilter,
    actionFilter,
    connectionFilter,
    dateFilter,
  ]);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
      const interval = setInterval(loadLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen, loadLogs]);

  useEffect(() => {
    filterLogs();
  }, [filterLogs]);

  const clearLogs = () => setShowClearConfirm(true);

  const confirmClearLogs = () => {
    settingsManager.clearActionLog();
    setLogs([]);
    setShowClearConfirm(false);
  };

  const exportLogs = () => {
    try {
      const csvContent = [
        "Timestamp,Level,Action,Connection,Details,Duration",
        ...filteredLogs.map(
          (log) =>
            `"${log.timestamp.toISOString()}","${log.level}","${log.action}","${log.connectionName || ""}","${log.details.replace(/"/g, '""')}","${log.duration || ""}"`,
        ),
      ].join("\n");

      const filename = `action-log-${new Date().toISOString().split("T")[0]}.csv`;
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(
        `${t("logs.exportSuccess", "Export successful")}: ${filteredLogs.length} entries exported to ${filename}`,
      );
    } catch (error) {
      toast.error(
        `${t("logs.exportError", "Export failed")}: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
      );
    }
  };

  const resetFilters = () => {
    setLevelFilter("all");
    setActionFilter("all");
    setConnectionFilter("all");
    setDateFilter("all");
    setSearchTerm("");
  };

  const hasActiveFilters =
    levelFilter !== "all" ||
    actionFilter !== "all" ||
    connectionFilter !== "all" ||
    dateFilter !== "all" ||
    !!searchTerm;

  return {
    t,
    logs,
    filteredLogs,
    searchTerm,
    setSearchTerm,
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
    uniqueActions,
    uniqueConnections,
    clearLogs,
    confirmClearLogs,
    exportLogs,
    resetFilters,
    hasActiveFilters,
  };
}
