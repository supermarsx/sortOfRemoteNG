/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, { useEffect, useState, useRef } from "react";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  X,
} from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info" | "loading";

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  progress?: { completed: number; total: number };
  progressLabel?: string;
  description?: string;
  /** Operation clock is independent of the notification's dismissal timer. */
  startedAt?: number;
  finishedAt?: number;
  /** Approximate deadline from measured work; null means no estimate is available. */
  etaAt?: number | null;
  details?: string[];
  /** Provider-owned update counter: refreshes the completion expiry once. */
  revision?: number;
}

export type ToastUpdate = Partial<
  Pick<
    ToastMessage,
    | "type"
    | "message"
    | "duration"
    | "progress"
    | "details"
    | "progressLabel"
    | "description"
    | "etaAt"
  >
>;

function operationDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m ${seconds % 60}s`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

interface ToastProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

const TOAST_CONFIG: Record<
  ToastType,
  {
    icon: React.ReactNode;
    barColor: string;
    iconBg: string;
  }
> = {
  loading: {
    icon: <Loader2 size={16} className="animate-spin" aria-hidden="true" />,
    barColor: "var(--color-primary)",
    iconBg: "rgb(var(--color-primary-rgb) / 0.15)",
  },
  success: {
    icon: <CheckCircle size={16} />,
    barColor: "var(--color-success)",
    iconBg: "rgb(var(--color-success-rgb) / 0.15)",
  },
  error: {
    icon: <XCircle size={16} />,
    barColor: "var(--color-error)",
    iconBg: "rgb(var(--color-error-rgb) / 0.15)",
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    barColor: "var(--color-warning)",
    iconBg: "rgb(var(--color-warning-rgb) / 0.15)",
  },
  info: {
    icon: <Info size={16} />,
    barColor: "var(--color-primary)",
    iconBg: "rgb(var(--color-primary-rgb) / 0.15)",
  },
};

export const Toast: React.FC<ToastProps> = ({ toast, onRemove }) => {
  const [exitingRevision, setExitingRevision] = useState<number | null>(null);
  const remainingRef = useRef(toast.duration ?? 4000);
  const startRef = useRef(Date.now());
  const pausedRef = useRef(false);
  const exitingRef = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const removedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const removeRef = useRef(onRemove);
  removeRef.current = onRemove;

  const duration = toast.duration ?? 4000;
  const config = TOAST_CONFIG[toast.type];
  const revision = toast.revision ?? 0;
  const isExiting = exitingRevision === revision;
  const isLoading = toast.type === "loading";
  const [operationNow, setOperationNow] = useState(Date.now);
  const hasOperationClock = Number.isFinite(toast.startedAt);
  useEffect(() => {
    if (!isLoading || !hasOperationClock) return;
    // One low-frequency timer per visible operation, never a render/expiry loop.
    const timer = setInterval(() => setOperationNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isLoading, hasOperationClock, toast.id]);
  const clockNow =
    toast.finishedAt ?? Math.max(operationNow, toast.startedAt ?? 0);
  const eta =
    toast.etaAt == null
      ? toast.etaAt === null
        ? "ETA unavailable"
        : "ETA estimating…"
      : toast.etaAt > clockNow
        ? `ETA ~${operationDuration(Math.ceil((toast.etaAt - clockNow) / 1000) * 1000)}`
        : "ETA recalculating…";
  const progress = toast.progress;
  const progressPercent =
    progress && progress.total > 0
      ? Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))
      : undefined;

  // Loading notifications have no expiry loop. Explicit updates start a fresh
  // final expiry; ordinary renders and the exit animation do not reset it.
  useEffect(() => {
    // Reset on effect re-run (React StrictMode double-invokes effects:
    // cleanup sets removedRef=true, so we must reset it here).
    removedRef.current = false;
    exitingRef.current = false;
    remainingRef.current = duration;
    startRef.current = Date.now();

    const cleanup = () => {
      cancelAnimationFrame(rafRef.current);
      removedRef.current = true;
      clearTimeout(closeTimerRef.current);
    };
    if (isLoading || duration === 0) return cleanup;

    const tick = () => {
      if (removedRef.current) return;

      if (pausedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const elapsed = Date.now() - startRef.current;
      const remaining = remainingRef.current - elapsed;
      const pct = Math.max(0, remaining / duration);

      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${pct})`;
      }

      if (remaining <= 300 && !exitingRef.current) {
        exitingRef.current = true;
        setExitingRevision(revision);
      }

      if (remaining <= 0) {
        removedRef.current = true;
        removeRef.current(toast.id);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return cleanup;
  }, [duration, isLoading, revision, toast.id]);

  // When pausing/resuming, snapshot remaining time
  const handleMouseEnter = () => {
    if (isLoading || pausedRef.current) return;
    const elapsed = Date.now() - startRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    pausedRef.current = true;
  };

  const handleMouseLeave = () => {
    startRef.current = Date.now();
    pausedRef.current = false;
  };

  const handleClose = () => {
    setExitingRevision(revision);
    cancelAnimationFrame(rafRef.current);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => removeRef.current(toast.id), 250);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`toast-item group relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl shadow-black/20 backdrop-blur-sm transition-all duration-250 ${
        isExiting
          ? "opacity-0 translate-x-8 scale-95"
          : "opacity-100 translate-x-0 scale-100"
      }`}
      style={{ minWidth: 280, maxWidth: 380 }}
      aria-busy={isLoading || undefined}
    >
      {/* Content */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md mt-px"
          style={{ background: config.iconBg, color: config.barColor }}
        >
          {config.icon}
        </div>
        <p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-[var(--color-text)] text-[13px] leading-snug py-1">
          {toast.message}
        </p>
        {!isLoading && (
          <button
            onClick={handleClose}
            aria-label="Dismiss notification"
            className="flex-shrink-0 mt-0.5 p-0.5 rounded text-[var(--color-textMuted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {(toast.description || toast.progressLabel || hasOperationClock) && (
        <div className="px-3 pb-2 space-y-1 text-xs text-[var(--color-textSecondary)]">
          {toast.description && (
            <p className="break-words [overflow-wrap:anywhere]">
              {toast.description}
            </p>
          )}
          {toast.progressLabel && <p>{toast.progressLabel}</p>}
          {hasOperationClock && (
            <div
              className="flex flex-wrap justify-between gap-x-3 gap-y-1 tabular-nums"
              aria-live="off"
              data-testid="operation-timing"
            >
              <span>
                Elapsed {operationDuration(clockNow - toast.startedAt!)}
              </span>
              {isLoading && (
                <span title="Approximate remaining time based on completed operations; database sizes and cleanup can vary.">
                  {eta}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {toast.details && toast.details.length > 0 && (
        <details className="px-3 pb-2 text-xs text-[var(--color-text)]">
          <summary className="cursor-pointer py-1">
            View details ({toast.details.length})
          </summary>
          <ul className="min-w-0 max-h-40 space-y-1 overflow-y-auto break-words [overflow-wrap:anywhere] pt-1">
            {toast.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Operation progress never shares the timer/expiry animation. */}
      <div
        className={`${isLoading || progress ? "h-1" : "h-[2px]"} w-full bg-[var(--color-border)]/40`}
        role={progress || isLoading ? "progressbar" : undefined}
        aria-label={progress || isLoading ? "Operation progress" : undefined}
        aria-valuemin={progress ? 0 : undefined}
        aria-valuemax={progress ? 100 : undefined}
        aria-valuenow={progress ? progressPercent : undefined}
        aria-valuetext={progress ? toast.progressLabel : undefined}
      >
        <div
          ref={progress || isLoading ? undefined : barRef}
          className={`h-full origin-left ${isLoading && progressPercent === undefined ? "motion-safe:animate-pulse" : ""}`}
          style={{
            background: config.barColor,
            transform: `scaleX(${progressPercent === undefined ? (isLoading ? 0.35 : 1) : progressPercent / 100})`,
            willChange: "transform",
          }}
        />
      </div>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onRemove,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2"
      role="status"
      aria-live="polite"
      style={{ maxWidth: 380 }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
};

// Hook to manage toasts
export const useToast = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: ToastType, message: string, duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const toast = {
    success: (message: string, duration?: number) =>
      addToast("success", message, duration),
    error: (message: string, duration?: number) =>
      addToast("error", message, duration),
    warning: (message: string, duration?: number) =>
      addToast("warning", message, duration),
    info: (message: string, duration?: number) =>
      addToast("info", message, duration),
  };

  return { toasts, toast, removeToast };
};
