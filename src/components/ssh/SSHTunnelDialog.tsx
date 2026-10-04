import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { SSHTunnelCreateParams } from "../../utils/ssh/sshTunnelService";
import { Connection } from "../../types/connection/connection";
import { useConnections } from "../../contexts/useConnections";
import {
  Checkbox,
  NumberInput,
  PasswordInput,
  Select,
  type SelectOption,
} from "../ui/forms";

interface SSHTunnelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: SSHTunnelCreateParams) => void | Promise<void>;
  sshConnections: Connection[];
  requireBaseReselection?: boolean;
  editingTunnel?: {
    id: string;
    name: string;
    sshConnectionId?: string;
    host?: string;
    port?: number;
    username?: string;
    credentialRef?: string;
    localPort: number;
    remoteHost?: string;
    remotePort?: number;
    type: "local" | "remote" | "dynamic";
    autoConnect: boolean;
    allowNonLoopbackBind?: boolean;
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
  allowNonLoopbackBind: false,
};

/** Folder names from the tree root down to the connection's parent. */
function folderPath(
  connection: Connection,
  connectionsById: ReadonlyMap<string, Connection>,
): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let parentId = connection.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = connectionsById.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

export const SSHTunnelDialog: React.FC<SSHTunnelDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  sshConnections: sshConnectionsProp,
  editingTunnel,
  requireBaseReselection = false,
}) => {
  const { state } = useConnections();
  // Use prop if provided, otherwise pull SSH connections from global state
  const sshConnections = useMemo(
    () =>
      sshConnectionsProp.length > 0
        ? sshConnectionsProp
        : state.connections.filter((c) => c.protocol === "ssh" && !c.isGroup),
    [sshConnectionsProp, state.connections],
  );
  const connectionOptions = useMemo<SelectOption[]>(() => {
    const connectionsById = new Map(
      [...state.connections, ...sshConnections].map((c) => [c.id, c]),
    );
    return [
      { value: "", label: "Select SSH connection..." },
      // The searchable filter matches the label (name, host) and the
      // description (folder path, username).
      ...sshConnections.map((conn) => {
        const details = [
          folderPath(conn, connectionsById),
          conn.username && `user ${conn.username}`,
        ];
        return {
          value: conn.id,
          label: `${conn.name} (${conn.hostname}:${conn.port})`,
          description: details.filter(Boolean).join(" · ") || undefined,
        };
      }),
    ];
  }, [sshConnections, state.connections]);
  const connectionSelectId = useId();
  const [form, setForm] = useState<SSHTunnelCreateParams>(defaultForm);
  const [standalone, setStandalone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Choose the initial mode on opening, without resetting a draft when the
  // saved connection list changes in the background.
  const defaultStandaloneRef = useRef(sshConnections.length === 0);
  defaultStandaloneRef.current = sshConnections.length === 0;

  useEffect(() => {
    if (isOpen) {
      setSaveError(null);
      setStandalone(
        editingTunnel
          ? !editingTunnel.sshConnectionId
          : defaultStandaloneRef.current,
      );
      if (editingTunnel) {
        setForm({
          name: editingTunnel.name,
          sshConnectionId: requireBaseReselection
            ? ""
            : editingTunnel.sshConnectionId,
          host: editingTunnel.host,
          port: editingTunnel.port ?? 22,
          username: editingTunnel.username,
          localPort: editingTunnel.localPort,
          remoteHost: editingTunnel.remoteHost || "localhost",
          remotePort: editingTunnel.remotePort || 22,
          type: editingTunnel.type,
          autoConnect: editingTunnel.autoConnect,
          allowNonLoopbackBind: editingTunnel.allowNonLoopbackBind ?? false,
        });
      } else {
        setForm(defaultForm);
      }
    } else {
      setForm(defaultForm);
    }
  }, [isOpen, editingTunnel, requireBaseReselection]);

  const remoteForward = form.type === "remote";
  const localPortLabel = remoteForward
    ? "Local destination port"
    : "Local Port";
  const valid =
    !!form.name.trim() &&
    (!remoteForward ||
      (Number.isInteger(form.localPort) &&
        (form.localPort ?? 0) >= 1 &&
        (form.localPort ?? 0) <= 65535)) &&
    (standalone
      ? !!form.host?.trim() &&
        !!form.username?.trim() &&
        !!(form.password || editingTunnel?.credentialRef)
      : !!form.sshConnectionId);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        ...form,
        sshConnectionId: standalone ? "" : form.sshConnectionId,
        host: standalone ? form.host : undefined,
        port: standalone ? (form.port ?? 22) : undefined,
        username: standalone ? form.username : undefined,
        password: standalone ? form.password || undefined : undefined,
      });
      setForm((current) => ({ ...current, password: undefined }));
    } catch (error) {
      // Service errors deliberately exclude raw credential-provider errors.
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save the SSH tunnel. Check its configuration and credential vault.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const isEditing = !!editingTunnel;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto w-full p-4 sm:p-6 space-y-5">
            {saveError && (
              <p role="alert" className="text-error">
                {saveError}
              </p>
            )}
            <fieldset disabled={saving} className="space-y-2">
              <legend className="text-sm font-medium">SSH base</legend>
              <label className="inline-flex items-center gap-2 mr-4 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="radio"
                  className="h-4 w-4 accent-[var(--color-primary)]"
                  name={`${connectionSelectId}-base`}
                  checked={!standalone}
                  onChange={() => {
                    setStandalone(false);
                    setForm({ ...form, password: undefined });
                  }}
                />{" "}
                Saved SSH connection
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--color-textSecondary)]">
                <input
                  type="radio"
                  className="h-4 w-4 accent-[var(--color-primary)]"
                  name={`${connectionSelectId}-base`}
                  checked={standalone}
                  onChange={() => setStandalone(true)}
                />{" "}
                Standalone SSH server
              </label>
            </fieldset>
            <div>
              <label className="sor-form-label">
                Tunnel Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                aria-label="Tunnel Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My SSH Tunnel"
                className="sor-form-input min-w-0 text-sm"
                autoFocus
              />
            </div>

            {!standalone ? (
              <div>
                <label htmlFor={connectionSelectId} className="sor-form-label">
                  SSH Connection <span className="text-error">*</span>
                </label>
                <Select
                  id={connectionSelectId}
                  label="SSH connection"
                  data-testid="ssh-tunnel-connection-select"
                  value={form.sshConnectionId ?? ""}
                  onChange={(v: string) =>
                    setForm({ ...form, sshConnectionId: v })
                  }
                  options={connectionOptions}
                  searchable
                  searchPlaceholder="Search by name, host, user or folder…"
                  variant="form"
                />
                {sshConnections.length === 0 && (
                  <p className="text-xs text-warning mt-1">
                    No SSH connections available. Choose Standalone SSH server
                    or save an SSH connection.
                  </p>
                )}
                <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                  Uses the saved connection's credentials, host-key policy and
                  network path.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="sor-form-label">
                  SSH host
                  <input
                    aria-label="SSH host"
                    required
                    value={form.host ?? ""}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    className="sor-form-input"
                    placeholder="bastion.example.com"
                  />
                </label>
                <label className="sor-form-label">
                  SSH port
                  <input
                    aria-label="SSH port"
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={form.port ?? 22}
                    onChange={(e) =>
                      setForm({ ...form, port: Number(e.target.value) })
                    }
                    className="sor-form-input"
                  />
                </label>
                <label className="sor-form-label">
                  SSH username
                  <input
                    aria-label="SSH username"
                    required
                    autoComplete="off"
                    value={form.username ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, username: e.target.value })
                    }
                    className="sor-form-input"
                  />
                </label>
                <label className="sor-form-label">
                  SSH password
                  <PasswordInput
                    aria-label="SSH password"
                    autoComplete="new-password"
                    required={!editingTunnel?.credentialRef}
                    value={form.password ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    className="sor-form-input"
                    placeholder={
                      editingTunnel?.credentialRef
                        ? "Leave blank to keep stored password"
                        : "Password"
                    }
                  />
                </label>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Passwords are saved in the OS credential vault. Enter the
                  password again when changing the SSH host, port or username.
                  Host keys are verified through Trust Center in the open
                  database.
                </p>
              </div>
            )}

            <div>
              <label className="sor-form-label">Tunnel Type</label>
              <Select
                label="Tunnel Type"
                value={form.type ?? "local"}
                onChange={(v: string) =>
                  setForm({
                    ...form,
                    type: v as "local" | "remote" | "dynamic",
                  })
                }
                options={[
                  {
                    value: "local",
                    label: "Local (forward local port to remote)",
                  },
                  {
                    value: "remote",
                    label: "Remote (forward remote port to local)",
                  },
                  { value: "dynamic", label: "Dynamic (SOCKS proxy)" },
                ]}
                variant="form"
              />
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                {form.type === "local" &&
                  "Forwards connections from your local machine to a remote host via SSH."}
                {form.type === "remote" &&
                  "Forwards connections from the remote server to your local machine."}
                {form.type === "dynamic" &&
                  "Creates a SOCKS5 proxy for dynamic port forwarding."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="sor-form-label">
                  {localPortLabel}
                  {remoteForward && <span className="text-error"> *</span>}
                </label>
                <NumberInput
                  label={localPortLabel}
                  value={form.localPort ?? 0}
                  onChange={(v: number) => setForm({ ...form, localPort: v })}
                  placeholder={remoteForward ? "1–65535" : "0 = auto"}
                  variant="form"
                  min={remoteForward ? 1 : 0}
                  max={65535}
                  required={remoteForward}
                />
                <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                  {remoteForward
                    ? "Required: 1–65535. Port of the existing local service that receives forwarded connections."
                    : "0 = automatically assign"}
                </p>
              </div>

              {form.type !== "dynamic" && (
                <div>
                  <label className="sor-form-label">
                    Remote Port <span className="text-error">*</span>
                  </label>
                  <NumberInput
                    label="Remote Port"
                    value={form.remotePort ?? 0}
                    onChange={(v: number) =>
                      setForm({
                        ...form,
                        remotePort: v,
                      })
                    }
                    variant="form"
                    min={1}
                    max={65535}
                  />
                </div>
              )}
            </div>

            {form.type !== "dynamic" && (
              <div>
                <label className="sor-form-label">Remote Host</label>
                <input
                  type="text"
                  aria-label="Remote Host"
                  value={form.remoteHost}
                  onChange={(e) =>
                    setForm({ ...form, remoteHost: e.target.value })
                  }
                  placeholder="localhost"
                  className="sor-form-input min-w-0 text-sm"
                />
                <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                  The destination host from the SSH server's perspective.
                  Usually "localhost" to access the SSH server itself.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 py-2">
              <Checkbox
                id={`${connectionSelectId}-autoConnect`}
                checked={form.autoConnect ?? false}
                onChange={(v: boolean) => setForm({ ...form, autoConnect: v })}
                variant="form"
              />
              <label
                htmlFor={`${connectionSelectId}-autoConnect`}
                className="text-sm text-[var(--color-text)]"
              >
                Auto-connect when associated connection starts
              </label>
            </div>

            <div className="pt-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${connectionSelectId}-allowNonLoopbackBind`}
                  checked={form.allowNonLoopbackBind ?? false}
                  onChange={(v: boolean) =>
                    setForm({ ...form, allowNonLoopbackBind: v })
                  }
                  variant="form"
                />
                <label
                  htmlFor={`${connectionSelectId}-allowNonLoopbackBind`}
                  className="text-sm text-[var(--color-text)]"
                >
                  Allow binding to non-loopback (public) interface
                </label>
              </div>
              <p className="text-xs text-[var(--color-textSecondary)] mt-1">
                For security, the forward binds to 127.0.0.1 (loopback only) so
                the tunnel is reachable from this machine only. Enable this to
                bind to all interfaces (0.0.0.0) and deliberately expose the
                forward to other hosts on the network.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="sor-btn sor-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || saving}
            className="sor-btn sor-btn-primary"
          >
            {isEditing ? "Save Changes" : "Create Tunnel"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default SSHTunnelDialog;
