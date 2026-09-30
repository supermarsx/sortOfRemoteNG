import React, { useContext } from "react";
import { ConnectionContext } from "../../../contexts/ConnectionContextTypes";
import type { TunnelChainLayer } from "../../../types/connection/connection";
import { Select } from "../../ui/forms";

type SshConfig = NonNullable<TunnelChainLayer["sshTunnel"]>;

/** A linked source stores only identity. Credentials are disclosed at connect time. */
export function SshSourceFields({
  value,
  onChange,
}: {
  value: SshConfig;
  onChange: (value: SshConfig) => void;
}) {
  const context = useContext(ConnectionContext);
  const connections =
    context?.state.connections.filter(
      (c) => c.protocol === "ssh" && !c.isGroup,
    ) ?? [];
  const linked = value.connectionId !== undefined;
  const authMethod =
    value.authMethod ?? (value.privateKey ? "key" : "password");
  const available = connections.some((c) => c.id === value.connectionId);
  const owner = context?.databaseAvailability;
  const inputClass = "sor-form-input";
  const selectSource = (connectionId: string | undefined) =>
    onChange({
      ...value,
      connectionId,
      ownerDatabaseId:
        connectionId !== undefined && owner?.status === "ready"
          ? owner.databaseId
          : undefined,
      host: undefined,
      port: connectionId === undefined ? 22 : undefined,
      username: undefined,
      password: undefined,
      privateKey: undefined,
      passphrase: undefined,
      jumpHosts: undefined,
      authMethod: connectionId === undefined ? "password" : undefined,
    });
  return (
    <div className="space-y-3">
      <label className="sor-form-label">
        SSH source
        <Select
          label="SSH source"
          variant="form"
          value={linked ? "saved" : "standalone"}
          onChange={(source) =>
            selectSource(source === "saved" ? "" : undefined)
          }
          options={[
            { value: "standalone", label: "Standalone credentials" },
            { value: "saved", label: "Saved SSH connection" },
          ]}
        />
      </label>
      {linked ? (
        <>
          <label className="sor-form-label">
            Saved SSH connection
            <Select
              label="Saved SSH connection"
              variant="form"
              searchable
              searchPlaceholder="Search SSH connections…"
              value={value.connectionId ?? ""}
              onChange={selectSource}
              options={[
                { value: "", label: "Select an SSH connection…" },
                ...(value.connectionId && !available
                  ? [
                      {
                        value: value.connectionId,
                        label: "Unavailable SSH connection",
                        disabled: true,
                      },
                    ]
                  : []),
                ...connections.map((connection) => ({
                  value: connection.id,
                  label: connection.name,
                  description: `${connection.hostname}:${connection.port || 22}`,
                })),
              ]}
            />
          </label>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Uses the saved destination and credentials at connection time,
            including database vault passwords. Credentials are not copied into
            this profile.
          </p>
          {(!available ||
            owner?.status !== "ready" ||
            value.ownerDatabaseId !== owner.databaseId) && (
            <p role="alert" className="text-xs text-warning">
              Open the owning database and select an available SSH connection.
            </p>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="sor-form-label col-span-2">
            SSH authentication
            <Select
              label="SSH authentication"
              variant="form"
              value={authMethod}
              onChange={(method) =>
                onChange({
                  ...value,
                  authMethod: method as "password" | "key",
                  password: undefined,
                  privateKey: undefined,
                  passphrase: undefined,
                })
              }
              options={[
                { value: "password", label: "Password" },
                { value: "key", label: "Private key file" },
              ]}
            />
          </label>
          <label className="sor-form-label">
            SSH host
            <input
              aria-label="SSH host"
              className={inputClass}
              value={value.host ?? ""}
              onChange={(e) => onChange({ ...value, host: e.target.value })}
            />
          </label>
          <label className="sor-form-label">
            SSH port
            <input
              aria-label="SSH port"
              className={inputClass}
              type="number"
              min={1}
              max={65535}
              value={value.port ?? 22}
              onChange={(e) =>
                onChange({ ...value, port: Number(e.target.value) })
              }
            />
          </label>
          <label className="sor-form-label">
            SSH username
            <input
              aria-label="SSH username"
              className={inputClass}
              autoComplete="off"
              value={value.username ?? ""}
              onChange={(e) => onChange({ ...value, username: e.target.value })}
            />
          </label>
          {authMethod === "password" ? (
            <label className="sor-form-label">
              SSH password
              <input
                aria-label="SSH password"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={value.password ?? ""}
                onChange={(e) =>
                  onChange({ ...value, password: e.target.value })
                }
              />
            </label>
          ) : (
            <>
              <label className="sor-form-label">
                SSH key file
                <input
                  aria-label="SSH key file"
                  className={inputClass}
                  value={value.privateKey ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, privateKey: e.target.value })
                  }
                />
              </label>
              <label className="sor-form-label">
                Key passphrase
                <input
                  aria-label="Key passphrase"
                  className={inputClass}
                  type="password"
                  autoComplete="new-password"
                  value={value.passphrase ?? ""}
                  onChange={(e) =>
                    onChange({ ...value, passphrase: e.target.value })
                  }
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
