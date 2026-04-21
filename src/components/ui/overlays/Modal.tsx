import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/cx';

const hasClassFragment = (value: string | undefined, fragment: string) =>
  Boolean(value && value.includes(fragment));

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const getFocusableElements = (container: HTMLElement | null): HTMLElement[] => {
  if (!container) return [];

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.tabIndex < 0) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
};

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
  /** Size hint (mapped to max-width). */
  size?: string;
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
  size: _size,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusPanel = () => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = getFocusableElements(panel);
      const nextFocus = focusable[0] ?? panel;
      nextFocus.focus();
    };

    const frame = requestAnimationFrame(focusPanel);

    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose && closeOnEscape) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
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
        ref={panelRef}
        className={cx(
          'sor-modal-panel w-full',
          !hasMaxWidthClass && 'max-w-md',
          !hasHorizontalMarginClass && 'mx-4',
          panelClassName,
        )}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className={cx('sor-modal-content', contentClassName)}>{children}</div>
      </div>
    </div>
  );
};

export interface ModalHeaderProps {
  title?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  titleClassName?: string;
  actions?: React.ReactNode;
  showCloseButton?: boolean;
  children?: React.ReactNode;
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
          data-testid="modal-close"
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
