import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface InputDialogProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  /** Reject empty / whitespace-only values (default: true) */
  required?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title = 'Input',
  message,
  placeholder = '',
  defaultValue = '',
  confirmText = 'OK',
  cancelText = 'Cancel',
  required = true,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset value when dialog opens
  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // Focus the input after the DOM renders
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isOpen, defaultValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        if (!required || value.trim()) {
          onConfirm(value.trim());
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, value, required, onConfirm, onCancel]);

  if (!isOpen) return null;

  const canSubmit = !required || value.trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl w-full max-w-md mx-4 relative">
        <div className="relative h-12 border-b border-[var(--color-border)]">
          <h2 className="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="absolute right-3 top-2 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-6">
          {message && (
            <p className="text-[var(--color-textSecondary)] text-sm mb-3">{message}</p>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 bg-[var(--color-surfaceHover)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textSecondary)] focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <div className="flex justify-end space-x-3 mt-4">
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors text-sm"
            >
              {cancelText}
            </button>
            <button
              onClick={() => canSubmit && onConfirm(value.trim())}
              disabled={!canSubmit}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors text-sm"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InputDialog;
