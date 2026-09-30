import React, { useCallback, useEffect, useRef, useState } from "react";
import { Modal, ModalBody, ModalHeader } from "../overlays/Modal";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  isOpen: boolean;
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning";
  onConfirm: () => void;
  onCancel?: () => void;
  /** Disable the global Enter shortcut when focused buttons must own keyboard activation. */
  confirmOnEnter?: boolean;
  /** Focus OK on opening so native Enter activation confirms the request. */
  autoFocusConfirm?: boolean;
  /** Use a compact bottom-right confirmation toast instead of a centered modal. */
  presentation?: "modal" | "toast";
  /**
   * Optional middle button — renders between Cancel and Confirm. Used
   * by the folder-delete dialog (P9) to offer "Keep connections,
   * reparent to <folder>" as an alternative to a cascade delete.
   * `variant` defaults to `default`; the primary danger/warning
   * affordance stays on `onConfirm`.
   */
  secondaryAction?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "warning";
  };
}

// A new visible prompt owns a new timer, action guard, focus lifecycle, and
// entrance animation. Callers queueing identical prompts should also supply
// a React key for the request; callback identity is not request identity.
export const ConfirmDialog: React.FC<ConfirmDialogProps> = (props) => (
  <ConfirmDialogRequest
    key={
      props.presentation === "toast"
        ? JSON.stringify([
            props.isOpen,
            props.message,
            props.title,
            props.confirmText,
            props.cancelText,
            props.variant,
            props.presentation,
            props.autoFocusConfirm,
            Boolean(props.onCancel),
            props.secondaryAction?.label,
          ])
        : "modal"
    }
    {...props}
  />
);

const ConfirmDialogRequest: React.FC<ConfirmDialogProps> = ({
  isOpen,
  message,
  title = "Confirmation",
  confirmText = "OK",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  confirmOnEnter = true,
  autoFocusConfirm = false,
  secondaryAction,
  presentation = "modal",
}) => {
  const [exiting, setExiting] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingAction = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!isOpen) setExiting(false);
    return () => {
      clearTimeout(exitTimer.current);
      pendingAction.current = false;
    };
  }, [isOpen]);

  const runAction = useCallback(
    (action: () => void) => {
      // Modal callers may keep the prompt open after validation and retry.
      if (presentation !== "toast") {
        action();
        return;
      }
      if (pendingAction.current) return;
      // Latch before either path, including immediate reduced-motion actions.
      // Only a new request may accept another action.
      pendingAction.current = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        action();
        return;
      }

      // The session manager unmounts this dialog when an action settles. Keep
      // focus and the selected action here until the short exit has finished.
      setExiting(true);
      exitTimer.current = setTimeout(() => {
        action();
      }, 160);
    },
    [presentation],
  );
  const confirm = useCallback(
    () => runAction(onConfirm),
    [runAction, onConfirm],
  );
  const cancel = onCancel ? () => runAction(onCancel) : undefined;

  useEffect(() => {
    if (!isOpen || !confirmOnEnter) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Enter" &&
        !e.defaultPrevented &&
        !e.repeat &&
        !e.isComposing &&
        !(
          e.target instanceof Element &&
          e.target.closest(
            "button, a, input, textarea, select, [contenteditable], [role='button']",
          )
        )
      ) {
        // Focused controls own Enter. In particular, Cancel must never also
        // trigger the destructive action through this document shortcut.
        e.preventDefault();
        confirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, confirm, confirmOnEnter]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={cancel}
      closeOnBackdrop={Boolean(onCancel)}
      closeOnEscape={Boolean(onCancel)}
      panelClassName={`max-w-md mx-4 ${presentation === "toast" ? styles.toast : ""} ${exiting ? styles.exiting : ""}`}
      ariaLabel={title}
      dataTestId="confirm-dialog"
      presentation={presentation}
      initialFocusRef={autoFocusConfirm ? confirmButtonRef : undefined}
    >
      <ModalHeader
        title={title}
        onClose={cancel}
        showCloseButton={Boolean(onCancel)}
      />
      <ModalBody className="p-6">
        <p className="text-[var(--color-text)] mb-6">{message}</p>
        <div className="flex justify-end space-x-3">
          {onCancel && (
            <button
              type="button"
              aria-disabled={exiting || undefined}
              onClick={cancel}
              className="sor-modal-cancel"
              data-testid="confirm-no"
            >
              {cancelText}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              aria-disabled={exiting || undefined}
              onClick={() => runAction(secondaryAction.onClick)}
              data-testid="confirm-secondary"
              className={`px-4 py-2 text-[var(--color-text)] rounded-md transition-colors ${
                secondaryAction.variant === "warning"
                  ? "bg-warning hover:bg-warning/90"
                  : "bg-[var(--color-border)] hover:bg-[var(--color-borderHover)]"
              }`}
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            type="button"
            aria-disabled={exiting || undefined}
            onClick={confirm}
            ref={confirmButtonRef}
            data-testid="confirm-yes"
            className={`px-4 py-2 text-[var(--color-text)] rounded-md transition-colors ${
              variant === "danger"
                ? "bg-error hover:bg-error/90"
                : variant === "warning"
                  ? "bg-warning hover:bg-warning/90"
                  : "bg-primary hover:bg-primary/90"
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
