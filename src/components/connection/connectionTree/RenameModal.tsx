import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import Modal, { ModalHeader } from "../../ui/overlays/Modal";
import { useTranslation } from "react-i18next";

function RenameModal({ mgr }: { mgr: ConnectionTreeMgr }) {
  const { t } = useTranslation();
  if (!mgr.renameTarget) return null;
  return (
    <Modal
      isOpen={Boolean(mgr.renameTarget)}
      onClose={() => mgr.setRenameTarget(null)}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-rename-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={() => mgr.setRenameTarget(null)}
          className="relative h-12 border-b border-[var(--color-border)]"
          titleClassName="absolute left-5 top-3 text-sm font-semibold text-[var(--color-text)]"
          title={t("connections.renameConnection", "Rename Connection")}
        />
        <div className="p-6">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-2">
            {t("connections.connectionName", "Connection Name")}
          </label>
          <input
            type="text"
            autoFocus
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
