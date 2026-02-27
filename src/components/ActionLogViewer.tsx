import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Download,
  Filter,
  Trash2,
  Search,
  ScrollText,
  Clock,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
  Calendar,
  Server,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionLogEntry } from "../types/settings";
import { SettingsManager } from "../utils/settingsManager";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToastContext } from "../contexts/ToastContext";
import { Modal } from "./ui/Modal";

const LEVEL_ICONS: Record<string, JSX.Element> = {
  debug: <Bug className="text-[var(--color-textSecondary)]" size={14} />,
  info: <Info className="text-blue-400" size={14} />,
  warn: <AlertTriangle className="text-yellow-400" size={14} />,
  error: <AlertCircle className="text-red-400" size={14} />,
};

const DEFAULT_ICON = (
  <Info className="text-[var(--color-textSecondary)]" size={14} />
);

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-[var(--color-textSecondary)]",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

/**
 * Props for the {@link ActionLogViewer} component.
 * @property isOpen - Whether the log viewer modal is visible.
 * @property onClose - Callback fired when the modal should close.
 */
interface ActionLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Displays a modal table of recorded actions with tools for filtering and exporting.
 */
export const ActionLogViewer: React.FC<ActionLogViewerProps> = ({
  isOpen,
  onClose,
}) => {
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

  // Get unique actions for the filter dropdown
  const uniqueActions = useMemo(() => {
    const actions = new Set(logs.map((log) => log.action));
    return Array.from(actions).sort();
  }, [logs]);

  // Get unique connections for the filter dropdown
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
    // Start with the full log list
    let filtered = logs;

    // Apply level filter if a specific level is selected
    if (levelFilter !== "all") {
      filtered = filtered.filter((log) => log.level === levelFilter);
    }

    // Apply action filter
    if (actionFilter !== "all") {
      filtered = filtered.filter((log) => log.action === actionFilter);
    }

    // Apply connection filter
    if (connectionFilter !== "all") {
      filtered = filtered.filter(
        (log) => log.connectionName === connectionFilter,
      );
    }

    // Apply date filter
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

    // Apply text search across relevant fields
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
      // Periodically refresh logs while the viewer is open
      const interval = setInterval(loadLogs, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [isOpen, loadLogs]);

  useEffect(() => {
    filterLogs();
  }, [filterLogs]);

  const clearLogs = () => {
    setShowClearConfirm(true);
  };

  const confirmClearLogs = () => {
    settingsManager.clearActionLog();
    setLogs([]);
    setShowClearConfirm(false);
  };

  const exportLogs = () => {
    try {
      // Build CSV rows including a header
      const csvContent = [
        "Timestamp,Level,Action,Connection,Details,Duration",
        ...filteredLogs.map(
          (log) =>
            `"${log.timestamp.toISOString()}","${log.level}","${log.action}","${log.connectionName || ""}","${log.details.replace(/"/g, '""')}","${log.duration || ""}"`,
        ),
      ].join("\n");

      // Create a downloadable Blob and trigger browser download
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

  const getLevelIcon = (level: string) => LEVEL_ICONS[level] ?? DEFAULT_ICON;

  const getLevelColor = (level: string) => {
    return LEVEL_COLORS[level] ?? "text-[var(--color-textSecondary)]";
  };

  if (!isOpen) return null;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        backdropClassName="bg-black/50"
        panelClassName="max-w-6xl h-[90vh] rounded-lg overflow-hidden"
        contentClassName="bg-[var(--color-surface)] relative"
      >
        <div className="flex flex-1 min-h-0 flex-col">
          {/* Header */}
          <div className="border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <ScrollText size={20} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text)]">
                  {t("logs.title")}
                </h2>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  {logs.length} total entries
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-border)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={18} />
            </button>
          </div>

          {/* Secondary Toolbar */}
          <div className="border-b border-[var(--color-border)] px-4 py-3 bg-gray-750 space-y-3">
            {/* Row 1: Search and Actions */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)]"
                />
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 text-sm transition-all"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-textSecondary)] px-2 py-1 bg-[var(--color-border)]/50 rounded-lg">
                  {filteredLogs.length} of {logs.length}
                </span>
                <button
                  onClick={exportLogs}
                  className="sor-option-chip text-sm"
                >
                  <Download size={14} />
                  <span>{t("logs.export")}</span>
                </button>
                <button
                  onClick={clearLogs}
                  className="sor-option-chip text-sm hover:bg-red-600 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-red-500"
                >
                  <Trash2 size={14} />
                  <span>{t("logs.clear")}</span>
                </button>
              </div>
            </div>

            {/* Row 2: Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] uppercase tracking-wider">
                <Filter size={14} />
                <span>Filters</span>
              </div>

              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="px-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer hover:border-[var(--color-border)]"
                title="Filter by level"
              >
                <option value="all">All Levels</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>

              {uniqueActions.length > 0 && (
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="px-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer hover:border-[var(--color-border)] max-w-[180px]"
                  title="Filter by action"
                >
                  <option value="all">All Actions</option>
                  {uniqueActions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              )}

              {uniqueConnections.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Server size={14} className="text-gray-500" />
                  <select
                    value={connectionFilter}
                    onChange={(e) => setConnectionFilter(e.target.value)}
                    className="px-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer hover:border-[var(--color-border)] max-w-[160px]"
                    title="Filter by connection"
                  >
                    <option value="all">All Connections</option>
                    {uniqueConnections.map((conn) => (
                      <option key={conn} value={conn}>
                        {conn}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <Calendar size={14} className="text-gray-500" />
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer hover:border-[var(--color-border)]"
                  title="Filter by date"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">Last 7 Days</option>
                  <option value="month">Last 30 Days</option>
                </select>
              </div>

              {(levelFilter !== "all" ||
                actionFilter !== "all" ||
                connectionFilter !== "all" ||
                dateFilter !== "all" ||
                searchTerm) && (
                <button
                  onClick={() => {
                    setLevelFilter("all");
                    setActionFilter("all");
                    setConnectionFilter("all");
                    setDateFilter("all");
                    setSearchTerm("");
                  }}
                  className="sor-option-chip text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                >
                  <X size={12} />
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Log Table */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="sor-data-table w-full">
              <thead className="bg-[var(--color-border)] sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    <div className="flex items-center space-x-1">
                      <Clock size={12} />
                      <span>{t("logs.timestamp")}</span>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    {t("logs.level")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    {t("logs.action")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    {t("logs.connection")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    {t("logs.details")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--color-border)]">
                    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                      <div>
                        <div>{log.timestamp.toLocaleDateString()}</div>
                        <div className="text-xs text-gray-500">
                          {log.timestamp.toLocaleTimeString()}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div
                        className={`flex items-center space-x-2 ${getLevelColor(log.level)}`}
                      >
                        {getLevelIcon(log.level)}
                        <span className="capitalize">{log.level}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text)] font-medium">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                      {log.connectionName || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] max-w-md">
                      <div className="truncate" title={log.details}>
                        {log.details}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                      {log.duration ? `${log.duration}ms` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredLogs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--color-textSecondary)]">
                <AlertCircle size={48} className="mb-4" />
                <p className="text-lg font-medium mb-2">No log entries found</p>
                <p className="text-sm">
                  Try adjusting your search or filter criteria
                </p>
              </div>
            )}
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        isOpen={showClearConfirm}
        title={t("logs.clearConfirmTitle") || "Clear Action Log"}
        message={
          t("logs.clearConfirmMessage") ||
          "Are you sure you want to clear all log entries? This action cannot be undone."
        }
        confirmText={t("logs.clear") || "Clear"}
        cancelText={t("common.cancel") || "Cancel"}
        onConfirm={confirmClearLogs}
        onCancel={() => setShowClearConfirm(false)}
        variant="danger"
      />
    </>
  );
};
