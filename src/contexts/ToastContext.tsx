/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import {
  ToastContainer,
  ToastMessage,
  ToastType,
  ToastUpdate,
} from "../components/ui/dialogs/Toast";

interface ToastContextType {
  toast: {
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    warning: (message: string, duration?: number) => string;
    info: (message: string, duration?: number) => string;
    loading: (message: string) => string;
    update: (id: string, patch: ToastUpdate) => void;
    remove: (id: string) => void;
  };
  removeAll: () => void;
}

// Exported so callers that want a non-throwing read (e.g. components
// that may render outside a ToastProvider in tests) can use
// `useContext(ToastContext)` directly and handle the `undefined`
// case themselves.
export const ToastContext = createContext<ToastContextType | undefined>(
  undefined,
);

interface ToastProviderProps {
  children: ReactNode;
}

const MAX_TOASTS = 5;

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (type: ToastType, message: string, duration?: number) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const startedAt = type === "loading" ? Date.now() : undefined;
      setToasts((prev) => {
        const next = [
          ...prev,
          {
            id,
            type,
            message,
            duration,
            ...(startedAt !== undefined ? { startedAt } : {}),
          },
        ];
        if (next.length <= MAX_TOASTS) return next;
        // Ordinary notifications never evict an operation that is still active.
        const disposable = next.findIndex((item) => item.type !== "loading");
        if (disposable < 0) return prev;
        return next.filter((_, index) => index !== disposable);
      });
      return id;
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const removeAll = useCallback(() => {
    setToasts([]);
  }, []);

  const updateToast = useCallback((id: string, patch: ToastUpdate) => {
    const updatedAt = Date.now();
    setToasts((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              ...(patch.type === "loading" && item.type !== "loading"
                ? {
                    startedAt: updatedAt,
                    finishedAt: undefined,
                    etaAt: patch.etaAt,
                  }
                : item.type === "loading" &&
                    patch.type &&
                    patch.type !== "loading"
                  ? { finishedAt: updatedAt, etaAt: undefined }
                  : {}),
              revision: (item.revision ?? 0) + 1,
            }
          : item,
      ),
    );
  }, []);

  const toast = useMemo(
    () => ({
      success: (message: string, duration?: number) =>
        addToast("success", message, duration),
      error: (message: string, duration?: number) =>
        addToast("error", message, duration),
      warning: (message: string, duration?: number) =>
        addToast("warning", message, duration),
      info: (message: string, duration?: number) =>
        addToast("info", message, duration),
      loading: (message: string) => addToast("loading", message),
      update: updateToast,
      remove: removeToast,
    }),
    [addToast, updateToast, removeToast],
  );

  const contextValue = useMemo(
    () => ({ toast, removeAll }),
    [toast, removeAll],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

export const useToastContext = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToastContext must be used within a ToastProvider");
  }
  return context;
};
