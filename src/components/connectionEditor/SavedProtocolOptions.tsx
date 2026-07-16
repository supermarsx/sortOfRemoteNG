import React from "react";
import {
  AlertTriangle,
  Database,
  FolderOpen,
  KeyRound,
  Monitor,
} from "lucide-react";
import type { Connection } from "../../types/connection/connection";
import { PasswordInput, Select, Textarea } from "../ui/forms";

export type SavedProtocolOptionsSection = "connection" | "authentication";

interface SavedProtocolOptionsProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  section: SavedProtocolOptionsSection;
}

const cardClass =
  "min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3";

export const SavedProtocolOptions: React.FC<SavedProtocolOptionsProps> = ({
  formData,
  setFormData,
  section,
}) => {
  const protocol = formData.protocol;

  if (protocol === "telnet" && section === "connection") {
    return (
      <section
        data-editor-search-section="telnet-options"
        data-editor-search-field="telnet-plaintext"
        className={`${cardClass} border-warning/35 bg-warning/5`}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              Plaintext terminal
            </h4>
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-textMuted)]">
              Telnet sends session data without transport encryption. Use it
              only on a trusted network or through a separately secured path.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (protocol === "sftp" && section === "authentication") {
    const usesKey = formData.authType === "key";
    return (
      <section data-editor-search-section="sftp-options" className={cardClass}>
        <div data-editor-search-field="sftp-auth-type">
          <Select
            id="sftp-auth-type"
            label="SFTP authentication"
            value={usesKey ? "key" : "password"}
            onChange={(authType) =>
              setFormData((previous) => ({
                ...previous,
                authType: authType as "password" | "key",
              }))
            }
            options={[
              { value: "password", label: "Username and password" },
              { value: "key", label: "Username and private key" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <label className="block min-w-0">
          <span className="sor-form-label">Username</span>
          <input
            id="sftp-username"
            data-editor-search-field="sftp-username"
            type="text"
            value={formData.username ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                username: event.target.value,
              }))
            }
            autoComplete="username"
            className="sor-form-input-sm w-full min-w-0"
          />
        </label>
        {usesKey ? (
          <>
            <label className="block min-w-0">
              <span className="sor-form-label">Private key</span>
              <Textarea
                id="sftp-private-key"
                data-editor-search-field="sftp-private-key"
                value={formData.privateKey ?? ""}
                onChange={(privateKey) =>
                  setFormData((previous) => ({ ...previous, privateKey }))
                }
                rows={4}
                className="w-full min-w-0 resize-y font-mono text-xs"
                placeholder="Paste the private key used by the SFTP server"
              />
            </label>
            <label className="block min-w-0">
              <span className="sor-form-label">Key passphrase (optional)</span>
              <PasswordInput
                id="sftp-passphrase"
                data-editor-search-field="sftp-passphrase"
                value={formData.passphrase ?? ""}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    passphrase: event.target.value,
                  }))
                }
                className="sor-form-input-sm w-full min-w-0"
                autoComplete="new-password"
              />
            </label>
          </>
        ) : (
          <label className="block min-w-0">
            <span className="sor-form-label">Password</span>
            <PasswordInput
              id="sftp-password"
              data-editor-search-field="sftp-password"
              value={formData.password ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  password: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0"
              autoComplete="current-password"
            />
          </label>
        )}
      </section>
    );
  }

  if (protocol === "mysql" && section === "connection") {
    return (
      <section
        data-editor-search-section="mysql-options"
        data-editor-search-field="mysql-database"
        className={cardClass}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <Database size={15} className="text-primary" />
          Default database
        </div>
        <input
          id="mysql-database"
          type="text"
          value={formData.database ?? ""}
          onChange={(event) =>
            setFormData((previous) => ({
              ...previous,
              database: event.target.value,
            }))
          }
          className="sor-form-input-sm w-full min-w-0"
          placeholder="Optional database or schema"
        />
      </section>
    );
  }

  if (protocol === "smb" && section === "connection") {
    return (
      <section data-editor-search-section="smb-options" className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <FolderOpen size={15} className="text-primary" />
          Share defaults
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0" data-editor-search-field="smb-share">
            <span className="sor-form-label">Share name (optional)</span>
            <input
              id="smb-share-name"
              type="text"
              value={formData.shareName ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  shareName: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0"
              placeholder="Shared"
            />
          </label>
          <label className="min-w-0" data-editor-search-field="smb-workgroup">
            <span className="sor-form-label">Workgroup (optional)</span>
            <input
              id="smb-workgroup"
              type="text"
              value={formData.workgroup ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  workgroup: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0"
              placeholder="WORKGROUP"
            />
          </label>
        </div>
      </section>
    );
  }

  if (protocol === "rustdesk" && section === "connection") {
    return (
      <section
        data-editor-search-section="rustdesk-options"
        className={cardClass}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <Monitor size={15} className="text-primary" />
          RustDesk target
        </div>
        <label className="block min-w-0" data-editor-search-field="rustdesk-id">
          <span className="sor-form-label">Remote device ID</span>
          <input
            id="rustdesk-id"
            type="text"
            required
            value={formData.rustdeskId ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                rustdeskId: event.target.value,
                hostname: event.target.value,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="RustDesk device ID"
          />
        </label>
        <label
          className="block min-w-0"
          data-editor-search-field="rustdesk-password"
        >
          <span className="sor-form-label">Unattended password (optional)</span>
          <PasswordInput
            id="rustdesk-password"
            value={formData.rustdeskPassword ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                rustdeskPassword: event.target.value,
              }))
            }
            className="sor-form-input-sm w-full min-w-0"
            autoComplete="current-password"
          />
        </label>
      </section>
    );
  }

  return (
    <section className={cardClass}>
      <div className="flex items-start gap-2 text-[11px] leading-4 text-[var(--color-textMuted)]">
        <KeyRound size={14} className="mt-0.5 shrink-0" />
        Connection credentials are configured on the Basics page.
      </div>
    </section>
  );
};

export default SavedProtocolOptions;
