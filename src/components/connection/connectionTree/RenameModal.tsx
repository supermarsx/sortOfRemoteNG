import ConnectOptionsModal from "./ConnectOptionsModal";
import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import type { Connection } from "../../../types/connection";
import { Save } from "lucide-react";
import Modal, { ModalHeader } from "../../ui/overlays/Modal";

function RenameModal({ mgr }: { mgr: ConnectionTreeMgr }) {
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
          title="Rename Connection"
        />
        <div className="p-6">
          <label className="block text-sm text-[var(--color-textSecondary)] mb-2">Connection Name</label>
          <input
            type="text"
            autoFocus
            value={mgr.renameValue}
            onChange={(e) => mgr.setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); mgr.handleRenameSubmit(); } }}
            className="sor-form-input"
            placeholder="New name"
          />
          <div className="flex justify-end space-x-3 mt-6">
            <button type="button" onClick={() => mgr.setRenameTarget(null)} className="px-4 py-2 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded-md transition-colors">Cancel</button>
            <button type="button" onClick={mgr.handleRenameSubmit} className="px-4 py-2 text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── ConnectOptionsModal ───────────────────────────────────────── */

export default RenameModal;
