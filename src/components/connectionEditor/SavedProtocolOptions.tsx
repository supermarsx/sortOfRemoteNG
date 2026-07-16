import React from "react";
import {
  AlertTriangle,
  Database,
  FolderOpen,
  KeyRound,
  Monitor,
  ShieldCheck,
} from "lucide-react";
import type { Connection } from "../../types/connection/connection";
import {
  CheckboxField,
  NumberInput,
  PasswordInput,
  Select,
  Textarea,
} from "../ui/forms";

export type SavedProtocolOptionsSection =
  | "connection"
  | "authentication"
  | "security"
  | "advanced";

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

  if (protocol === "ftp" && section === "connection") {
    return (
      <section data-editor-search-section="ftp-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="ftp-remote-path"
        >
          <span className="sor-form-label">Initial remote directory</span>
          <input
            id="ftp-remote-path"
            type="text"
            value={formData.remotePath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                remotePath: event.target.value,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="/"
          />
        </label>
        <div data-editor-search-field="ftp-data-channel-mode">
          <Select
            id="ftp-data-channel-mode"
            label="Data connection mode"
            value={formData.ftpDataChannelMode ?? "passive"}
            onChange={(ftpDataChannelMode) =>
              setFormData((previous) => ({
                ...previous,
                ftpDataChannelMode: ftpDataChannelMode as
                  | "passive"
                  | "extendedPassive",
              }))
            }
            options={[
              { value: "passive", label: "Passive (PASV)" },
              { value: "extendedPassive", label: "Extended passive (EPSV)" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Active PORT/EPRT transfers are intentionally unavailable until the
          native backend can complete them without deadlocking.
        </p>
      </section>
    );
  }

  if (protocol === "ftp" && section === "authentication") {
    return (
      <section data-editor-search-section="ftp-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="ftp-username"
        >
          <span className="sor-form-label">Username</span>
          <input
            id="ftp-username"
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
            placeholder="anonymous"
          />
        </label>
        <label className="block min-w-0">
          <span className="sor-form-label">Password</span>
          <PasswordInput
            id="ftp-password"
            data-editor-search-field="ftp-password"
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
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Leave both fields empty for conventional anonymous FTP credentials.
        </p>
      </section>
    );
  }

  if (protocol === "ftp" && section === "security") {
    const security = formData.ftpSecurity ?? "none";
    return (
      <section data-editor-search-section="ftp-options" className={cardClass}>
        <div data-editor-search-field="ftp-security-mode">
          <Select
            id="ftp-security-mode"
            label="Transport security"
            value={security}
            onChange={(ftpSecurity) =>
              setFormData((previous) => ({
                ...previous,
                ftpSecurity: ftpSecurity as "none" | "explicit" | "implicit",
              }))
            }
            options={[
              { value: "none", label: "FTP (unencrypted)" },
              { value: "explicit", label: "Explicit FTPS (AUTH TLS)" },
              { value: "implicit", label: "Implicit FTPS" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <div data-editor-search-field="ftp-invalid-certificates">
          <CheckboxField
            id="ftp-accept-invalid-certificates"
            label="Accept invalid TLS certificates"
            description="Unsafe: disables certificate validation for FTPS."
            checked={formData.ftpAcceptInvalidCerts ?? false}
            onChange={(ftpAcceptInvalidCerts) =>
              setFormData((previous) => ({
                ...previous,
                ftpAcceptInvalidCerts,
              }))
            }
            variant="form"
          />
        </div>
        {(security === "none" || formData.ftpAcceptInvalidCerts) && (
          <div className="flex items-start gap-2 rounded-md border border-warning/35 bg-warning/5 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
            {security === "none"
              ? "Plain FTP sends credentials and file contents without transport encryption."
              : "Certificate validation is disabled; a machine-in-the-middle can impersonate this server."}
          </div>
        )}
      </section>
    );
  }

  if (protocol === "ftp" && section === "advanced") {
    return (
      <section data-editor-search-section="ftp-options" className={cardClass}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label
            className="min-w-0"
            data-editor-search-field="ftp-connect-timeout"
          >
            <span className="sor-form-label">Connect timeout (seconds)</span>
            <NumberInput
              id="ftp-connect-timeout"
              value={formData.ftpConnectTimeoutSec ?? formData.timeout ?? 15}
              onChange={(ftpConnectTimeoutSec) =>
                setFormData((previous) => ({
                  ...previous,
                  ftpConnectTimeoutSec,
                }))
              }
              min={1}
              max={600}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
          <label
            className="min-w-0"
            data-editor-search-field="ftp-data-timeout"
          >
            <span className="sor-form-label">Data timeout (seconds)</span>
            <NumberInput
              id="ftp-data-timeout"
              value={formData.ftpDataTimeoutSec ?? 30}
              onChange={(ftpDataTimeoutSec) =>
                setFormData((previous) => ({
                  ...previous,
                  ftpDataTimeoutSec,
                }))
              }
              min={1}
              max={3600}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
        </div>
        <div data-editor-search-field="ftp-utf8">
          <CheckboxField
            id="ftp-utf8"
            label="Request UTF-8 file names"
            description="Uses UTF-8 unless the server rejects the negotiation."
            checked={formData.ftpUtf8 ?? true}
            onChange={(ftpUtf8) =>
              setFormData((previous) => ({ ...previous, ftpUtf8 }))
            }
            variant="form"
          />
        </div>
      </section>
    );
  }

  if (protocol === "scp" && section === "connection") {
    return (
      <section data-editor-search-section="scp-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="scp-remote-path"
        >
          <span className="sor-form-label">Initial remote directory</span>
          <input
            id="scp-remote-path"
            type="text"
            value={formData.remotePath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                remotePath: event.target.value,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="/"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          SCP currently opens a direct SSH connection. Configured proxies, VPNs,
          and tunnel chains fail closed instead of being bypassed.
        </p>
      </section>
    );
  }

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

  if (
    (protocol === "sftp" || protocol === "scp") &&
    section === "authentication"
  ) {
    const usesKey = formData.authType === "key";
    const prefix = protocol;
    const label = protocol.toUpperCase();
    return (
      <section
        data-editor-search-section={`${prefix}-options`}
        className={cardClass}
      >
        <div data-editor-search-field={`${prefix}-auth-type`}>
          <Select
            id={`${prefix}-auth-type`}
            label={`${label} authentication`}
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
            id={`${prefix}-username`}
            data-editor-search-field={`${prefix}-username`}
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
                id={`${prefix}-private-key`}
                data-editor-search-field={`${prefix}-private-key`}
                value={formData.privateKey ?? ""}
                onChange={(privateKey) =>
                  setFormData((previous) => ({ ...previous, privateKey }))
                }
                rows={4}
                className="w-full min-w-0 resize-y font-mono text-xs"
                placeholder={`Paste the private key used by the ${label} server`}
              />
            </label>
            <label className="block min-w-0">
              <span className="sor-form-label">Key passphrase (optional)</span>
              <PasswordInput
                id={`${prefix}-passphrase`}
                data-editor-search-field={`${prefix}-passphrase`}
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
              id={`${prefix}-password`}
              data-editor-search-field={`${prefix}-password`}
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

  if (protocol === "scp" && section === "security") {
    return (
      <section data-editor-search-section="scp-options" className={cardClass}>
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <ShieldCheck size={15} className="text-primary" />
          SSH host identity
        </div>
        <div data-editor-search-field="scp-host-key-policy">
          <Select
            id="scp-host-key-policy"
            label="Host-key policy"
            value={formData.sshTrustPolicy ?? ""}
            onChange={(sshTrustPolicy) =>
              setFormData((previous) => ({
                ...previous,
                sshTrustPolicy:
                  sshTrustPolicy === ""
                    ? undefined
                    : (sshTrustPolicy as "tofu" | "always-ask" | "strict"),
              }))
            }
            options={[
              {
                value: "",
                label: "Fail closed for unknown hosts (safe default)",
              },
              { value: "tofu", label: "Trust on first use (accept new)" },
              {
                value: "always-ask",
                label: "Ask policy (fails closed without a prompt)",
              },
              { value: "strict", label: "Strict (known hosts only)" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
            disabled={formData.ignoreSshSecurityErrors === true}
          />
        </div>
        <div data-editor-search-field="scp-ignore-host-key-errors">
          <CheckboxField
            id="scp-ignore-host-key-errors"
            label="Ignore SSH host-key errors"
            description="Unsafe: sends credentials even when the server identity cannot be verified."
            checked={formData.ignoreSshSecurityErrors === true}
            onChange={(ignoreSshSecurityErrors) =>
              setFormData((previous) => ({
                ...previous,
                ignoreSshSecurityErrors,
              }))
            }
            variant="form"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="scp-known-hosts-path"
        >
          <span className="sor-form-label">Known hosts file (optional)</span>
          <input
            id="scp-known-hosts-path"
            type="text"
            value={formData.sshKnownHostsPath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                sshKnownHostsPath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Defaults to ~/.ssh/known_hosts"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Unknown hosts fail closed under the default Ask policy because this
          viewer does not yet provide an interactive fingerprint prompt.
        </p>
        {formData.ignoreSshSecurityErrors === true && (
          <div className="flex items-start gap-2 rounded-md border border-error/35 bg-error/5 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-error" />
            Host-key verification is disabled for this connection.
          </div>
        )}
      </section>
    );
  }

  if (protocol === "scp" && section === "advanced") {
    return (
      <section data-editor-search-section="scp-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="scp-connect-timeout"
        >
          <span className="sor-form-label">Connect timeout (seconds)</span>
          <NumberInput
            id="scp-connect-timeout"
            value={formData.sshConnectTimeout ?? formData.timeout ?? 30}
            onChange={(sshConnectTimeout) =>
              setFormData((previous) => ({
                ...previous,
                sshConnectTimeout,
              }))
            }
            min={1}
            max={600}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </label>
        <div data-editor-search-field="scp-compression">
          <CheckboxField
            id="scp-compression"
            label="Enable SSH compression"
            description="Can help on slow links; may waste CPU on already compressed files."
            checked={
              formData.sshConnectionConfigOverride?.enableCompression ?? false
            }
            onChange={(enableCompression) =>
              setFormData((previous) => ({
                ...previous,
                sshConnectionConfigOverride: {
                  ...previous.sshConnectionConfigOverride,
                  enableCompression,
                },
              }))
            }
            variant="form"
          />
        </div>
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

  if (protocol === "postgresql" && section === "connection") {
    return (
      <section
        data-editor-search-section="postgresql-options"
        className={cardClass}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
          <Database size={15} className="text-primary" />
          Database target
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="postgresql-database"
        >
          <span className="sor-form-label">Default database</span>
          <input
            id="postgresql-database"
            type="text"
            value={formData.database ?? "postgres"}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                database: event.target.value,
              }))
            }
            className="sor-form-input-sm w-full min-w-0"
            placeholder="postgres"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          The native PostgreSQL workbench opens an isolated database session for
          this tab.
        </p>
      </section>
    );
  }

  if (protocol === "postgresql" && section === "authentication") {
    return (
      <section
        data-editor-search-section="postgresql-options"
        className={cardClass}
      >
        <label
          className="block min-w-0"
          data-editor-search-field="postgresql-username"
        >
          <span className="sor-form-label">Username</span>
          <input
            id="postgresql-username"
            type="text"
            value={formData.username ?? "postgres"}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                username: event.target.value,
              }))
            }
            autoComplete="username"
            className="sor-form-input-sm w-full min-w-0"
            placeholder="postgres"
          />
        </label>
        <label
          className="block min-w-0"
          data-editor-search-field="postgresql-password"
        >
          <span className="sor-form-label">Password</span>
          <PasswordInput
            id="postgresql-password"
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
      </section>
    );
  }

  if (protocol === "postgresql" && section === "security") {
    const sslMode = formData.postgresSslMode ?? "prefer";
    return (
      <section
        data-editor-search-section="postgresql-options"
        className={cardClass}
      >
        <div data-editor-search-field="postgresql-ssl-mode">
          <Select
            id="postgresql-ssl-mode"
            label="SSL mode"
            value={sslMode}
            onChange={(postgresSslMode) =>
              setFormData((previous) => ({
                ...previous,
                postgresSslMode: postgresSslMode as
                  | "disable"
                  | "allow"
                  | "prefer"
                  | "require"
                  | "verify-ca"
                  | "verify-full",
              }))
            }
            options={[
              { value: "disable", label: "Disable" },
              { value: "allow", label: "Allow" },
              { value: "prefer", label: "Prefer (default)" },
              { value: "require", label: "Require encryption" },
              { value: "verify-ca", label: "Verify CA" },
              { value: "verify-full", label: "Verify CA and hostname" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="postgresql-ca-certificate"
        >
          <span className="sor-form-label">CA certificate path</span>
          <input
            id="postgresql-ca-certificate"
            type="text"
            value={formData.postgresCaCertificatePath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                postgresCaCertificatePath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Required only for Verify CA / Verify Full"
          />
        </label>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label
            className="min-w-0"
            data-editor-search-field="postgresql-client-certificate"
          >
            <span className="sor-form-label">Client certificate path</span>
            <input
              id="postgresql-client-certificate"
              type="text"
              value={formData.postgresClientCertificatePath ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  postgresClientCertificatePath:
                    event.target.value || undefined,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
              placeholder="Optional mTLS certificate"
            />
          </label>
          <label
            className="min-w-0"
            data-editor-search-field="postgresql-client-key"
          >
            <span className="sor-form-label">Client key path</span>
            <input
              id="postgresql-client-key"
              type="text"
              value={formData.postgresClientKeyPath ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  postgresClientKeyPath: event.target.value || undefined,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
              placeholder="Required with a client certificate"
            />
          </label>
        </div>
        {["disable", "allow", "prefer"].includes(sslMode) && (
          <div className="flex items-start gap-2 rounded-md border border-warning/35 bg-warning/5 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
            This SSL mode can use an unencrypted connection. Choose Require or a
            verification mode when transport confidentiality is mandatory.
          </div>
        )}
      </section>
    );
  }

  if (protocol === "postgresql" && section === "advanced") {
    return (
      <section
        data-editor-search-section="postgresql-options"
        className={cardClass}
      >
        <label
          className="block min-w-0"
          data-editor-search-field="postgresql-connect-timeout"
        >
          <span className="sor-form-label">Connect timeout (seconds)</span>
          <NumberInput
            id="postgresql-connect-timeout"
            value={
              formData.postgresConnectionTimeoutSecs ?? formData.timeout ?? 10
            }
            onChange={(postgresConnectionTimeoutSecs) =>
              setFormData((previous) => ({
                ...previous,
                postgresConnectionTimeoutSecs,
              }))
            }
            min={1}
            max={600}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </label>
        <div
          data-editor-search-field="postgresql-direct-route"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
          PostgreSQL currently supports direct connections only. A configured
          proxy, VPN, SSH hop, or tunnel chain is rejected before credentials
          are sent.
        </div>
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
