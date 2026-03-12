/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage;
  onRemove: (id: string) => void;
}

const TOAST_CONFIG: Record<ToastType, {
  icon: React.ReactNode;
  barColor: string;
  iconBg: string;
}> = {
  success: {
    icon: <CheckCircle size={16} />,
    barColor: 'var(--color-success)',
    iconBg: 'rgb(var(--color-success-rgb) / 0.15)',
  },
  error: {
    icon: <XCircle size={16} />,
    barColor: 'var(--color-error)',
    iconBg: 'rgb(var(--color-error-rgb) / 0.15)',
  },
  warning: {
    icon: <AlertTriangle size={16} />,
    barColor: 'var(--color-warning)',
    iconBg: 'rgb(var(--color-warning-rgb) / 0.15)',
  },
  info: {
    icon: <Info size={16} />,
    barColor: 'var(--color-primary)',
    iconBg: 'rgb(var(--color-primary-rgb) / 0.15)',
  },
};

export const Toast: React.FC<ToastProps> = ({ toast, onRemove }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const remainingRef = useRef(toast.duration ?? 4000);
  const startRef = useRef(Date.now());
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const duration = toast.duration ?? 4000;
  const config = TOAST_CONFIG[toast.type];

  // Animate the expiry bar with rAF for smoothness
  useEffect(() => {
    startRef.current = Date.now();

    const tick = () => {
      if (isPaused) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = Date.now() - startRef.current;
      const remaining = remainingRef.current - elapsed;
      const pct = Math.max(0, remaining / duration);

      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${pct})`;
      }

      if (remaining <= 300 && !isExiting) {
        setIsExiting(true);
      }
      if (remaining <= 0) {
        onRemove(toast.id);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPaused, isExiting, duration, toast.id, onRemove]);

  // When pausing/resuming, snapshot remaining time
  const handleMouseEnter = () => {
    const elapsed = Date.now() - startRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    setIsPaused(true);
  };

  const handleMouseLeave = () => {
    startRef.current = Date.now();
    setIsPaused(false);
  };

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 250);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`toast-item group relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl shadow-black/20 backdrop-blur-sm transition-all duration-250 ${
        isExiting
          ? 'opacity-0 translate-x-8 scale-95'
          : 'opacity-100 translate-x-0 scale-100'
      }`}
      style={{ minWidth: 280, maxWidth: 380 }}
    >
      {/* Content */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md mt-px"
          style={{ background: config.iconBg, color: config.barColor }}
        >
          {config.icon}
        </div>
        <p className="text-[var(--color-text)] text-[13px] leading-snug flex-1 py-1">
          {toast.message}
        </p>
        <button
          onClick={handleClose}
          className="flex-shrink-0 mt-0.5 p-0.5 rounded text-[var(--color-textMuted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors opacity-0 group-hover:opacity-100"
        >
          <X size={14} />
        </button>
      </div>

      {/* Expiry progress bar */}
      <div className="h-[2px] w-full bg-[var(--color-border)]/40">
        <div
          ref={barRef}
          className="h-full origin-left"
          style={{
            background: config.barColor,
            transform: 'scaleX(1)',
            willChange: 'transform',
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

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2" style={{ maxWidth: 380 }}>
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
    success: (message: string, duration?: number) => addToast('success', message, duration),
    error: (message: string, duration?: number) => addToast('error', message, duration),
    warning: (message: string, duration?: number) => addToast('warning', message, duration),
    info: (message: string, duration?: number) => addToast('info', message, duration),
  };

  return { toasts, toast, removeToast };
};
