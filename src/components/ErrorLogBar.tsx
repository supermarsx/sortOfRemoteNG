import React from "react";
import {
  X,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  Bug,
} from "lucide-react";
import { useErrorLogBar } from "../hooks/useErrorLogBar";

type Mgr = ReturnType<typeof useErrorLogBar>;

interface ErrorLogBarProps {
  isVisible: boolean;
  onToggle: () => void;
}

const LEVEL_ICONS: Record<string, JSX.Element> = {
  error: <AlertCircle className="text-red-400" size={14} />,
  warn: <AlertTriangle className="text-yellow-400" size={14} />,
  info: <Info className="text-blue-400" size={14} />,
  debug: <Bug className="text-[var(--color-textSecondary)]" size={14} />,
};

const LEVEL_COLORS: Record<string, string> = {
  error: "text-red-400 bg-red-900/20 border-red-800",
  warn: "text-yellow-400 bg-yellow-900/20 border-yellow-800",
  info: "text-blue-400 bg-blue-900/20 border-blue-800",
  debug: "text-[var(--color-textSecondary)] bg-[var(--color-surface)]/50 border-[var(--color-border)]",
};

export const ErrorLogBar: React.FC<ErrorLogBarProps> = ({
  isVisible,
  onToggle,
}) => {
  const mgr = useErrorLogBar();

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-background)] border-t border-[var(--color-border)] shadow-lg">
      {/* Header bar - always visible when error log is enabled */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] cursor-pointer hover:bg-gray-750"
        onClick={() => mgr.setIsExpanded(!mgr.isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Bug size={16} className="text-[var(--color-textSecondary)]" />
          <span className="text-sm font-medium text-[var(--color-textSecondary)]">
            {mgr.t("errorLog.title", "Error Log")}
          </span>
          {mgr.errorCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-red-900/50 text-red-400 border border-red-800">
              {mgr.errorCount} {mgr.errorCount === 1 ? "error" : "errors"}
            </span>
          )}
          {mgr.warnCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-900/50 text-yellow-400 border border-yellow-800">
              {mgr.warnCount} {mgr.warnCount === 1 ? "warning" : "warnings"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              mgr.clearErrors();
            }}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors"
            title={mgr.t("errorLog.clear", "Clear all")}
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors"
            title={mgr.t("errorLog.hide", "Hide error log")}
          >
            <X size={14} />
          </button>
          {mgr.isExpanded ? (
            <ChevronDown size={16} className="text-[var(--color-textSecondary)]" />
          ) : (
            <ChevronUp size={16} className="text-[var(--color-textSecondary)]" />
          )}
        </div>
      </div>

      {/* Expanded error list */}
      {mgr.isExpanded && (
        <div className="max-h-64 overflow-y-auto">
          {mgr.errors.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {mgr.t("errorLog.noErrors", "No errors recorded")}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {mgr.errors.map((entry) => (
                <div
                  key={entry.id}
                  className={`px-4 py-2 cursor-pointer hover:bg-[var(--color-surface)]/50 transition-colors ${
                    mgr.selectedEntry?.id === entry.id ? "bg-[var(--color-surface)]" : ""
                  }`}
                  onClick={() =>
                    mgr.setSelectedEntry(mgr.selectedEntry?.id === entry.id ? null : entry)
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{LEVEL_ICONS[entry.level]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {entry.timestamp.toLocaleTimeString()}
                        </span>
                        {entry.source && (
                          <span className="text-xs text-gray-600">
                            {entry.source}
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-sm truncate ${
                          entry.level === "error"
                            ? "text-red-300"
                            : entry.level === "warn"
                            ? "text-yellow-300"
                            : "text-[var(--color-textSecondary)]"
                        }`}
                      >
                        {entry.message}
                      </p>
                      {mgr.selectedEntry?.id === entry.id && entry.stack && (
                        <pre className="mt-2 p-2 text-xs bg-gray-950 rounded overflow-x-auto text-[var(--color-textSecondary)] font-mono">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        mgr.copyToClipboard(entry);
                      }}
                      className="p-1 text-gray-500 hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded transition-colors"
                      title={mgr.t("common.copy", "Copy")}
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
