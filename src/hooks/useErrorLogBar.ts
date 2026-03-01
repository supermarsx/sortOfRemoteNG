import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface ErrorLogEntry {
  id: string;
  timestamp: Date;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  stack?: string;
  source?: string;
}

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useErrorLogBar() {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ErrorLogEntry | null>(null);
  const originalConsoleError = useRef<typeof console.error | null>(null);
  const originalConsoleWarn = useRef<typeof console.warn | null>(null);

  const addError = useCallback(
    (entry: Omit<ErrorLogEntry, 'id' | 'timestamp'>) => {
      queueMicrotask(() => {
        setErrors((prev) => {
          const newEntry: ErrorLogEntry = {
            ...entry,
            id: generateId(),
            timestamp: new Date(),
          };
          return [newEntry, ...prev].slice(0, 100);
        });
      });
    },
    [],
  );

  useEffect(() => {
    originalConsoleError.current = console.error;
    console.error = (...args: unknown[]) => {
      originalConsoleError.current?.apply(console, args);
      const message = args
        .map((arg) => {
          if (arg instanceof Error) return arg.message;
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');
      const stack = (args.find((arg) => arg instanceof Error) as Error | undefined)?.stack;
      addError({ level: 'error', message, stack, source: 'console' });
    };

    originalConsoleWarn.current = console.warn;
    console.warn = (...args: unknown[]) => {
      originalConsoleWarn.current?.apply(console, args);
      const message = args
        .map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');
      addError({ level: 'warn', message, source: 'console' });
    };

    const handleError = (event: ErrorEvent) => {
      addError({
        level: 'error',
        message: event.message,
        stack: event.error?.stack,
        source: `${event.filename}:${event.lineno}:${event.colno}`,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      addError({
        level: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        source: 'Unhandled Promise Rejection',
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      if (originalConsoleError.current) console.error = originalConsoleError.current;
      if (originalConsoleWarn.current) console.warn = originalConsoleWarn.current;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [addError]);

  const clearErrors = useCallback(() => {
    setErrors([]);
    setSelectedEntry(null);
  }, []);

  const copyToClipboard = useCallback((entry: ErrorLogEntry) => {
    const text = `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`;
    navigator.clipboard.writeText(text).catch(console.error);
  }, []);

  const errorCount = errors.filter((e) => e.level === 'error').length;
  const warnCount = errors.filter((e) => e.level === 'warn').length;

  return {
    t,
    errors,
    isExpanded,
    setIsExpanded,
    selectedEntry,
    setSelectedEntry,
    clearErrors,
    copyToClipboard,
    errorCount,
    warnCount,
  };
}
