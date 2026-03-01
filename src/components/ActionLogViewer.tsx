import React from "react";
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
import { ConfirmDialog } from "./ConfirmDialog";
import { useActionLogViewer } from "../hooks/monitoring/useActionLogViewer";
import { Modal } from "./ui/overlays/Modal";import { DialogHeader } from './ui/overlays/DialogHeader';import { EmptyState } from './ui/display';import { Select } from './ui/forms';

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

const getLevelIcon = (level: string) => LEVEL_ICONS[level] ?? DEFAULT_ICON;
const getLevelColor = (level: string) =>
  LEVEL_COLORS[level] ?? "text-[var(--color-textSecondary)]";

interface ActionLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mgr = ReturnType<typeof useActionLogViewer>;

/* ---------- sub-components ---------- */

function ViewerHeader({ m, onClose }: { m: Mgr; onClose: () => void }) {
  return (
    <DialogHeader
      icon={ScrollText}
      iconColor="text-amber-400"
      iconBg="bg-amber-500/20"
      title={m.t("logs.title")}
      subtitle={`${m.logs.length} total entries`}
      onClose={onClose}
    />
  );
}

function SearchBar({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="relative flex-1 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--color-textSecondary)]" />
        <input type="text" placeholder="Search logs..." value={m.searchTerm} onChange={(e) => m.setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 text-sm transition-all" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--color-textSecondary)] px-2 py-1 bg-[var(--color-border)]/50 rounded-lg">{m.filteredLogs.length} of {m.logs.length}</span>
        <button onClick={m.exportLogs} className="sor-option-chip text-sm"><Download size={14} /><span>{m.t("logs.export")}</span></button>
        <button onClick={m.clearLogs} className="sor-option-chip text-sm hover:bg-red-600 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:border-red-500"><Trash2 size={14} /><span>{m.t("logs.clear")}</span></button>
      </div>
    </div>
  );
}

function FilterBar({ m }: { m: Mgr }) {
  const selectCls = "px-3 py-1.5 bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all cursor-pointer hover:border-[var(--color-border)]";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)] uppercase tracking-wider"><Filter size={14} /><span>Filters</span></div>
      <Select value={m.levelFilter} onChange={(v: string) => m.setLevelFilter(v)} options={[{ value: "all", label: "All Levels" }, { value: "debug", label: "Debug" }, { value: "info", label: "Info" }, { value: "warn", label: "Warning" }, { value: "error", label: "Error" }]} className="selectCls" />
      {m.uniqueActions.length > 0 && (
        <Select value={m.actionFilter} onChange={(v: string) => m.setActionFilter(v)} options={[{ value: 'all', label: 'All Actions' }, ...m.uniqueActions.map((a) => ({ value: a, label: a }))]} className={`${selectCls} max-w-[180px]`} title="Filter by action" />
      )}
      {m.uniqueConnections.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Server size={14} className="text-gray-500" />
          <Select value={m.connectionFilter} onChange={(v: string) => m.setConnectionFilter(v)} options={[{ value: 'all', label: 'All Connections' }, ...m.uniqueConnections.map((c) => ({ value: c, label: c }))]} className={`${selectCls} max-w-[160px]`} title="Filter by connection" />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Calendar size={14} className="text-gray-500" />
        <Select value={m.dateFilter} onChange={(v: string) => m.setDateFilter(v)} options={[{ value: "all", label: "All Time" }, { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "Last 7 Days" }, { value: "month", label: "Last 30 Days" }]} className="selectCls" />
      </div>
      {m.hasActiveFilters && (
        <button onClick={m.resetFilters} className="sor-option-chip text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"><X size={12} />Clear filters</button>
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
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider"><div className="flex items-center space-x-1"><Clock size={12} /><span>{m.t("logs.timestamp")}</span></div></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">{m.t("logs.level")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">{m.t("logs.action")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">{m.t("logs.connection")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">{m.t("logs.details")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {m.filteredLogs.map((log) => (
            <tr key={log.id} className="hover:bg-[var(--color-border)]">
              <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]"><div><div>{log.timestamp.toLocaleDateString()}</div><div className="text-xs text-gray-500">{log.timestamp.toLocaleTimeString()}</div></div></td>
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
      <Modal isOpen={isOpen} onClose={onClose} backdropClassName="bg-black/50" panelClassName="max-w-6xl h-[90vh] rounded-lg overflow-hidden" contentClassName="bg-[var(--color-surface)] relative">
        <div className="flex flex-1 min-h-0 flex-col">
          <ViewerHeader m={m} onClose={onClose} />
          <div className="border-b border-[var(--color-border)] px-4 py-3 bg-gray-750 space-y-3">
            <SearchBar m={m} />
            <FilterBar m={m} />
          </div>
          <LogTable m={m} />
        </div>
      </Modal>
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
