import React from "react";
import {
  X,
  Download,
  Filter,
  Trash2,
  Search,
  Clock,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug,
  Calendar,
  Server,
} from "lucide-react";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import { useActionLogViewer } from "../../hooks/monitoring/useActionLogViewer";
import { EmptyState } from '../ui/display';import { Select } from '../ui/forms';

const LEVEL_ICONS: Record<string, JSX.Element> = {
  debug: <Bug className="text-[var(--color-textSecondary)]" size={14} />,
  info: <Info className="text-primary" size={14} />,
  warn: <AlertTriangle className="text-warning" size={14} />,
  error: <AlertCircle className="text-error" size={14} />,
};

const DEFAULT_ICON = (
  <Info className="text-[var(--color-textSecondary)]" size={14} />
);

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-[var(--color-textSecondary)]",
  info: "text-primary",
  warn: "text-warning",
  error: "text-error",
};

const getLevelIcon = (level: string) => LEVEL_ICONS[level] ?? DEFAULT_ICON;
const getLevelColor = (level: string) =>
  LEVEL_COLORS[level] ?? "text-[var(--color-textSecondary)]";

interface ActionLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mgr = ReturnType<typeof useActionLogViewer>;

/* ---------- sub-components ---------- */

function SearchBar({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="relative flex-1 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)]" />
        <input type="text" placeholder="Search logs..." value={m.searchTerm} onChange={(e) => m.setSearchTerm(e.target.value)} aria-label="Search logs" className="sor-form-input w-full pl-9" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--color-textSecondary)] px-2 py-1 bg-[var(--color-border)]/50 rounded-lg">{m.filteredLogs.length} of {m.logs.length}</span>
        <button onClick={m.exportLogs} className="sor-option-chip text-sm"><Download size={14} /><span>{m.t("logs.export")}</span></button>
        <button onClick={m.clearLogs} className="sor-option-chip text-sm hover:bg-error/90 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-error"><Trash2 size={14} /><span>{m.t("logs.clear")}</span></button>
      </div>
    </div>
  );
}

function FilterBar({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] uppercase tracking-wider"><Filter size={14} /><span>Filters</span></div>
      <Select value={m.levelFilter} onChange={(v: string) => m.setLevelFilter(v)} variant="form-sm" options={[{ value: "all", label: "All Levels" }, { value: "debug", label: "Debug" }, { value: "info", label: "Info" }, { value: "warn", label: "Warning" }, { value: "error", label: "Error" }]} />
      {m.uniqueActions.length > 0 && (
        <Select value={m.actionFilter} onChange={(v: string) => m.setActionFilter(v)} variant="form-sm" options={[{ value: 'all', label: 'All Actions' }, ...m.uniqueActions.map((a) => ({ value: a, label: a }))]} title="Filter by action" />
      )}
      {m.uniqueConnections.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Server size={14} className="text-[var(--color-textMuted)]" />
          <Select value={m.connectionFilter} onChange={(v: string) => m.setConnectionFilter(v)} variant="form-sm" options={[{ value: 'all', label: 'All Connections' }, ...m.uniqueConnections.map((c) => ({ value: c, label: c }))]} title="Filter by connection" />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Calendar size={14} className="text-[var(--color-textMuted)]" />
        <Select value={m.dateFilter} onChange={(v: string) => m.setDateFilter(v)} variant="form-sm" options={[{ value: "all", label: "All Time" }, { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "Last 7 Days" }, { value: "month", label: "Last 30 Days" }]} />
      </div>
      {m.hasActiveFilters && (
        <button onClick={m.resetFilters} className="sor-option-chip text-xs text-warning hover:text-warning hover:bg-warning/10"><X size={12} />Clear filters</button>
      )}
    </div>
  );
}

function LogTable({ m }: { m: Mgr }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <table className="sor-data-table w-full">
        <thead className="bg-[var(--color-border)] sticky top-0">
          <tr>
            <th className="sor-th"><div className="flex items-center space-x-1"><Clock size={12} /><span>{m.t("logs.timestamp")}</span></div></th>
            <th className="sor-th">{m.t("logs.level")}</th>
            <th className="sor-th">{m.t("logs.action")}</th>
            <th className="sor-th">{m.t("logs.connection")}</th>
            <th className="sor-th">{m.t("logs.details")}</th>
            <th className="sor-th">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {m.filteredLogs.map((log) => (
            <tr key={log.id} className="hover:bg-[var(--color-border)]">
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]"><div><div>{new Date(log.timestamp).toLocaleDateString()}</div><div className="text-xs text-[var(--color-textMuted)]">{new Date(log.timestamp).toLocaleTimeString()}</div></div></td>
              <td className="px-4 py-3 text-sm"><div className={`flex items-center space-x-2 ${getLevelColor(log.level)}`}>{getLevelIcon(log.level)}<span className="capitalize">{log.level}</span></div></td>
              <td className="px-4 py-3 text-sm text-[var(--color-text)] font-medium">{log.action}</td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">{log.connectionName || "-"}</td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)] max-w-md"><div className="truncate" title={log.details}>{log.details}</div></td>
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">{log.duration ? `${log.duration}ms` : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.filteredLogs.length === 0 && (
        <EmptyState
          icon={AlertCircle}
          iconSize={48}
          message="No log entries found"
          hint="Try adjusting your search or filter criteria"
        />
      )}
    </div>
  );
}

/* ---------- root ---------- */

export const ActionLogViewer: React.FC<ActionLogViewerProps> = ({ isOpen, onClose }) => {
  const m = useActionLogViewer(isOpen);

  if (!isOpen) return null;

  return (
    <>
      <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3 space-y-3">
          <SearchBar m={m} />
          <FilterBar m={m} />
        </div>
        <LogTable m={m} />
      </div>
      <ConfirmDialog
        isOpen={m.showClearConfirm}
        title={m.t("logs.clearConfirmTitle") || "Clear Action Log"}
        message={m.t("logs.clearConfirmMessage") || "Are you sure you want to clear all log entries? This action cannot be undone."}
        confirmText={m.t("logs.clear") || "Clear"}
        cancelText={m.t("common.cancel") || "Cancel"}
        onConfirm={m.confirmClearLogs}
        onCancel={() => m.setShowClearConfirm(false)}
        variant="danger"
      />
    </>
  );
};
