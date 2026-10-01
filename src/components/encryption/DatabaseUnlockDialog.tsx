import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, LockKeyhole, type LucideIcon } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";
import { ManagedDatabaseUnlockForm } from "./ManagedDatabaseUnlockForm";
import type { DatabaseProtectionStatus } from "../../types/encryption/databaseProtection";
import type { DatabaseOpenObserver } from "../../types/connection/databaseOpening";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { singleOsVaultUnlockSlot } from "../../utils/connection/databaseUnlockMethods";
import { isDatabaseOpenCancellation } from "../../utils/connection/databaseOpening";

/** Explicit database authentication, not the global master-key/privacy gate. */
export function DatabaseUnlockDialog({
  title,
  children,
  busy = false,
  onClose,
  footer,
  error,
  icon = LockKeyhole,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  error?: string | null;
  icon?: LucideIcon;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      isOpen
      ariaLabel={title}
      onClose={close}
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      panelClassName="max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      <DialogHeader
        title={title}
        icon={icon}
        variant="compact"
        onClose={busy ? undefined : close}
        className="shrink-0 [&>div]:min-w-0 [&_h2]:line-clamp-2 [&_h2]:[overflow-wrap:anywhere]"
      />
      <ModalBody className="min-h-0 space-y-3 overflow-y-auto p-5">
        {children}
        {error && (
          <p role="alert" className="text-sm text-error break-words">
            {error}
          </p>
        )}
      </ModalBody>
      {footer !== null && (
        <ModalFooter className="shrink-0 flex-wrap gap-2 px-5 py-3">
          {footer ?? (
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={close}
              disabled={busy}
            >
              Cancel database unlock
            </button>
          )}
        </ModalFooter>
      )}
    </Modal>
  );
}

export function ManagedDatabaseUnlockDialog({
  databaseId,
  databaseName,
  status,
  onClose,
  onUnlockComplete,
  onUnlockProgress,
}: {
  databaseId: string;
  databaseName: string;
  status: DatabaseProtectionStatus;
  onClose: () => void;
  onUnlockComplete?: () => void | Promise<void>;
  onUnlockProgress?: DatabaseOpenObserver;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const vaultSlotId = singleOsVaultUnlockSlot(status)?.id;
  const scope = JSON.stringify([
    databaseId,
    status.securityRevision,
    vaultSlotId,
  ]);
  const [vaultFailure, setVaultFailure] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const current = useRef({
    scope,
    onUnlockComplete,
    onUnlockProgress,
    onClose,
  });
  current.current = { scope, onUnlockComplete, onUnlockProgress, onClose };
  useEffect(() => {
    if (!vaultSlotId) return;
    let active = true;
    const isCurrent = () => active && current.current.scope === scope;
    // This dialog is mounted by an explicit Open/Unlock action, never by the
    // lock/expiry overlay. Defer one microtask so StrictMode's discarded effect
    // cannot start a second native vault request.
    void Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      setVaultFailure(null);
      current.current.onUnlockProgress?.("unlocking");
      try {
        await DatabaseManager.getInstance().unlockManagedDatabase(
          databaseId,
          vaultSlotId,
          undefined,
          { isCurrent },
        );
        if (!isCurrent()) return;
        if (current.current.onUnlockComplete)
          await current.current.onUnlockComplete();
        else current.current.onClose();
      } catch (error) {
        if (!isCurrent()) return;
        if (isDatabaseOpenCancellation(error)) {
          current.current.onUnlockProgress?.("cancelled");
          current.current.onClose();
          return;
        }
        current.current.onUnlockProgress?.("waiting-unlock");
        setVaultFailure({
          scope,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [databaseId, scope, vaultSlotId]);
  const failure =
    vaultFailure?.scope === scope ? vaultFailure.message : undefined;
  if (vaultSlotId && failure === undefined)
    return (
      <p
        role="status"
        className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-textMuted)]"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        Unlocking {databaseName} with this device's OS vault…
      </p>
    );
  return (
    <DatabaseUnlockDialog
      title={`Unlock ${databaseName}`}
      busy={busy}
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
    >
      <p className="text-xs text-[var(--color-textSecondary)]">
        Authenticate this database explicitly. Global master-key access is
        unchanged.
      </p>
      <ManagedDatabaseUnlockForm
        databaseId={databaseId}
        status={status}
        initialError={failure}
        preferPassword={failure !== undefined}
        onBusyChange={(value) => {
          busyRef.current = value;
          setBusy(value);
        }}
        onUnlockComplete={onUnlockComplete ?? onClose}
        onUnlockProgress={onUnlockProgress}
      />
    </DatabaseUnlockDialog>
  );
}
