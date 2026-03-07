import React, { useEffect } from 'react';
import { Modal, ModalBody, ModalHeader } from '../overlays/Modal';

export interface ConfirmDialogProps {
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
      if (e.key === 'Enter') {
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      closeOnBackdrop={Boolean(onCancel)}
      closeOnEscape={Boolean(onCancel)}
      panelClassName="max-w-md mx-4"
    >
      <ModalHeader
        title={title}
        onClose={onCancel}
        showCloseButton={Boolean(onCancel)}
      />
      <ModalBody className="p-6">
        <p className="text-[var(--color-text)] mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          {onCancel && (
            <button
              onClick={onCancel}
              className="sor-modal-cancel"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-[var(--color-text)] rounded-md transition-colors ${
              variant === 'danger'
                ? 'bg-error hover:bg-error/90'
                : variant === 'warning'
                ? 'bg-warning hover:bg-warning/90'
                : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default ConfirmDialog;
