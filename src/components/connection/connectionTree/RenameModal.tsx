import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import Modal, { ModalHeader } from "../../ui/overlays/Modal";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";

type RenameManager = Pick<
  ConnectionTreeMgr,
  | "renameTarget"
  | "setRenameTarget"
  | "renameValue"
  | "setRenameValue"
  | "handleRenameSubmit"
>;

function RenameModal({ mgr }: { mgr: RenameManager }) {
  if (!mgr.renameTarget) return null;
  return <RenameDialog key={mgr.renameTarget.id} mgr={mgr} />;
}

function RenameDialog({ mgr }: { mgr: RenameManager }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetId = mgr.renameTarget?.id;
  useEffect(() => {
    if (!targetId) return;
    // Run after Modal's initial focus, once per opening, not on name edits.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [targetId]);
  const title = t("connections.renameConnection", "Rename Connection");
  return (
    <Modal
      isOpen={Boolean(mgr.renameTarget)}
      onClose={() => mgr.setRenameTarget(null)}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-rename-modal"
      ariaLabel={title}
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader onClose={() => mgr.setRenameTarget(null)} title={title} />
        <div className="p-6">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
            {t("connections.connectionName", "Connection Name")}
          </label>
          <input
            type="text"
            ref={inputRef}
            value={mgr.renameValue}
            onChange={(e) => mgr.setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                mgr.handleRenameSubmit();
              }
            }}
            className="sor-form-input"
            placeholder={t("connections.newName", "New name")}
          />
          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={() => mgr.setRenameTarget(null)}
              className="sor-modal-cancel"
            >
              {t("dialogs.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={mgr.handleRenameSubmit}
              className="sor-modal-primary"
            >
              {t("common.save", "Save")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── ConnectOptionsModal ───────────────────────────────────────── */

export default RenameModal;
