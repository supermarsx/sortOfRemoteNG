import React, { useEffect, useState } from "react";
import { X, Route } from "lucide-react";
import { SSHTunnelCreateParams } from "../utils/sshTunnelService";
import { Connection } from "../types/connection";

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
    type: 'local' | 'remote' | 'dynamic';
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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.sshConnectionId) return;
    onSave(form);
  };

  if (!isOpen) return null;

  const isEditing = !!editingTunnel;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-[var(--color-border)]">
        {/* Header */}
        <div className="border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Route size={18} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {isEditing ? "Edit SSH Tunnel" : "Create SSH Tunnel"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

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
            <select
              value={form.sshConnectionId}
              onChange={(e) => setForm({ ...form, sshConnectionId: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            >
              <option value="">Select SSH connection...</option>
              {sshConnections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.name} ({conn.hostname}:{conn.port})
                </option>
              ))}
            </select>
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
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'local' | 'remote' | 'dynamic' })}
              className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
            >
              <option value="local">Local (forward local port to remote)</option>
              <option value="remote">Remote (forward remote port to local)</option>
              <option value="dynamic">Dynamic (SOCKS proxy)</option>
            </select>
            <p className="text-xs text-[var(--color-textSecondary)] mt-1">
              {form.type === 'local' && "Forwards connections from your local machine to a remote host via SSH."}
              {form.type === 'remote' && "Forwards connections from the remote server to your local machine."}
              {form.type === 'dynamic' && "Creates a SOCKS5 proxy for dynamic port forwarding."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                Local Port
              </label>
              <input
                type="number"
                value={form.localPort}
                onChange={(e) => setForm({ ...form, localPort: parseInt(e.target.value) || 0 })}
                min={0}
                max={65535}
                placeholder="0 = auto"
                className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                0 = automatically assign
              </p>
            </div>

            {form.type !== 'dynamic' && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                  Remote Port <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  value={form.remotePort}
                  onChange={(e) => setForm({ ...form, remotePort: parseInt(e.target.value) || 22 })}
                  min={1}
                  max={65535}
                  className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {form.type !== 'dynamic' && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                Remote Host
              </label>
              <input
                type="text"
                value={form.remoteHost}
                onChange={(e) => setForm({ ...form, remoteHost: e.target.value })}
                placeholder="localhost"
                className="w-full px-3 py-2 bg-[var(--color-bgSecondary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
              />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                The destination host from the SSH server's perspective. Usually "localhost" to access the SSH server itself.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              id="autoConnect"
              checked={form.autoConnect}
              onChange={(e) => setForm({ ...form, autoConnect: e.target.checked })}
              className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bgSecondary)] text-blue-500 focus:ring-blue-500/50"
            />
            <label htmlFor="autoConnect" className="text-sm text-[var(--color-text)]">
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
    </div>
  );
};

export default SSHTunnelDialog;
