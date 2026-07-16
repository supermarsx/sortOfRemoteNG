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
  | "display-input"
  | "resources"
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

  if (protocol === "spice" && section === "connection") {
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="spice-proxy-uri"
        >
          <span className="sor-form-label">
            SPICE HTTP CONNECT proxy URI (optional)
          </span>
          <input
            id="spice-proxy-uri"
            type="text"
            value={formData.spiceProxyUri ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                spiceProxyUri: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="http://proxy.example:3128"
          />
        </label>
        <div
          data-editor-search-field="spice-native-window"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          SPICE opens in the installed remote-viewer application. A running
          local viewer process does not prove that the remote server accepted
          authentication or produced a display. Generic proxy, VPN, SSH-hop, and
          tunnel-chain routes fail closed.
        </div>
      </section>
    );
  }

  if (protocol === "spice" && section === "authentication") {
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="spice-ticket"
        >
          <span className="sor-form-label">SPICE ticket (optional)</span>
          <PasswordInput
            id="spice-ticket"
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
          The ticket is delivered to remote-viewer through its standard input
          connection file. It is never placed in process arguments or a
          persistent profile.
        </p>
      </section>
    );
  }

  if (protocol === "spice" && section === "security") {
    const hasTlsPort = formData.spiceTlsPort !== undefined;
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <div data-editor-search-field="spice-require-tls">
          <CheckboxField
            id="spice-require-tls"
            label="Require a TLS SPICE transport"
            description="Reject a non-TLS SPICE URI instead of silently falling back."
            checked={formData.spiceRequireTls ?? false}
            onChange={(spiceRequireTls) =>
              setFormData((previous) => ({
                ...previous,
                spiceRequireTls,
                spiceTlsPort: spiceRequireTls
                  ? (previous.spiceTlsPort ?? 5901)
                  : previous.spiceTlsPort,
              }))
            }
            variant="form"
          />
        </div>
        <div data-editor-search-field="spice-tls-port-enabled">
          <CheckboxField
            id="spice-tls-port-enabled"
            label="Use a separate TLS port"
            description="Publishes tls-port in the remote-viewer connection file."
            checked={hasTlsPort}
            onChange={(enabled) =>
              setFormData((previous) => ({
                ...previous,
                spiceTlsPort: enabled
                  ? (previous.spiceTlsPort ?? 5901)
                  : undefined,
                spiceRequireTls: enabled ? previous.spiceRequireTls : false,
                spiceCaCertificatePath: enabled
                  ? previous.spiceCaCertificatePath
                  : undefined,
                spiceTlsHostSubject: enabled
                  ? previous.spiceTlsHostSubject
                  : undefined,
              }))
            }
            variant="form"
          />
        </div>
        {hasTlsPort && (
          <label
            className="block min-w-0"
            data-editor-search-field="spice-tls-port"
          >
            <span className="sor-form-label">TLS port</span>
            <NumberInput
              id="spice-tls-port"
              value={formData.spiceTlsPort ?? 5901}
              onChange={(spiceTlsPort) =>
                setFormData((previous) => ({ ...previous, spiceTlsPort }))
              }
              min={1}
              max={65535}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
        )}
        {hasTlsPort && (
          <>
            <label
              className="block min-w-0"
              data-editor-search-field="spice-ca-certificate"
            >
              <span className="sor-form-label">
                CA certificate path (optional)
              </span>
              <input
                id="spice-ca-certificate"
                type="text"
                value={formData.spiceCaCertificatePath ?? ""}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    spiceCaCertificatePath: event.target.value || undefined,
                  }))
                }
                className="sor-form-input-sm w-full min-w-0 font-mono"
                placeholder="/path/to/ca.pem"
              />
            </label>
            <label
              className="block min-w-0"
              data-editor-search-field="spice-host-subject"
            >
              <span className="sor-form-label">
                Expected certificate subject (optional)
              </span>
              <input
                id="spice-host-subject"
                type="text"
                value={formData.spiceTlsHostSubject ?? ""}
                onChange={(event) =>
                  setFormData((previous) => ({
                    ...previous,
                    spiceTlsHostSubject: event.target.value || undefined,
                  }))
                }
                className="sor-form-input-sm w-full min-w-0 font-mono"
                placeholder="C=US,O=Example,CN=spice.example"
              />
            </label>
          </>
        )}
        <div
          data-editor-search-field="spice-verified-certificates"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
          Unverified SPICE certificates are intentionally unsupported. Use
          system trust or provide the issuing CA certificate for a TLS port.
        </div>
      </section>
    );
  }

  if (protocol === "spice" && section === "display-input") {
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <div data-editor-search-field="spice-fullscreen">
          <CheckboxField
            id="spice-fullscreen"
            label="Open remote-viewer fullscreen"
            checked={formData.spiceFullscreen ?? false}
            onChange={(spiceFullscreen) =>
              setFormData((previous) => ({ ...previous, spiceFullscreen }))
            }
            variant="form"
          />
        </div>
        <div data-editor-search-field="spice-view-only">
          <CheckboxField
            id="spice-view-only"
            label="View only"
            description="Disable keyboard and pointer input in remote-viewer."
            checked={formData.spiceViewOnly ?? false}
            onChange={(spiceViewOnly) =>
              setFormData((previous) => ({ ...previous, spiceViewOnly }))
            }
            variant="form"
          />
        </div>
        <div
          data-editor-search-field="spice-clipboard-boundary"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          Clipboard follows remote-viewer's supported default. Disabling it is
          not exposed because the native connection-file handoff cannot enforce
          that setting.
        </div>
      </section>
    );
  }

  if (protocol === "spice" && section === "resources") {
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <div data-editor-search-field="spice-audio">
          <CheckboxField
            id="spice-audio"
            label="Enable audio playback"
            checked={formData.spiceAudioPlayback ?? true}
            onChange={(spiceAudioPlayback) =>
              setFormData((previous) => ({
                ...previous,
                spiceAudioPlayback,
              }))
            }
            variant="form"
          />
        </div>
        <div data-editor-search-field="spice-usb-redirection">
          <CheckboxField
            id="spice-usb-redirection"
            label="Enable USB redirection"
            description="Allows the installed remote-viewer to offer local USB devices."
            checked={formData.spiceUsbRedirection ?? false}
            onChange={(spiceUsbRedirection) =>
              setFormData((previous) => ({
                ...previous,
                spiceUsbRedirection,
              }))
            }
            variant="form"
          />
        </div>
      </section>
    );
  }

  if (protocol === "spice" && section === "advanced") {
    return (
      <section data-editor-search-section="spice-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="spice-native-client"
        >
          <span className="sor-form-label">
            remote-viewer executable path (optional)
          </span>
          <input
            id="spice-native-client"
            type="text"
            value={formData.spiceNativeClientPath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                spiceNativeClientPath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Auto-detect remote-viewer from virt-viewer"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Leave empty to search PATH and standard virt-viewer install locations.
          The path must name a local remote-viewer executable.
        </p>
      </section>
    );
  }

  if (protocol === "xdmcp" && section === "connection") {
    return (
      <section data-editor-search-section="xdmcp-options" className={cardClass}>
        <div data-editor-search-field="xdmcp-query-type">
          <Select
            id="xdmcp-query-type"
            label="Query type"
            value={formData.xdmcpQueryType ?? "Direct"}
            onChange={(xdmcpQueryType) =>
              setFormData((previous) => ({
                ...previous,
                xdmcpQueryType: xdmcpQueryType as
                  | "Direct"
                  | "Broadcast"
                  | "Indirect",
              }))
            }
            options={[
              { value: "Direct", label: "Direct query" },
              { value: "Broadcast", label: "Broadcast query" },
              { value: "Indirect", label: "Indirect chooser query" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="xdmcp-display-number"
        >
          <span className="sor-form-label">Local display number</span>
          <NumberInput
            id="xdmcp-display-number"
            value={formData.xdmcpDisplayNumber ?? 10}
            onChange={(xdmcpDisplayNumber) =>
              setFormData((previous) => ({
                ...previous,
                xdmcpDisplayNumber,
              }))
            }
            min={0}
            max={65535}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </label>
      </section>
    );
  }

  if (protocol === "xdmcp" && section === "security") {
    return (
      <section
        data-editor-search-section="xdmcp-options"
        className={`${cardClass} border-error/45 bg-error/5`}
      >
        <div
          data-editor-search-field="xdmcp-insecure-warning"
          className="flex items-start gap-2 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-error" />
          <div>
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              XDMCP is unauthenticated and unencrypted
            </h4>
            <p className="mt-1">
              Hosts on the path can observe or alter the login display and
              session traffic. Use only on a trusted, isolated network. App
              proxy, VPN, SSH-hop, and tunnel-chain settings are rejected rather
              than silently bypassed.
            </p>
          </div>
        </div>
        <div data-editor-search-field="xdmcp-insecure-acknowledgement">
          <CheckboxField
            id="xdmcp-insecure-acknowledgement"
            label="I understand and accept the XDMCP transport risk"
            description="Required before the local X server can be launched."
            checked={formData.xdmcpAcknowledgeInsecureTransport ?? false}
            onChange={(xdmcpAcknowledgeInsecureTransport) =>
              setFormData((previous) => ({
                ...previous,
                xdmcpAcknowledgeInsecureTransport,
              }))
            }
            variant="form"
          />
        </div>
      </section>
    );
  }

  if (protocol === "xdmcp" && section === "display-input") {
    return (
      <section data-editor-search-section="xdmcp-options" className={cardClass}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="min-w-0" data-editor-search-field="xdmcp-width">
            <span className="sor-form-label">Window width</span>
            <NumberInput
              id="xdmcp-width"
              value={formData.xdmcpResolutionWidth ?? 1024}
              onChange={(xdmcpResolutionWidth) =>
                setFormData((previous) => ({
                  ...previous,
                  xdmcpResolutionWidth,
                }))
              }
              min={320}
              max={16384}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
          <label className="min-w-0" data-editor-search-field="xdmcp-height">
            <span className="sor-form-label">Window height</span>
            <NumberInput
              id="xdmcp-height"
              value={formData.xdmcpResolutionHeight ?? 768}
              onChange={(xdmcpResolutionHeight) =>
                setFormData((previous) => ({
                  ...previous,
                  xdmcpResolutionHeight,
                }))
              }
              min={200}
              max={16384}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
        </div>
        <div
          data-editor-search-field="xdmcp-color-depth"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          XDMCP uses the native X server's supported 24-bit display default.
          Alternative depth values are not exposed because they cannot be
          applied consistently to Xephyr, VcXsrv, and Xming.
        </div>
        <div data-editor-search-field="xdmcp-fullscreen">
          <CheckboxField
            id="xdmcp-fullscreen"
            label="Launch the local X server fullscreen"
            checked={formData.xdmcpFullscreen ?? false}
            onChange={(xdmcpFullscreen) =>
              setFormData((previous) => ({ ...previous, xdmcpFullscreen }))
            }
            variant="form"
          />
        </div>
      </section>
    );
  }

  if (protocol === "xdmcp" && section === "advanced") {
    const serverType =
      typeof formData.xdmcpXServerType === "string"
        ? formData.xdmcpXServerType
        : "";
    return (
      <section data-editor-search-section="xdmcp-options" className={cardClass}>
        <div data-editor-search-field="xdmcp-x-server-type">
          <Select
            id="xdmcp-x-server-type"
            label="Local X server"
            value={serverType}
            placeholder="Platform default (VcXsrv or Xephyr)"
            onChange={(xdmcpXServerType) =>
              setFormData((previous) => ({
                ...previous,
                xdmcpXServerType:
                  xdmcpXServerType === ""
                    ? undefined
                    : (xdmcpXServerType as "Xephyr" | "VcXsrv" | "Xming"),
              }))
            }
            options={[
              { value: "", label: "Platform default (VcXsrv or Xephyr)" },
              { value: "Xephyr", label: "Xephyr" },
              { value: "VcXsrv", label: "VcXsrv" },
              { value: "Xming", label: "Xming" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="xdmcp-x-server-path"
        >
          <span className="sor-form-label">
            X server executable path (optional)
          </span>
          <input
            id="xdmcp-x-server-path"
            type="text"
            value={formData.xdmcpXServerPath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                xdmcpXServerPath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Auto-detect the selected X server"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          A running local X server process is the only status sortOfRemoteNG can
          verify. The display manager login and remote desktop remain owned by
          that external window.
        </p>
      </section>
    );
  }

  if (protocol === "x2go" && section === "connection") {
    const sessionType = formData.x2goSessionType ?? "Xfce";
    const needsCommand =
      sessionType === "Custom" || sessionType === "Application";
    return (
      <section data-editor-search-section="x2go-options" className={cardClass}>
        <div data-editor-search-field="x2go-session-type">
          <Select
            id="x2go-session-type"
            label="Desktop or session type"
            value={sessionType}
            onChange={(x2goSessionType) =>
              setFormData((previous) => ({
                ...previous,
                x2goSessionType: x2goSessionType as NonNullable<
                  Connection["x2goSessionType"]
                >,
                x2goCommand: ["Custom", "Application"].includes(x2goSessionType)
                  ? previous.x2goCommand
                  : undefined,
              }))
            }
            options={[
              { value: "Xfce", label: "XFCE" },
              { value: "Kde", label: "KDE" },
              { value: "Gnome", label: "GNOME" },
              { value: "Lxde", label: "LXDE" },
              { value: "Lxqt", label: "LXQt" },
              { value: "Mate", label: "MATE" },
              { value: "Cinnamon", label: "Cinnamon" },
              { value: "Unity", label: "Unity" },
              { value: "Trinity", label: "Trinity" },
              { value: "Shadow", label: "Shadow an existing desktop" },
              { value: "Rdp", label: "X2Go RDP session" },
              { value: "Custom", label: "Custom desktop command" },
              { value: "Application", label: "Single application" },
            ]}
            searchable
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        {needsCommand && (
          <label
            className="block min-w-0"
            data-editor-search-field="x2go-command"
          >
            <span className="sor-form-label">Remote command</span>
            <input
              id="x2go-command"
              type="text"
              required
              value={formData.x2goCommand ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  x2goCommand: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
              placeholder="startxfce4 or xterm"
            />
          </label>
        )}
      </section>
    );
  }

  if (protocol === "x2go" && section === "authentication") {
    const authMode = formData.x2goAuthMode ?? "password";
    return (
      <section data-editor-search-section="x2go-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="x2go-username"
        >
          <span className="sor-form-label">Username</span>
          <input
            id="x2go-username"
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
        <div data-editor-search-field="x2go-auth-mode">
          <Select
            id="x2go-auth-mode"
            label="SSH authentication"
            value={authMode}
            onChange={(x2goAuthMode) =>
              setFormData((previous) => ({
                ...previous,
                x2goAuthMode: x2goAuthMode as NonNullable<
                  Connection["x2goAuthMode"]
                >,
                privateKey:
                  x2goAuthMode === "privateKey"
                    ? previous.privateKey
                    : undefined,
              }))
            }
            options={[
              { value: "password", label: "Native password prompt" },
              { value: "privateKey", label: "Private key or key path" },
              { value: "agent", label: "SSH agent" },
              { value: "gssapi", label: "GSSAPI / Kerberos" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        {authMode === "privateKey" && (
          <label
            className="block min-w-0"
            data-editor-search-field="x2go-private-key"
          >
            <span className="sor-form-label">
              Private key or local key path
            </span>
            <Textarea
              id="x2go-private-key"
              value={formData.privateKey ?? ""}
              onChange={(privateKey) =>
                setFormData((previous) => ({ ...previous, privateKey }))
              }
              rows={4}
              className="w-full min-w-0 resize-y font-mono text-xs"
              placeholder="C:\\Users\\you\\.ssh\\id_ed25519 or PEM key"
            />
          </label>
        )}
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Passwords, key passphrases, host trust, and MFA are requested by the
          installed X2Go Client. Saved passwords are deliberately not sent over
          IPC, process arguments, or the temporary session profile.
        </p>
      </section>
    );
  }

  if (protocol === "x2go" && section === "display-input") {
    return (
      <section data-editor-search-section="x2go-options" className={cardClass}>
        <div data-editor-search-field="x2go-fullscreen">
          <CheckboxField
            id="x2go-fullscreen"
            label="Open X2Go Client fullscreen"
            checked={formData.x2goFullscreen ?? false}
            onChange={(x2goFullscreen) =>
              setFormData((previous) => ({ ...previous, x2goFullscreen }))
            }
            variant="form"
          />
        </div>
        {!formData.x2goFullscreen && (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="min-w-0" data-editor-search-field="x2go-width">
              <span className="sor-form-label">Window width</span>
              <NumberInput
                id="x2go-width"
                value={formData.x2goWidth ?? 1280}
                onChange={(x2goWidth) =>
                  setFormData((previous) => ({ ...previous, x2goWidth }))
                }
                min={320}
                max={16384}
                variant="form-sm"
                className="w-full min-w-0"
              />
            </label>
            <label className="min-w-0" data-editor-search-field="x2go-height">
              <span className="sor-form-label">Window height</span>
              <NumberInput
                id="x2go-height"
                value={formData.x2goHeight ?? 800}
                onChange={(x2goHeight) =>
                  setFormData((previous) => ({ ...previous, x2goHeight }))
                }
                min={200}
                max={16384}
                variant="form-sm"
                className="w-full min-w-0"
              />
            </label>
          </div>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <label
            className="min-w-0"
            data-editor-search-field="x2go-keyboard-layout"
          >
            <span className="sor-form-label">Keyboard layout</span>
            <input
              id="x2go-keyboard-layout"
              type="text"
              value={formData.x2goKeyboardLayout ?? "us"}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  x2goKeyboardLayout: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
            />
          </label>
          <label
            className="min-w-0"
            data-editor-search-field="x2go-keyboard-model"
          >
            <span className="sor-form-label">Keyboard model</span>
            <input
              id="x2go-keyboard-model"
              type="text"
              value={formData.x2goKeyboardModel ?? "pc105/us"}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  x2goKeyboardModel: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
            />
          </label>
        </div>
        <div data-editor-search-field="x2go-clipboard">
          <Select
            id="x2go-clipboard"
            label="Clipboard direction"
            value={formData.x2goClipboard ?? "Both"}
            onChange={(x2goClipboard) =>
              setFormData((previous) => ({
                ...previous,
                x2goClipboard: x2goClipboard as NonNullable<
                  Connection["x2goClipboard"]
                >,
              }))
            }
            options={[
              { value: "Both", label: "Both directions" },
              { value: "ClientToServer", label: "Client to server" },
              { value: "ServerToClient", label: "Server to client" },
              { value: "None", label: "Disabled" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
      </section>
    );
  }

  if (protocol === "x2go" && section === "resources") {
    return (
      <section data-editor-search-section="x2go-options" className={cardClass}>
        <div data-editor-search-field="x2go-audio">
          <CheckboxField
            id="x2go-audio"
            label="Enable PulseAudio forwarding"
            checked={formData.x2goAudioEnabled ?? true}
            onChange={(x2goAudioEnabled) =>
              setFormData((previous) => ({
                ...previous,
                x2goAudioEnabled,
              }))
            }
            variant="form"
          />
        </div>
        <div data-editor-search-field="x2go-printing">
          <CheckboxField
            id="x2go-printing"
            label="Enable client-side printing"
            checked={formData.x2goPrintingEnabled ?? false}
            onChange={(x2goPrintingEnabled) =>
              setFormData((previous) => ({
                ...previous,
                x2goPrintingEnabled,
              }))
            }
            variant="form"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="x2go-shared-folders"
        >
          <span className="sor-form-label">
            Shared local folders (one path per line)
          </span>
          <Textarea
            id="x2go-shared-folders"
            value={(formData.x2goSharedFolders ?? [])
              .map((folder) => folder.local_path)
              .join("\n")}
            onChange={(value) =>
              setFormData((previous) => ({
                ...previous,
                x2goSharedFolders: Array.from(
                  new Set(
                    value
                      .split(/\r?\n/)
                      .map((path) => path.trim())
                      .filter(Boolean),
                  ),
                ).map((local_path) => ({
                  local_path,
                  remote_name: "",
                  auto_mount: true,
                })),
              }))
            }
            rows={4}
            className="w-full min-w-0 resize-y font-mono text-xs"
            placeholder="C:\\Users\\you\\Documents"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Custom remote folder names are not exposed because X2Go Client's
          portable profile cannot represent them reliably.
        </p>
      </section>
    );
  }

  if (protocol === "x2go" && section === "advanced") {
    return (
      <section data-editor-search-section="x2go-options" className={cardClass}>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div data-editor-search-field="x2go-compression">
            <Select
              id="x2go-compression"
              label="Link profile"
              value={formData.x2goCompression ?? "Adsl"}
              onChange={(x2goCompression) =>
                setFormData((previous) => ({
                  ...previous,
                  x2goCompression: x2goCompression as NonNullable<
                    Connection["x2goCompression"]
                  >,
                }))
              }
              options={[
                { value: "Modem", label: "Modem" },
                { value: "Isdn", label: "ISDN" },
                { value: "Adsl", label: "ADSL" },
                { value: "Wan", label: "WAN" },
                { value: "Lan", label: "LAN" },
              ]}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </div>
          <label className="min-w-0" data-editor-search-field="x2go-dpi">
            <span className="sor-form-label">DPI</span>
            <NumberInput
              id="x2go-dpi"
              value={formData.x2goDpi ?? 96}
              onChange={(x2goDpi) =>
                setFormData((previous) => ({ ...previous, x2goDpi }))
              }
              min={50}
              max={600}
              variant="form-sm"
              className="w-full min-w-0"
            />
          </label>
        </div>
        <div data-editor-search-field="x2go-rootless">
          <CheckboxField
            id="x2go-rootless"
            label="Rootless window mode"
            checked={formData.x2goRootless ?? false}
            onChange={(x2goRootless) =>
              setFormData((previous) => ({ ...previous, x2goRootless }))
            }
            variant="form"
          />
        </div>
        <div data-editor-search-field="x2go-published-applications">
          <CheckboxField
            id="x2go-published-applications"
            label="Published applications mode"
            checked={formData.x2goPublishedApplications ?? false}
            onChange={(x2goPublishedApplications) =>
              setFormData((previous) => ({
                ...previous,
                x2goPublishedApplications,
              }))
            }
            variant="form"
          />
        </div>
        <label
          className="block min-w-0"
          data-editor-search-field="x2go-native-client"
        >
          <span className="sor-form-label">
            x2goclient executable path (optional)
          </span>
          <input
            id="x2go-native-client"
            type="text"
            value={formData.x2goNativeClientPath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                x2goNativeClientPath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Auto-detect x2goclient"
          />
        </label>
        <div
          data-editor-search-field="x2go-native-window"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          sortOfRemoteNG verifies only that the installed X2Go Client process is
          running. Authentication, pixels, input, host trust, and remote session
          selection remain in its native window. App routes fail closed.
        </div>
      </section>
    );
  }

  if (protocol === "nx" && section === "connection") {
    const sessionType = formData.nxSessionType ?? "UnixDesktop";
    const needsCommand =
      sessionType === "UnixCustom" || sessionType === "Application";
    return (
      <section data-editor-search-section="nx-options" className={cardClass}>
        <div data-editor-search-field="nx-connection-service">
          <Select
            id="nx-connection-service"
            label="NoMachine transport"
            value={formData.nxConnectionService ?? "nx"}
            onChange={(value) =>
              setFormData((previous) => {
                const nxConnectionService = value as "nx" | "ssh";
                const previousDefault =
                  (previous.nxConnectionService ?? "nx") === "ssh" ? 22 : 4000;
                return {
                  ...previous,
                  nxConnectionService,
                  port:
                    !previous.port || previous.port === previousDefault
                      ? nxConnectionService === "ssh"
                        ? 22
                        : 4000
                      : previous.port,
                };
              })
            }
            options={[
              { value: "nx", label: "NX service (port 4000)" },
              { value: "ssh", label: "NoMachine over SSH (port 22)" },
            ]}
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        <div data-editor-search-field="nx-session-type">
          <Select
            id="nx-session-type"
            label="Desktop or session type"
            value={sessionType}
            onChange={(nxSessionType) =>
              setFormData((previous) => ({
                ...previous,
                nxSessionType: nxSessionType as NonNullable<
                  Connection["nxSessionType"]
                >,
                nxCustomCommand: ["UnixCustom", "Application"].includes(
                  nxSessionType,
                )
                  ? previous.nxCustomCommand
                  : undefined,
              }))
            }
            options={[
              { value: "UnixDesktop", label: "Default Unix desktop" },
              { value: "UnixGnome", label: "GNOME" },
              { value: "UnixKde", label: "KDE" },
              { value: "UnixXfce", label: "XFCE" },
              { value: "Console", label: "Console session" },
              { value: "Shadow", label: "Physical desktop chooser" },
              { value: "UnixCustom", label: "Custom Unix command" },
              { value: "Application", label: "Single application" },
            ]}
            searchable
            variant="form-sm"
            className="w-full min-w-0"
          />
        </div>
        {needsCommand && (
          <label
            className="block min-w-0"
            data-editor-search-field="nx-command"
          >
            <span className="sor-form-label">Remote command</span>
            <input
              id="nx-command"
              type="text"
              required
              value={formData.nxCustomCommand ?? ""}
              onChange={(event) =>
                setFormData((previous) => ({
                  ...previous,
                  nxCustomCommand: event.target.value,
                }))
              }
              className="sor-form-input-sm w-full min-w-0 font-mono"
              placeholder="startxfce4 or xterm"
            />
          </label>
        )}
      </section>
    );
  }

  if (protocol === "nx" && section === "authentication") {
    return (
      <section data-editor-search-section="nx-options" className={cardClass}>
        <label className="block min-w-0" data-editor-search-field="nx-username">
          <span className="sor-form-label">Username (optional)</span>
          <input
            id="nx-username"
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
        <label
          className="block min-w-0"
          data-editor-search-field="nx-private-key"
        >
          <span className="sor-form-label">
            Private key or local key path (optional)
          </span>
          <Textarea
            id="nx-private-key"
            value={formData.privateKey ?? ""}
            onChange={(privateKey) =>
              setFormData((previous) => ({ ...previous, privateKey }))
            }
            rows={4}
            className="w-full min-w-0 resize-y font-mono text-xs"
            placeholder="Leave empty for the native password prompt"
          />
        </label>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          NoMachine Client owns password, key-passphrase, host-trust, and MFA
          prompts. A saved password is never sent over IPC, placed on the
          command line, or written into its temporary NXS profile.
        </p>
      </section>
    );
  }

  if (protocol === "nx" && section === "display-input") {
    return (
      <section data-editor-search-section="nx-options" className={cardClass}>
        <div data-editor-search-field="nx-fullscreen">
          <CheckboxField
            id="nx-fullscreen"
            label="Open NoMachine Client fullscreen"
            checked={formData.nxFullscreen ?? false}
            onChange={(nxFullscreen) =>
              setFormData((previous) => ({ ...previous, nxFullscreen }))
            }
            variant="form"
          />
        </div>
        {!formData.nxFullscreen && (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="min-w-0" data-editor-search-field="nx-width">
              <span className="sor-form-label">Window width</span>
              <NumberInput
                id="nx-width"
                value={formData.nxWidth ?? 1280}
                onChange={(nxWidth) =>
                  setFormData((previous) => ({ ...previous, nxWidth }))
                }
                min={320}
                max={16384}
                variant="form-sm"
                className="w-full min-w-0"
              />
            </label>
            <label className="min-w-0" data-editor-search-field="nx-height">
              <span className="sor-form-label">Window height</span>
              <NumberInput
                id="nx-height"
                value={formData.nxHeight ?? 800}
                onChange={(nxHeight) =>
                  setFormData((previous) => ({ ...previous, nxHeight }))
                }
                min={200}
                max={16384}
                variant="form-sm"
                className="w-full min-w-0"
              />
            </label>
          </div>
        )}
        <div
          data-editor-search-field="nx-native-input"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          Keyboard, pointer, and clipboard interaction occur in the native
          NoMachine window. Clipboard is left enabled; disabling it must be
          configured in NoMachine because the portable profile cannot enforce
          that setting safely.
        </div>
      </section>
    );
  }

  if (protocol === "nx" && section === "resources") {
    return (
      <section data-editor-search-section="nx-options" className={cardClass}>
        <div data-editor-search-field="nx-audio">
          <CheckboxField
            id="nx-audio"
            label="Enable NoMachine audio"
            checked={formData.nxAudioEnabled ?? true}
            onChange={(nxAudioEnabled) =>
              setFormData((previous) => ({ ...previous, nxAudioEnabled }))
            }
            variant="form"
          />
        </div>
        <p className="text-[11px] leading-4 text-[var(--color-textMuted)]">
          Folder sharing, printer details, and media-forwarding policies remain
          native-client choices because the current saved model cannot express
          their permission and target details safely.
        </p>
      </section>
    );
  }

  if (protocol === "nx" && section === "advanced") {
    return (
      <section data-editor-search-section="nx-options" className={cardClass}>
        <label
          className="block min-w-0"
          data-editor-search-field="nx-native-client"
        >
          <span className="sor-form-label">
            nxplayer executable path (optional)
          </span>
          <input
            id="nx-native-client"
            type="text"
            value={formData.nxNativeClientPath ?? ""}
            onChange={(event) =>
              setFormData((previous) => ({
                ...previous,
                nxNativeClientPath: event.target.value || undefined,
              }))
            }
            className="sor-form-input-sm w-full min-w-0 font-mono"
            placeholder="Auto-detect nxplayer"
          />
        </label>
        <div
          data-editor-search-field="nx-native-window"
          className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40 p-2.5 text-[11px] leading-4 text-[var(--color-textMuted)]"
        >
          <Monitor size={14} className="mt-0.5 shrink-0 text-primary" />
          sortOfRemoteNG verifies only that the installed NoMachine Client
          process is running. Remote authentication, pixels, and input remain in
          its native window. Proxy, VPN, SSH-hop, and tunnel-chain settings fail
          closed.
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
