import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const hasClassFragment = (value: string | undefined, fragment: string) =>
  Boolean(value && value.includes(fragment));

export interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  panelClassName?: string;
  contentClassName?: string;
  dataTestId?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  children,
  closeOnEscape = true,
  closeOnBackdrop = true,
  backdropClassName,
  panelClassName,
  contentClassName,
  dataTestId,
}) => {
  useEffect(() => {
    if (!isOpen || !onClose || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  const hasMaxWidthClass = hasClassFragment(panelClassName, 'max-w-');
  const hasHorizontalMarginClass =
    hasClassFragment(panelClassName, 'mx-') ||
    hasClassFragment(panelClassName, 'ml-') ||
    hasClassFragment(panelClassName, 'mr-');

  return (
    <div
      className={cx(
        'sor-modal-backdrop fixed inset-0 flex items-center justify-center z-50',
        backdropClassName,
      )}
      data-testid={dataTestId}
      onClick={(e) => {
        if (!closeOnBackdrop || !onClose) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cx(
          'sor-modal-panel w-full',
          !hasMaxWidthClass && 'max-w-md',
          !hasHorizontalMarginClass && 'mx-4',
          panelClassName,
        )}
      >
        <div className={cx('sor-modal-content', contentClassName)}>{children}</div>
      </div>
    </div>
  );
};

interface ModalHeaderProps {
  title: React.ReactNode;
  onClose?: () => void;
  className?: string;
  titleClassName?: string;
  actions?: React.ReactNode;
  showCloseButton?: boolean;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onClose,
  className,
  titleClassName,
  actions,
  showCloseButton = true,
}) => (
  <div className={cx('sor-modal-header', className)}>
    <div className={cx('sor-modal-title', titleClassName)}>{title}</div>
    <div className="sor-modal-header-actions">
      {actions}
      {showCloseButton && onClose && (
        <button
          onClick={onClose}
          className="sor-modal-close-btn"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      )}
    </div>
  </div>
);

interface ModalBodyProps {
  className?: string;
  children: React.ReactNode;
}

export const ModalBody: React.FC<ModalBodyProps> = ({ className, children }) => (
  <div className={cx('sor-modal-body', className)}>{children}</div>
);

interface ModalFooterProps {
  className?: string;
  children: React.ReactNode;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({ className, children }) => (
  <div className={cx('sor-modal-footer', className)}>{children}</div>
);

export default Modal;
