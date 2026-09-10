import React, { lazy, Suspense, useContext, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { ConnectionContext } from "../../../../contexts/ConnectionContextTypes";
import { credentialVaultScopeKey } from "../../../../hooks/security/useDatabaseCredentialVault";
import { ConfirmDialog } from "../../../ui/dialogs/ConfirmDialog";

const DatabaseCredentialVault = lazy(
  () => import("../../../security/DatabaseCredentialVault"),
);

/** Private payloads are loaded only after an explicit management action. */
export default function DatabaseCredentialVaultSection() {
  const context = useContext(ConnectionContext),
    key = credentialVaultScopeKey(context?.credentialVault);
  const latest = useRef(key);
  latest.current = key;
  const [open, setOpen] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ id: string; key: string } | null>(
      null,
    ),
    reviewRef = useRef(review);
  reviewRef.current = review;
  return (
    <section
      data-setting-key="databaseCredentialVault"
      className="sor-settings-card space-y-3"
      aria-label="Database credential vault settings"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound size={16} />
          Database credential vault
        </h3>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={busy}
          onClick={() => {
            if (open && dirty) {
              const next = { id: crypto.randomUUID(), key };
              reviewRef.current = next;
              setReview(next);
            } else setOpen((value) => !value);
          }}
        >
          {open ? "Close credential vault" : "Manage database credentials"}
        </button>
      </div>
      <p className="text-sm text-[var(--color-textSecondary)]">
        Store reusable username/password, private-key and TOTP combinations in
        the current protected database. Social sign-in and passkey bindings are
        descriptive, non-portable metadata only.
      </p>
      {open && (
        <div className="flex min-h-96 max-h-[70vh] flex-col overflow-hidden rounded border border-[var(--color-border)]">
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm">
                Loading credential vault…
              </p>
            }
          >
            <DatabaseCredentialVault
              onDirtyChange={setDirty}
              onBusyChange={setBusy}
            />
          </Suspense>
        </div>
      )}
      <ConfirmDialog
        isOpen={!!review && review.key === key}
        title="Discard private draft"
        message="Discard the unsaved credential changes and close this vault editor?"
        confirmText="Discard changes"
        confirmOnEnter={false}
        onCancel={() => {
          reviewRef.current = null;
          setReview(null);
        }}
        onConfirm={() => {
          if (
            !review ||
            reviewRef.current?.id !== review.id ||
            latest.current !== review.key ||
            busy
          )
            return;
          reviewRef.current = null;
          setReview(null);
          setOpen(false);
        }}
      />
    </section>
  );
}
