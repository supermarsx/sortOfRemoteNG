import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel?: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  message,
  title = 'Confirmation',
  confirmText = 'OK',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && onCancel) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full max-w-md mx-4 relative">
        <div className="relative h-12 border-b border-[var(--color-border)]">
          <h2 className="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              className="absolute right-3 top-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div className="p-6">
          <p className="text-[var(--color-text)] mb-6">{message}</p>
          <div className="flex justify-end space-x-3">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-[var(--color-text)] rounded-md transition-colors ${
                variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700'
                  : variant === 'warning'
                  ? 'bg-yellow-600 hover:bg-yellow-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
