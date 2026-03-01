import React, { useState } from "react";
import { Key, Fingerprint, Trash2, Pencil } from "lucide-react";
import { PasswordInput } from "../ui/PasswordInput";
import { Connection } from "../../types/connection";
import { SSHKeyManager } from "../SSHKeyManager";
import { SSHTerminalOverrides } from "./SSHTerminalOverrides";
import { SSHConnectionOverrides } from "./SSHConnectionOverrides";
import {
  getAllTrustRecords,
  removeIdentity,
  clearAllTrustRecords,
  formatFingerprint,
  updateTrustRecordNickname,
  type TrustRecord,
} from "../../utils/trustStore";
import { useSSHOptions } from "../../hooks/ssh/useSSHOptions";

type Mgr = ReturnType<typeof useSSHOptions>;

interface SSHOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

export const SSHOptions: React.FC<SSHOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useSSHOptions(formData, setFormData);

  if (formData.isGroup || mgr.isHttpProtocol) return null;

  return (
    <>
      <div>
        <label className="sor-form-label">Username</label>
        <input
          type="text"
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
            <label className="sor-form-label">Authentication Type</label>
            <select
              value={formData.authType ?? "password"}
              onChange={(e) =>
                setFormData({ ...formData, authType: e.target.value as any })
              }
              className="sor-form-select"
            >
              <option value="password">Password</option>
              <option value="key">Private Key</option>
            </select>
          </div>
          <label className="sor-form-inline-check">
            <input
              type="checkbox"
              checked={formData.ignoreSshSecurityErrors ?? true}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  ignoreSshSecurityErrors: e.target.checked,
                })
              }
              className="sor-form-checkbox"
            />
            <span>Ignore SSH security errors (host keys/certs)</span>
          </label>
          <div>
            <label className="sor-form-label">Host Key Trust Policy</label>
            <select
              value={formData.sshTrustPolicy ?? ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sshTrustPolicy:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as
                          | "tofu"
                          | "always-ask"
                          | "always-trust"
                          | "strict"),
                })
              }
              className="sor-form-select text-sm"
            >
              <option value="">Use global default</option>
              <option value="tofu">Trust On First Use (TOFU)</option>
              <option value="always-ask">Always Ask</option>
              <option value="always-trust">
                Always Trust (skip verification)
              </option>
              <option value="strict">
                Strict (reject unless pre-approved)
              </option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
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
                    <label className="block text-sm font-medium text-[var(--color-textSecondary)] flex items-center gap-1.5">
                      <Fingerprint size={14} className="text-green-400" />
                      Stored Host Keys ({records.length})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        clearAllTrustRecords(formData.id);
                        setFormData({ ...formData }); // force re-render
                      }}
                      className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {records.map((record, i) => {
                      const [host, portStr] = record.host.split(":");
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 bg-[var(--color-border)]/50 border border-[var(--color-border)]/50 rounded px-3 py-1.5 text-xs"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[var(--color-textSecondary)] truncate">
                                {record.nickname || record.host}
                              </p>
                              {record.nickname && (
                                <p className="text-gray-500 truncate">
                                  ({record.host})
                                </p>
                              )}
                            </div>
                            <p className="font-mono text-gray-500 truncate">
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
                            className="text-gray-500 hover:text-red-400 p-0.5 transition-colors flex-shrink-0"
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
              <label className="sor-form-label">Connect Timeout (sec)</label>
              <input
                type="number"
                min={5}
                max={300}
                value={formData.sshConnectTimeout ?? 30}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sshConnectTimeout: Number(e.target.value) || 30,
                  })
                }
                className="sor-form-input"
              />
            </div>
            <div>
              <label className="sor-form-label">Keep Alive (sec)</label>
              <input
                type="number"
                min={10}
                max={600}
                value={formData.sshKeepAliveInterval ?? 60}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sshKeepAliveInterval: Number(e.target.value) || 60,
                  })
                }
                className="sor-form-input"
              />
            </div>
            <div>
              <label className="sor-form-label">Known Hosts Path</label>
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
          <label className="sor-form-label">Password</label>
          <PasswordInput
            value={formData.password || ""}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            className="sor-form-input"
            placeholder="Password"
          />
        </div>
      )}

      {formData.protocol === "ssh" && formData.authType === "key" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
                Private Key
              </label>
              <button
                type="button"
                onClick={() => mgr.setShowKeyManager(true)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-md transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Manage Keys
              </button>
            </div>
            <textarea
              value={formData.privateKey || ""}
              onChange={(e) =>
                setFormData({ ...formData, privateKey: e.target.value })
              }
              rows={4}
              className="sor-form-textarea resize-none"
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
            <label className="sor-form-label">Passphrase (optional)</label>
            <PasswordInput
              value={formData.passphrase || ""}
              onChange={(e) =>
                setFormData({ ...formData, passphrase: e.target.value })
              }
              className="sor-form-input"
              placeholder="Passphrase"
            />
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
        className="sor-form-input-xs w-24 text-gray-200"
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
      className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5 transition-colors flex-shrink-0"
      title={record.nickname ? `Nickname: ${record.nickname}` : "Add nickname"}
    >
      <Pencil size={10} />
    </button>
  );
}

export default SSHOptions;
