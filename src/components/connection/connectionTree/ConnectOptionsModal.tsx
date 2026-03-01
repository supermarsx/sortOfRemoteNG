import { PasswordInput } from "../../ui/forms/PasswordInput";
import PanelContextMenu from "./PanelContextMenu";
import Modal from "../../ui/overlays/Modal";
import type { ConnectionTreeMgr } from "../../../hooks/connection/useConnectionTree";
import { Key, Save } from "lucide-react";
import { Select, Checkbox } from "../../ui/forms";

function ConnectOptionsModal({ mgr }: { mgr: ConnectionTreeMgr }) {
  if (!mgr.connectOptionsTarget || !mgr.connectOptionsData) return null;
  const target = mgr.connectOptionsTarget;
  const data = mgr.connectOptionsData;
  const update = (patch: Partial<typeof data>) => mgr.setConnectOptionsData({ ...data, ...patch });
  const close = () => { mgr.setConnectOptionsTarget(null); mgr.setConnectOptionsData(null); };

  return (
    <Modal
      isOpen={Boolean(mgr.connectOptionsTarget && mgr.connectOptionsData)}
      onClose={close}
      closeOnEscape={false}
      panelClassName="max-w-md mx-4"
      dataTestId="connection-tree-connect-options-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Connect with Options</h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Username</label>
            <input
              type="text"
              value={data.username}
              onChange={(e) => update({ username: e.target.value })}
              className="sor-form-input"
            />
          </div>
          {target.protocol === "ssh" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Auth Type</label>
                <Select value={data.authType} onChange={(v: string) => update({ authType: v as "password" | "key" })} options={[{ value: "password", label: "Password" }, { value: "key", label: "Private Key" }]} className="sor-form-input" />
              </div>
              {data.authType === "password" ? (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Password</label>
                  <PasswordInput
                    value={data.password}
                    onChange={(e) => update({ password: e.target.value })}
                    className="sor-form-input"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Private Key</label>
                    <textarea
                      value={data.privateKey}
                      onChange={(e) => update({ privateKey: e.target.value })}
                      rows={3}
                      className="sor-form-input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Passphrase (optional)</label>
                    <PasswordInput
                      value={data.passphrase}
                      onChange={(e) => update({ passphrase: e.target.value })}
                      className="sor-form-input"
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--color-textSecondary)] mb-2">Password</label>
              <PasswordInput
                value={data.password}
                onChange={(e) => update({ password: e.target.value })}
                className="sor-form-input"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
            <Checkbox checked={data.saveToConnection} onChange={(v: boolean) => update({ saveToConnection: v })} />
            <span>Save credentials to this connection</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="px-3 py-2 text-sm text-[var(--color-textSecondary)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-md">Cancel</button>
            <button type="button" onClick={mgr.handleConnectOptionsSubmit} className="px-3 py-2 text-sm text-[var(--color-text)] bg-blue-600 hover:bg-blue-700 rounded-md">Connect</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── PanelContextMenu ──────────────────────────────────────────── */

export default ConnectOptionsModal;
