"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Shield } from "lucide-react";
import { useToastContext } from "../../../contexts/ToastContext";
import type {
  Connection,
  ConnectionSession,
} from "../../../types/connection/connection";
import { useRuntimeVaultTotp } from "../../../hooks/security/useRuntimeVaultTotp";
import RuntimeVaultTotpPanel from "../../security/RuntimeVaultTotpPanel";
import OriginCredentialCopyPanel from "./OriginCredentialCopyPanel";
import WebTotpPanel from "./WebTotpPanel";
import { OriginCredentialTypeCode } from "./OriginCredentialCopyPanel";
import {
  useOriginCredentialTyping,
  type OriginCredentialTypingOptions,
} from "../../../hooks/security/useOriginCredentialTyping";

interface ToolbarPopoverProps {
  label: string;
  icon: React.ReactNode;
  eligible: boolean;
  canOpen: boolean;
  scope: unknown;
  assertOwner: () => void;
  onOverlayChange: (open: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  beforeOpen?: () => Promise<void>;
  suspended?: boolean;
  dismissRevision?: number;
  children: (surface: {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    panelRef: React.RefObject<HTMLElement | null>;
    onClose: () => void;
  }) => React.ReactNode;
}

/** Shared lifecycle for native toolbar popups. Native rendering remains mounted;
 * the shell observes the portalled surface to clip it and shield native input. */
export function OriginToolbarPopover({
  label,
  icon,
  eligible,
  canOpen,
  scope,
  assertOwner,
  onOverlayChange,
  onOpenChange,
  onPointerDown,
  beforeOpen,
  suspended = false,
  dismissRevision = 0,
  children,
}: ToolbarPopoverProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [opened, setOpened] = useState<{ scope: unknown } | null>(null);
  const open = eligible && opened?.scope === scope;
  const latest = useRef({ eligible, canOpen, scope });
  latest.current = { eligible, canOpen, scope };
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = useCallback(() => {
    const focused = document.activeElement;
    // Outside clicks/Tab keep their new target. Escape and the close button
    // return to the toolbar without focusing the underlying native page.
    if (focused === document.body || panelRef.current?.contains(focused))
      anchorRef.current?.focus({ preventScroll: true });
    setOpened(null);
  }, []);
  const previousDismiss = useRef(dismissRevision);
  useEffect(() => {
    if (previousDismiss.current !== dismissRevision) {
      previousDismiss.current = dismissRevision;
      // A native typing completion keeps focus in its captured page field.
      // The shell's activeElement may still be the now-hidden Type button.
      setOpened(null);
    }
  }, [dismissRevision]);
  useLayoutEffect(() => {
    if (!eligible || opened?.scope !== scope) setOpened(null);
  }, [eligible, opened, scope]);
  useLayoutEffect(() => {
    onOverlayChange(open && !suspended);
    return () => onOverlayChange(false);
  }, [open, suspended, onOverlayChange]);
  useLayoutEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open || suspended) return;
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
    const leave = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (
        !panelRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      )
        close();
    };
    const hidden = () => {
      if (document.hidden) close();
    };
    document.addEventListener("focusin", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [open, suspended, close]);
  return (
    <div
      className="contents"
      onKeyDownCapture={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        data-tooltip={label}
        className={`sor-btn sor-icon-btn-sm relative shrink-0 ${open ? "bg-primary/15 text-primary" : "text-[var(--color-textSecondary)]"}`}
        disabled={!eligible || (!open && !canOpen)}
        onPointerDown={onPointerDown}
        onClick={() => {
          if (open) return close();
          if (!eligible || !canOpen || document.hidden) return;
          try {
            assertOwner();
            const show = () => {
              if (
                !alive.current ||
                !latest.current.eligible ||
                !latest.current.canOpen ||
                latest.current.scope !== scope ||
                document.hidden
              )
                return;
              assertOwner();
              setOpened({ scope });
            };
            if (beforeOpen)
              void beforeOpen()
                .then(show)
                .catch(() => {});
            else show();
          } catch {
            /* The owning session changed before the click. */
          }
        }}
      >
        {icon}
      </button>
      {open && children({ anchorRef, panelRef, onClose: close })}
    </div>
  );
}

export default function OriginCredentialControls({
  session,
  connection,
  eligible,
  canOpen,
  assertOwner,
  onOverlayChange,
  typingOptions,
}: {
  session: ConnectionSession;
  connection: Connection;
  eligible: boolean;
  canOpen: boolean;
  assertOwner: () => void;
  onOverlayChange: (open: boolean) => void;
  typingOptions: Omit<
    OriginCredentialTypingOptions,
    "open" | "sessionId" | "assertOwner"
  >;
}) {
  const { toast } = useToastContext();
  const vaultTotp = useRuntimeVaultTotp(session, connection);
  const [open, setOpen] = useState(false);
  const [cancelRevision, setCancelRevision] = useState(0);
  const typing = useOriginCredentialTyping({
    ...typingOptions,
    open,
    sessionId: session.id,
    assertOwner,
  });
  const cancel = typing.cancel;
  const cancelTyping = useCallback(() => {
    cancel();
    setCancelRevision((n) => n + 1);
  }, [cancel]);
  const notification = useRef<{
    id: string;
    toast: typeof toast;
    finished: number;
  } | null>(null);
  useEffect(() => {
    if (typing.busy) {
      const message =
        typing.phase === "countdown"
          ? `Ready to select a field in ${typing.remaining}s`
          : typing.phase === "waiting"
            ? `Click an empty website field to type (${typing.remaining}s).`
            : typing.phase === "preparing"
              ? "Preparing credential…"
              : "Typing into website…";
      const active = notification.current ?? {
        id: toast.loading(message),
        toast,
        finished: typing.finished,
      };
      notification.current = active;
      active.toast.update(active.id, {
        message,
        action: { label: "Cancel typing", onClick: cancelTyping },
      });
    } else if (notification.current) {
      const active = notification.current;
      notification.current = null;
      active.toast.update(active.id, {
        type: typing.notice
          ? "warning"
          : typing.finished > active.finished
            ? "success"
            : "info",
        message:
          typing.notice ||
          (typing.finished > active.finished
            ? "Typing completed."
            : "Typing stopped."),
        action: undefined,
        duration: 5000,
      });
    }
  }, [
    typing.busy,
    typing.phase,
    typing.remaining,
    typing.notice,
    typing.finished,
    toast,
    cancelTyping,
  ]);
  useEffect(
    () => () => {
      const active = notification.current;
      notification.current = null;
      active?.toast.remove(active.id);
    },
    [],
  );
  return (
    <>
      <OriginToolbarPopover
        label="Credentials & 2FA"
        icon={<Shield size={16} aria-hidden="true" />}
        eligible={eligible}
        canOpen={canOpen}
        scope={connection}
        assertOwner={assertOwner}
        onOverlayChange={onOverlayChange}
        onOpenChange={setOpen}
        suspended={typing.suspended}
        dismissRevision={typing.finished + cancelRevision}
      >
        {({ anchorRef, panelRef, onClose }) => {
          // The hidden, mounted surface must not cancel when the user clicks
          // the website to focus a field. Toast Cancel/Escape remain active.
          const closePanel = typing.suspended ? () => {} : onClose;
          const credentialActions = (
            <div className="border-b border-[var(--color-border)] p-3">
              <OriginCredentialCopyPanel
                session={session}
                connection={connection}
                assertOwner={assertOwner}
                typing={typing}
              />
            </div>
          );
          return connection.credentialSource?.kind === "vault" ? (
            <RuntimeVaultTotpPanel
              controller={vaultTotp}
              className={`sor-popover-panel text-[var(--color-text)] ${typing.suspended ? "hidden" : ""}`}
              anchorRef={anchorRef}
              typingRef={panelRef}
              onClose={closePanel}
              credentialActions={credentialActions}
              renderTypeCode={(id) => (
                <OriginCredentialTypeCode
                  session={session}
                  connection={connection}
                  typing={typing}
                  selection={{ vaultId: id }}
                />
              )}
            />
          ) : (
            <WebTotpPanel
              className={`max-h-[calc(100dvh-1rem)] overflow-y-auto text-[var(--color-text)] ${typing.suspended ? "hidden" : ""}`}
              configs={connection.totpConfigs ?? []}
              ownerDatabaseId={session.ownerDatabaseId}
              connectionId={connection.id}
              anchorRef={anchorRef}
              typingRef={panelRef}
              onClose={closePanel}
              credentialActions={credentialActions}
              renderTypeCode={(index) => (
                <OriginCredentialTypeCode
                  session={session}
                  connection={connection}
                  typing={typing}
                  selection={{ localIndex: index }}
                />
              )}
            />
          );
        }}
      </OriginToolbarPopover>
    </>
  );
}
