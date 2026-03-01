import React, { useEffect, useState } from "react";
import { Route } from "lucide-react";
import { SSHTunnelCreateParams } from "../../utils/sshTunnelService";
import { Connection } from "../../types/connection";
import { Modal, ModalHeader } from "../ui/overlays/Modal";
import { Checkbox, NumberInput, Select } from '../ui/forms';

interface SSHTunnelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: SSHTunnelCreateParams) => void;
  sshConnections: Connection[];
  editingTunnel?: {
    id: string;
    name: string;
    sshConnectionId: string;
    localPort: number;
    remoteHost?: string;
    remotePort?: number;
    type: "local" | "remote" | "dynamic";
    autoConnect: boolean;
  } | null;
}

const defaultForm: SSHTunnelCreateParams = {
  name: "",
  sshConnectionId: "",
  localPort: 0,
  remoteHost: "localhost",
  remotePort: 22,
  type: "local",
  autoConnect: false,
};

export const SSHTunnelDialog: React.FC<SSHTunnelDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  sshConnections,
  editingTunnel,
}) => {
  const [form, setForm] = useState<SSHTunnelCreateParams>(defaultForm);

  useEffect(() => {
    if (isOpen) {
      if (editingTunnel) {
        setForm({
          name: editingTunnel.name,
          sshConnectionId: editingTunnel.sshConnectionId,
          localPort: editingTunnel.localPort,
          remoteHost: editingTunnel.remoteHost || "localhost",
          remotePort: editingTunnel.remotePort || 22,
          type: editingTunnel.type,
          autoConnect: editingTunnel.autoConnect,
        });
      } else {
        setForm(defaultForm);
      }
    }
  }, [isOpen, editingTunnel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.sshConnectionId) return;
    onSave(form);
  };

  if (!isOpen) return null;

  const isEditing = !!editingTunnel;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-lg mx-4"
      dataTestId="ssh-tunnel-dialog-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full overflow-hidden border border-[var(--color-border)]">
        <ModalHeader
          onClose={onClose}
          className="border-b border-[var(--color-border)] px-5 py-4 bg-[var(--color-surface)]"
          title={
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Route size={18} className="text-blue-500" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {isEditing ? "Edit SSH Tunnel" : "Create SSH Tunnel"}
              </h2>
            </div>
          }
        />

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              Tunnel Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My SSH Tunnel"
              className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              SSH Connection <span className="text-red-400">*</span>
            </label>
            <Select value={form.sshConnectionId} onChange={(v: string) =>
                setForm({ ...form, sshConnectionId: v })} options={[{ value: '', label: 'Select SSH connection...' }, ...sshConnections.map((conn) => ({ value: conn.id, label: `${conn.name} (${conn.hostname}:${conn.port})` }))]} className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500" />
            {sshConnections.length === 0 && (
              <p className="text-xs text-yellow-500 mt-1">
                No SSH connections available. Create an SSH connection first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              Tunnel Type
            </label>
            <Select value={form.type} onChange={(v: string) => setForm({
                  ...form,
                  type: v as "local" | "remote" | "dynamic",
                })} options={[{ value: "local", label: "Local (forward local port to remote)" }, { value: "remote", label: "Remote (forward remote port to local)" }, { value: "dynamic", label: "Dynamic (SOCKS proxy)" }]} className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500" />
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
              {form.type === "local" &&
                "Forwards connections from your local machine to a remote host via SSH."}
              {form.type === "remote" &&
                "Forwards connections from the remote server to your local machine."}
              {form.type === "dynamic" &&
                "Creates a SOCKS5 proxy for dynamic port forwarding."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                Local Port
              </label>
              <NumberInput value={form.localPort} onChange={(v: number) => setForm({ ...form, localPort: v })} placeholder="0 = auto" className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500" min={0} max={65535} />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                0 = automatically assign
              </p>
            </div>

            {form.type !== "dynamic" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                  Remote Port <span className="text-red-400">*</span>
                </label>
                <NumberInput value={form.remotePort} onChange={(v: number) => setForm({
                      ...form,
                      remotePort: v,
                    })} className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500" min={1} max={65535} />
              </div>
            )}
          </div>

          {form.type !== "dynamic" && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                Remote Host
              </label>
              <input
                type="text"
                value={form.remoteHost}
                onChange={(e) =>
                  setForm({ ...form, remoteHost: e.target.value })
                }
                placeholder="localhost"
                className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                The destination host from the SSH server's perspective. Usually
                "localhost" to access the SSH server itself.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 py-2">
            <Checkbox checked={form.autoConnect} onChange={(v: boolean) => setForm({ ...form, autoConnect: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bgSecondary)] text-blue-500 focus:ring-blue-500/50" />
            <label
              htmlFor="autoConnect"
              className="text-sm text-[var(--color-text)]"
            >
              Auto-connect when associated connection starts
            </label>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.name || !form.sshConnectionId}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEditing ? "Save Changes" : "Create Tunnel"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};

export default SSHTunnelDialog;
