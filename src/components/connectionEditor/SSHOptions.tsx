import React, { useState } from "react";
import { AlertTriangle, Key, Fingerprint, Trash2, Pencil } from "lucide-react";
import { PasswordInput, Textarea} from '../ui/forms';
import { InfoTooltip } from '../ui/InfoTooltip';
import { Connection } from "../../types/connection/connection";
import { SSHKeyManager } from "../ssh/SSHKeyManager";
import { SSHTerminalOverrides } from "./SSHTerminalOverrides";
import { SSHConnectionOverrides } from "./SSHConnectionOverrides";
import type { ManagedSshSecretsController } from "../../hooks/connection/useConnectionEditor";
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from "../../utils/auth/trustStore";
import { useSSHOptions } from "../../hooks/ssh/useSSHOptions";
import { Checkbox, NumberInput, Select } from '../ui/forms';

interface SSHOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  sshSecretManager?: ManagedSshSecretsController;
}

export const SSHOptions: React.FC<SSHOptionsProps> = ({
  formData,
  setFormData,
  sshSecretManager,
}) => {
  const mgr = useSSHOptions(
    formData,
    setFormData,
    sshSecretManager?.handlePrivateKeyChange,
  );
  const usesManagedSshSecrets = formData.protocol === "ssh" && !!sshSecretManager;
  const passwordValue = usesManagedSshSecrets
    ? sshSecretManager?.getPassword() ?? ""
    : formData.password || "";
  const privateKeyValue = usesManagedSshSecrets
    ? sshSecretManager?.getPrivateKey() ?? ""
    : formData.privateKey || "";
  const passphraseValue = usesManagedSshSecrets
    ? sshSecretManager?.getPassphrase() ?? ""
    : formData.passphrase || "";

  if (formData.isGroup || mgr.isHttpProtocol) return null;

  return (
    <>
      <div>
        <label className="sor-form-label">Username <InfoTooltip text="The SSH username used to authenticate with the remote host." /></label>
        <input
          type="text"
          data-testid={formData.protocol === "ssh" ? "editor-username" : undefined}
          value={formData.username || ""}
          onChange={(e) =>
            setFormData({ ...formData, username: e.target.value })
          }
          className="sor-form-input"
          placeholder="Username"
        />
      </div>

      {formData.protocol === "ssh" && (
        <div className="space-y-3">
          <div>
            <label className="sor-form-label">Authentication Type <InfoTooltip text="Choose between password-based authentication or public key authentication." /></label>
            <Select value={formData.authType ?? "password"} onChange={(v: string) => setFormData({ ...formData, authType: v as any })} options={[{ value: "password", label: "Password" }, { value: "key", label: "Private Key" }]} variant="form" />
          </div>
          <label className="sor-form-inline-check">
            <Checkbox checked={formData.ignoreSshSecurityErrors ?? false} onChange={(v: boolean) => setFormData({
                  ...formData,
                  ignoreSshSecurityErrors: v,
                })} variant="form" />
            <span>Ignore SSH security errors (host keys/certs) <InfoTooltip text="When enabled, host key mismatches and certificate errors are silently ignored. Convenient but less secure." /></span>
          </label>
          {(formData.ignoreSshSecurityErrors ?? false) && (
            <div className="rounded-lg border border-error/50 bg-error/10 px-3 py-2 text-sm text-error">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">SSH identity verification is disabled.</p>
                  <p className="text-error/90">
                    Host key mismatches and untrusted identities will be accepted without verification.
                    Use this only for disposable lab systems or known test environments.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div>
            <label className="sor-form-label">Host Key Trust Policy <InfoTooltip text="Determines how unknown or changed host keys are handled for this connection." /></label>
            <Select value={formData.sshTrustPolicy ?? ""} onChange={(v: string) => setFormData({
                  ...formData,
                  sshTrustPolicy:
                    v === ""
                      ? undefined
                      : (v as
                          | "tofu"
                          | "always-ask"
                          | "always-trust"
                          | "strict"),
                })} options={[{ value: "", label: "Use global default" }, { value: "tofu", label: "Trust On First Use (TOFU)" }, { value: "always-ask", label: "Always Ask" }, { value: "always-trust", label: "Always Trust (skip verification)" }, { value: "strict", label: "Strict (reject unless pre-approved)" }]} variant="form" />
            <p className="text-xs text-[var(--color-textMuted)] mt-1">
              How to handle host key verification for this connection.
            </p>
          </div>
          {/* Per-connection stored SSH host keys */}
          {formData.id &&
            (() => {
              const records = getAllTrustRecords(formData.id).filter(
                (r) => r.type === "ssh",
              );
              if (records.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="sor-form-label-icon">
                      <Fingerprint size={14} className="text-success" />
                      Stored Host Keys ({records.length})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        clearAllTrustRecords(formData.id);
                        setFormData({ ...formData }); // force re-render
                      }}
                      className="text-xs text-[var(--color-textMuted)] hover:text-error transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {records.map((record, i) => {
                      const [host, portStr] = record.host.split(":");
                      return (
                        <div
                          key={`record-${record.host}-${i}`}
                          className="flex items-center gap-2 bg-[var(--color-border)]/50 border border-[var(--color-border)]/50 rounded px-3 py-1.5 text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[var(--color-textSecondary)] truncate">
                                {record.nickname || record.host}
                              </p>
                              {record.nickname && (
                                <p className="text-[var(--color-textMuted)] truncate">
                                  ({record.host})
                                </p>
                              )}
                            </div>
                            <p className="font-mono text-[var(--color-textMuted)] truncate">
                              {formatFingerprint(record.identity.fingerprint)}
                            </p>
                          </div>
                          <NicknameEditButton
                            record={record}
                            connectionId={formData.id}
                            onSaved={() => setFormData({ ...formData })}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              removeIdentity(
                                host,
                                parseInt(portStr, 10),
                                record.type,
                                formData.id,
                              );
                              setFormData({ ...formData }); // force re-render
                            }}
                            className="text-[var(--color-textMuted)] hover:text-error p-0.5 transition-colors flex-shrink-0"
                            title="Remove"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="sor-form-label">Connect Timeout (sec) <InfoTooltip text="Maximum time in seconds to wait for the SSH connection to be established." /></label>
              <NumberInput value={formData.sshConnectTimeout ?? 30} onChange={(v: number) => setFormData({
                    ...formData,
                    sshConnectTimeout: v || 30,
                  })} variant="form" min={5} max={300} />
            </div>
            <div>
              <label className="sor-form-label">Keep Alive (sec) <InfoTooltip text="Interval in seconds between keep-alive messages sent to prevent idle disconnection." /></label>
              <NumberInput value={formData.sshKeepAliveInterval ?? 60} onChange={(v: number) => setFormData({
                    ...formData,
                    sshKeepAliveInterval: v || 60,
                  })} variant="form" min={10} max={600} />
            </div>
            <div>
              <label className="sor-form-label">Known Hosts Path <InfoTooltip text="Path to the known_hosts file used for host key verification. Leave empty to use the default location." /></label>
              <input
                type="text"
                value={formData.sshKnownHostsPath || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sshKnownHostsPath: e.target.value,
                  })
                }
                className="sor-form-input"
                placeholder="C:\\Users\\me\\.ssh\\known_hosts"
              />
            </div>
          </div>
        </div>
      )}

      {formData.authType === "password" && (
        <div>
          <label className="sor-form-label">Password <InfoTooltip text="The password used for SSH password authentication." /></label>
          {usesManagedSshSecrets ? (
            <PasswordInput
              ref={sshSecretManager.passwordInputRef}
              data-testid={formData.protocol === "ssh" ? "editor-password" : undefined}
              value={passwordValue}
              onChange={(e) =>
                sshSecretManager.handlePasswordChange(e.target.value)
              }
              isSaved={!!formData.id && sshSecretManager.hasPassword}
              className="sor-form-input"
              placeholder="Password"
            />
          ) : (
            <PasswordInput
              data-testid={formData.protocol === "ssh" ? "editor-password" : undefined}
              value={passwordValue}
              onChange={(e) =>
                setFormData({ ...formData, password: e.target.value })
              }
              className="sor-form-input"
              placeholder="Password"
            />
          )}
        </div>
      )}

      {formData.protocol === "ssh" && formData.authType === "key" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
                Private Key <InfoTooltip text="The PEM or PPK private key used for public key authentication." />
              </label>
              <button
                type="button"
                onClick={() => mgr.setShowKeyManager(true)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Manage Keys
              </button>
            </div>
            <Textarea
              ref={usesManagedSshSecrets ? sshSecretManager.privateKeyInputRef : undefined}
              value={privateKeyValue}
              onChange={usesManagedSshSecrets
                ? sshSecretManager.handlePrivateKeyChange
                : (v) => setFormData({ ...formData, privateKey: v })}
              rows={4}
              className="resize-none"
              placeholder="-----BEGIN PRIVATE KEY-----"
            />
            <input
              type="file"
              accept=".key,.pem,.ppk"
              onChange={mgr.handlePrivateKeyFileChange}
              className="mt-2 text-sm text-[var(--color-textSecondary)]"
            />
          </div>
          <div>
            <label className="sor-form-label">Passphrase (optional) <InfoTooltip text="Decryption passphrase for the private key, if the key is encrypted." /></label>
            {usesManagedSshSecrets ? (
              <PasswordInput
                ref={sshSecretManager.passphraseInputRef}
                value={passphraseValue}
                onChange={(e) =>
                  sshSecretManager.handlePassphraseChange(e.target.value)
                }
                isSaved={!!formData.id && sshSecretManager.hasPassphrase}
                className="sor-form-input"
                placeholder="Passphrase"
              />
            ) : (
              <PasswordInput
                value={passphraseValue}
                onChange={(e) =>
                  setFormData({ ...formData, passphrase: e.target.value })
                }
                className="sor-form-input"
                placeholder="Passphrase"
              />
            )}
          </div>
        </>
      )}

      <SSHKeyManager
        isOpen={mgr.showKeyManager}
        onClose={() => mgr.setShowKeyManager(false)}
        onSelectKey={mgr.handleSelectKey}
      />

      {/* SSH Terminal Settings Override */}
      {formData.protocol === "ssh" && (
        <SSHTerminalOverrides formData={formData} setFormData={setFormData} />
      )}

      {/* SSH Connection Settings Override */}
      {formData.protocol === "ssh" && (
        <SSHConnectionOverrides formData={formData} setFormData={setFormData} />
      )}
    </>
  );
};

/** Inline nickname edit button for trust record rows */
function NicknameEditButton({
  record,
  connectionId,
  onSaved,
}: {
  record: TrustRecord;
  connectionId?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.nickname ?? "");
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const [h, p] = record.host.split(":");
            updateTrustRecordNickname(
              h,
              parseInt(p, 10),
              record.type,
              draft.trim(),
              connectionId,
            );
            setEditing(false);
            onSaved();
          } else if (e.key === "Escape") {
            setDraft(record.nickname ?? "");
            setEditing(false);
          }
        }}
        onBlur={() => {
          const [h, p] = record.host.split(":");
          updateTrustRecordNickname(
            h,
            parseInt(p, 10),
            record.type,
            draft.trim(),
            connectionId,
          );
          setEditing(false);
          onSaved();
        }}
        placeholder="Nickname…"
        className="sor-form-input-xs w-24 text-[var(--color-textSecondary)]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(record.nickname ?? "");
        setEditing(true);
      }}
      className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
      title={record.nickname ? `Nickname: ${record.nickname}` : "Add nickname"}
    >
      <Pencil size={10} />
    </button>
  );
}

export default SSHOptions;
