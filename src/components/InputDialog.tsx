import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalBody, ModalHeader } from './ui/Modal';

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
      if (e.key === 'Enter') {
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
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      closeOnBackdrop
      closeOnEscape
      panelClassName="max-w-md mx-4"
    >
      <ModalHeader title={title} onClose={onCancel} />
      <ModalBody className="p-6">
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
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-text)] rounded-md transition-colors text-sm"
          >
            {confirmText}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default InputDialog;
