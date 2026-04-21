import React, { useEffect, useMemo, useState } from "react";
import { Route } from "lucide-react";
import { SSHTunnelCreateParams } from "../../utils/ssh/sshTunnelService";
import { Connection } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
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
  sshConnections: sshConnectionsProp,
  editingTunnel,
}) => {
  const { state } = useConnections();
  // Use prop if provided, otherwise pull SSH connections from global state
  const sshConnections = useMemo(
    () => sshConnectionsProp.length > 0
      ? sshConnectionsProp
      : state.connections.filter(c => c.protocol === 'ssh'),
    [sshConnectionsProp, state.connections],
  );
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
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-lg mx-auto w-full p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              Tunnel Name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My SSH Tunnel"
              className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              SSH Connection <span className="text-error">*</span>
            </label>
            <Select value={form.sshConnectionId} onChange={(v: string) =>
                setForm({ ...form, sshConnectionId: v })} options={[{ value: '', label: 'Select SSH connection...' }, ...sshConnections.map((conn) => ({ value: conn.id, label: `${conn.name} (${conn.hostname}:${conn.port})` }))]} className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary" />
            {sshConnections.length === 0 && (
              <p className="text-xs text-warning mt-1">
                No SSH connections available. Create an SSH connection first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              Tunnel Type
            </label>
            <Select value={form.type ?? "local"} onChange={(v: string) => setForm({
                  ...form,
                  type: v as "local" | "remote" | "dynamic",
                })} options={[{ value: "local", label: "Local (forward local port to remote)" }, { value: "remote", label: "Remote (forward remote port to local)" }, { value: "dynamic", label: "Dynamic (SOCKS proxy)" }]} className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary" />
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
              <NumberInput value={form.localPort ?? 0} onChange={(v: number) => setForm({ ...form, localPort: v })} placeholder="0 = auto" className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary" min={0} max={65535} />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                0 = automatically assign
              </p>
            </div>

            {form.type !== "dynamic" && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
                  Remote Port <span className="text-error">*</span>
                </label>
                <NumberInput value={form.remotePort ?? 0} onChange={(v: number) => setForm({
                      ...form,
                      remotePort: v,
                    })} className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)]  focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary" min={1} max={65535} />
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
                className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                The destination host from the SSH server's perspective. Usually
                "localhost" to access the SSH server itself.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 py-2">
            <Checkbox checked={form.autoConnect ?? false} onChange={(v: boolean) => setForm({ ...form, autoConnect: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary focus:ring-primary/50" />
            <label
              htmlFor="autoConnect"
              className="text-sm text-[var(--color-text)]"
            >
              Auto-connect when associated connection starts
            </label>
          </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} className="sor-btn sor-btn-secondary">Cancel</button>
          <button type="submit" disabled={!form.name || !form.sshConnectionId} className="sor-btn sor-btn-primary">
            {isEditing ? "Save Changes" : "Create Tunnel"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SSHTunnelDialog;
