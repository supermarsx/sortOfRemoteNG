import { useEffect, useRef, useState } from "react";
import { LockKeyhole, RefreshCw } from "lucide-react";
import { useToastContext } from "../../contexts/ToastContext";
import type { DatabaseAccessSuspension } from "../../hooks/settings/useDatabaseAccessSuspension";
import { ManagedDatabaseUnlockForm } from "./ManagedDatabaseUnlockForm";
import { Modal, ModalBody } from "../ui/overlays/Modal";
import { DialogHeader } from "../ui/overlays/DialogHeader";

/** Database access is scoped: losing it must not lock the application shell. */
export function DatabaseAccessNotice({
  access,
  globallyLocked,
}: {
  access: DatabaseAccessSuspension;
  globallyLocked: boolean;
}) {
  if (globallyLocked || !access.suspended) return null;
  return (
    <LockedDatabaseNotice
      key={`${access.suspended.databaseId}:${access.suspended.access.accessEpoch}:${access.suspended.access.securityRevision}`}
      access={access}
    />
  );
}

function LockedDatabaseNotice({
  access,
}: {
  access: DatabaseAccessSuspension;
}) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToastContext();
  const inspect = useRef(access.inspect);
  inspect.current = access.inspect;
  const target = access.suspended;
  const name = target?.name;
  useEffect(() => {
    if (!name) return;
    let active = true;
    const id = toast.warning(`${name} — Database locked.`, 10_000);
    toast.update(id, {
      description:
        "Database tools require unlocking; other tabs remain available. You can also unlock from Databases.",
      action: {
        label: "Unlock…",
        icon: LockKeyhole,
        onClick: () => {
          if (!active) return;
          setExpanded(true);
          void inspect.current();
        },
      },
    });
    return () => {
      active = false;
      toast.remove(id);
    };
  }, [toast, name]);

  if (!target) return null;
  return (
    <Modal
      isOpen={expanded}
      onClose={() => setExpanded(false)}
      presentation="toast"
      ariaLabel={`Unlock ${target.name}`}
      dataTestId="database-access-notice"
      panelClassName="max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      <DialogHeader
        icon={LockKeyhole}
        iconColor="text-warning"
        title={`Unlock ${target.name}`}
        variant="compact"
        onClose={() => setExpanded(false)}
      />
      <ModalBody className="min-h-0 space-y-3 overflow-y-auto p-5">
        <p className="text-xs text-[var(--color-textMuted)]">
          {target.access.reason === "expired"
            ? "The database access session expired. Unlock it when you want to resume database work."
            : "The database was locked or its protection changed. Unlock it when you want to resume database work."}
        </p>
        {access.loading && (
          <p role="status" className="text-sm">
            Inspecting database unlock methods…
          </p>
        )}
        {access.error && (
          <p role="alert" className="text-sm text-error">
            {access.error}
          </p>
        )}
        {access.status && (
          <ManagedDatabaseUnlockForm
            key={`${target.databaseId}:${target.access.accessEpoch}:${access.status.securityRevision}`}
            databaseId={target.databaseId}
            status={access.status}
            disabled={access.loading}
          />
        )}
        <button
          type="button"
          disabled={access.loading}
          onClick={() => void access.inspect()}
          className="sor-btn sor-btn-secondary inline-flex items-center gap-2 text-xs disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh unlock methods
        </button>
      </ModalBody>
    </Modal>
  );
}
