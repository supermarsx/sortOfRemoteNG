import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { useTranslation } from "react-i18next";

interface ErrorLogEntry {
  id: string;
  timestamp: Date;
  level: "error" | "warn" | "info" | "debug";
  message: string;
  stack?: string;
  source?: string;
}

interface ErrorLogBarProps {
  isVisible: boolean;
  onToggle: () => void;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

const LEVEL_ICONS: Record<string, JSX.Element> = {
  error: <AlertCircle className="text-red-400" size={14} />,
  warn: <AlertTriangle className="text-yellow-400" size={14} />,
  info: <Info className="text-blue-400" size={14} />,
  debug: <Bug className="text-gray-400" size={14} />,
};

const LEVEL_COLORS: Record<string, string> = {
  error: "text-red-400 bg-red-900/20 border-red-800",
  warn: "text-yellow-400 bg-yellow-900/20 border-yellow-800",
  info: "text-blue-400 bg-blue-900/20 border-blue-800",
  debug: "text-gray-400 bg-gray-800/50 border-gray-700",
};

export const ErrorLogBar: React.FC<ErrorLogBarProps> = ({
  isVisible,
  onToggle,
}) => {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ErrorLogEntry | null>(null);
  const originalConsoleError = useRef<typeof console.error | null>(null);
  const originalConsoleWarn = useRef<typeof console.warn | null>(null);

  const addError = useCallback((entry: Omit<ErrorLogEntry, "id" | "timestamp">) => {
    setErrors((prev) => {
      const newEntry: ErrorLogEntry = {
        ...entry,
        id: generateId(),
        timestamp: new Date(),
      };
      // Keep last 100 errors
      return [newEntry, ...prev].slice(0, 100);
    });
  }, []);

  useEffect(() => {
    // Intercept console.error
    originalConsoleError.current = console.error;
    console.error = (...args: unknown[]) => {
      originalConsoleError.current?.apply(console, args);
      
      const message = args.map(arg => {
        if (arg instanceof Error) {
          return arg.message;
        }
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(" ");

      const stack = args.find(arg => arg instanceof Error)?.stack;

      addError({
        level: "error",
        message,
        stack,
        source: "console",
      });
    };

    // Intercept console.warn
    originalConsoleWarn.current = console.warn;
    console.warn = (...args: unknown[]) => {
      originalConsoleWarn.current?.apply(console, args);
      
      const message = args.map(arg => {
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(" ");

      addError({
        level: "warn",
        message,
        source: "console",
      });
    };

    // Listen for unhandled errors
    const handleError = (event: ErrorEvent) => {
      addError({
        level: "error",
        message: event.message,
        stack: event.error?.stack,
        source: `${event.filename}:${event.lineno}:${event.colno}`,
      });
    };

    // Listen for unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      addError({
        level: "error",
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        source: "Unhandled Promise Rejection",
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      // Restore original console methods
      if (originalConsoleError.current) {
        console.error = originalConsoleError.current;
      }
      if (originalConsoleWarn.current) {
        console.warn = originalConsoleWarn.current;
      }
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [addError]);

  const clearErrors = () => {
    setErrors([]);
    setSelectedEntry(null);
  };

  const copyToClipboard = (entry: ErrorLogEntry) => {
    const text = `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`;
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const errorCount = errors.filter((e) => e.level === "error").length;
  const warnCount = errors.filter((e) => e.level === "warn").length;

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 border-t border-gray-700 shadow-lg">
      {/* Header bar - always visible when error log is enabled */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-gray-800 cursor-pointer hover:bg-gray-750"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <Bug size={16} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">
            {t("errorLog.title", "Error Log")}
          </span>
          {errorCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-red-900/50 text-red-400 border border-red-800">
              {errorCount} {errorCount === 1 ? "error" : "errors"}
            </span>
          )}
          {warnCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-900/50 text-yellow-400 border border-yellow-800">
              {warnCount} {warnCount === 1 ? "warning" : "warnings"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              clearErrors();
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title={t("errorLog.clear", "Clear all")}
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title={t("errorLog.hide", "Hide error log")}
          >
            <X size={14} />
          </button>
          {isExpanded ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronUp size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {/* Expanded error list */}
      {isExpanded && (
        <div className="max-h-64 overflow-y-auto">
          {errors.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              {t("errorLog.noErrors", "No errors recorded")}
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {errors.map((entry) => (
                <div
                  key={entry.id}
                  className={`px-4 py-2 cursor-pointer hover:bg-gray-800/50 transition-colors ${
                    selectedEntry?.id === entry.id ? "bg-gray-800" : ""
                  }`}
                  onClick={() =>
                    setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)
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
                            : "text-gray-300"
                        }`}
                      >
                        {entry.message}
                      </p>
                      {selectedEntry?.id === entry.id && entry.stack && (
                        <pre className="mt-2 p-2 text-xs bg-gray-950 rounded overflow-x-auto text-gray-400 font-mono">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(entry);
                      }}
                      className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title={t("common.copy", "Copy")}
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
