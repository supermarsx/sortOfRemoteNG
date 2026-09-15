import React, { useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Checkbox, Select } from "../../ui/forms";
import type {
  DatabaseCredentialEntry,
  DatabaseCredentialFacet,
  DatabaseCredentialFacets,
  VaultPasskeyBinding,
  VaultSocialBinding,
  VaultTotpFacet,
} from "../../../types/security/databaseCredentialVault";
import {
  DATABASE_CREDENTIAL_FACETS,
  normalizeDatabaseCredentialEntry,
} from "../../../utils/security/databaseCredentialVault";

import { FACET_LABELS } from "../../../hooks/security/useDatabaseCredentialVault";

function SecretField({
  label,
  value,
  onChange,
  multiline = false,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  disabled: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <div className="flex items-start gap-2">
        {multiline && revealed ? (
          <textarea
            aria-label={label}
            className="sor-form-input min-h-32 font-mono"
            spellCheck={false}
            autoComplete="off"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            aria-label={label}
            className="sor-form-input"
            type={revealed ? "text" : "password"}
            autoComplete="new-password"
            spellCheck={false}
            value={value}
            disabled={disabled}
            readOnly={multiline && !revealed}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        <button
          type="button"
          className="sor-btn-icon shrink-0"
          aria-label={`${revealed ? "Hide" : "Reveal"} ${label.toLowerCase()}`}
          aria-pressed={revealed}
          data-tooltip={`${revealed ? "Hide" : "Reveal"} ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {multiline && !revealed && (
        <span className="block text-xs text-[var(--color-textSecondary)]">
          Reveal to edit or paste a multiline private key. Keys stay masked by
          default.
        </span>
      )}
    </label>
  );
}

export default function CredentialEntryForm({
  entry,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  entry: DatabaseCredentialEntry;
  onChange: (entry: DatabaseCredentialEntry) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  let valid = true;
  try {
    normalizeDatabaseCredentialEntry(entry);
  } catch {
    valid = false;
  }
  const setFacet = <K extends DatabaseCredentialFacet>(
    key: K,
    value: DatabaseCredentialFacets[K],
  ) => onChange({ ...entry, facets: { ...entry.facets, [key]: value } });
  const toggle = (key: DatabaseCredentialFacet, checked: boolean) => {
    const facets = { ...entry.facets };
    if (!checked) delete facets[key];
    // Trusted devices come only from a successful native NAS sign-in.
    else if (key === "deviceTrust") return;
    else if (key === "totp")
      facets.totp = [
        {
          id: crypto.randomUUID(),
          label: "Authenticator",
          secret: "",
          digits: 6,
          period: 30,
          algorithm: "sha1",
        },
      ];
    else if (key === "social")
      facets.social = [
        { id: crypto.randomUUID(), provider: "", origin: "", portable: false },
      ];
    else if (key === "passkey")
      facets.passkey = [
        { id: crypto.randomUUID(), provider: "", rpId: "", portable: false },
      ];
    else facets[key] = "";
    onChange({ ...entry, facets });
  };
  const textField = (
    label: string,
    value: string,
    onChangeValue: (value: string) => void,
  ) => (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <input
        aria-label={label}
        className="sor-form-input"
        value={value}
        disabled={busy}
        onChange={(event) => onChangeValue(event.target.value)}
        autoComplete="off"
      />
    </label>
  );
  const updateTotp = (id: string, patch: Partial<VaultTotpFacet>) =>
    setFacet(
      "totp",
      entry.facets.totp!.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    );
  const bindingEditor = (kind: "social" | "passkey") => {
    const rows = entry.facets[kind];
    if (!rows) return null;
    return (
      <fieldset className="space-y-3 rounded border border-[var(--color-border)] p-3">
        <legend className="px-1 text-sm">{FACET_LABELS[kind]}</legend>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Metadata only. These bindings cannot sign in automatically and are not
          portable credentials. Use the original website and provider or
          hardware authenticator; no tokens or passkey private keys are
          captured.
        </p>
        {rows.map((row, index) => {
          const change = (
            patch: Partial<VaultSocialBinding & VaultPasskeyBinding>,
          ) =>
            setFacet(
              kind,
              rows.map((item) =>
                item.id === row.id ? { ...item, ...patch } : item,
              ) as VaultSocialBinding[] & VaultPasskeyBinding[],
            );
          const label = `${kind === "social" ? "Social" : "Passkey"} binding ${index + 1}`;
          return (
            <div
              key={row.id}
              className="space-y-2 border-t border-[var(--color-border)] pt-2"
            >
              {textField(`${label} provider`, row.provider, (value) =>
                change({ provider: value }),
              )}
              {kind === "social"
                ? textField(
                    `${label} Website HTTPS origin where sign-in starts`,
                    (row as VaultSocialBinding).origin,
                    (value) => change({ origin: value }),
                  )
                : textField(
                    `${label} relying-party domain`,
                    (row as VaultPasskeyBinding).rpId,
                    (value) => change({ rpId: value }),
                  )}
              {textField(
                `${label} account hint`,
                row.accountHint ?? "",
                (value) => change({ accountHint: value || undefined }),
              )}
              <button
                type="button"
                className="sor-btn sor-btn-danger"
                disabled={busy}
                onClick={() => {
                  const next = rows.filter((item) => item.id !== row.id);
                  if (next.length)
                    setFacet(
                      kind,
                      next as VaultSocialBinding[] & VaultPasskeyBinding[],
                    );
                  else toggle(kind, false);
                }}
              >
                <Trash2 size={14} /> Remove {label.toLowerCase()}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={busy || rows.length >= 16}
          onClick={() => {
            const next =
              kind === "social"
                ? {
                    id: crypto.randomUUID(),
                    provider: "",
                    origin: "",
                    portable: false as const,
                  }
                : {
                    id: crypto.randomUUID(),
                    provider: "",
                    rpId: "",
                    portable: false as const,
                  };
            setFacet(kind, [...rows, next] as VaultSocialBinding[] &
              VaultPasskeyBinding[]);
          }}
        >
          <Plus size={14} /> Add {kind} binding
        </button>
      </fieldset>
    );
  };
  return (
    <section aria-label="Vault credential editor" className="space-y-4">
      <h3 className="font-medium">Credential details</h3>
      {textField("Credential name", entry.name, (name) =>
        onChange({ ...entry, name }),
      )}
      <fieldset>
        <legend className="mb-2 text-sm">Include credential types</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DATABASE_CREDENTIAL_FACETS.filter(
            (key) => key !== "deviceTrust",
          ).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={entry.facets[key] !== undefined}
                disabled={busy}
                onChange={(checked) => toggle(key, checked)}
              />
              {FACET_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["username", "domain"] as const).map(
          (key) =>
            entry.facets[key] !== undefined && (
              <React.Fragment key={key}>
                {textField(FACET_LABELS[key], entry.facets[key]!, (value) =>
                  setFacet(key, value),
                )}
              </React.Fragment>
            ),
        )}
      </div>
      {(["password", "privateKey", "passphrase"] as const).map(
        (key) =>
          entry.facets[key] !== undefined && (
            <SecretField
              key={key}
              label={FACET_LABELS[key]}
              value={entry.facets[key]!}
              onChange={(value) => setFacet(key, value)}
              multiline={key === "privateKey"}
              disabled={busy}
            />
          ),
      )}
      {entry.facets.totp && (
        <fieldset className="space-y-3 rounded border border-[var(--color-border)] p-3">
          <legend className="px-1 text-sm">TOTP authenticators</legend>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Enter the existing authenticator's Base32 seed, not a one-use code.
            No enrollment or automatic submission happens here.
          </p>
          {entry.facets.totp.map((row, index) => (
            <div
              key={row.id}
              className="space-y-2 border-t border-[var(--color-border)] pt-2"
            >
              {textField(
                `Authenticator ${index + 1} label`,
                row.label,
                (value) => updateTotp(row.id, { label: value }),
              )}
              <SecretField
                label={`Authenticator ${index + 1} seed`}
                value={row.secret}
                disabled={busy}
                onChange={(value) =>
                  updateTotp(row.id, {
                    secret: value.replace(/\s/g, "").toUpperCase(),
                  })
                }
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-sm">
                  Digits
                  <Select
                    id={`digits-${row.id}`}
                    label={`Authenticator ${index + 1} digits`}
                    value={row.digits}
                    disabled={busy}
                    options={[
                      { value: 6, label: "6 digits" },
                      { value: 8, label: "8 digits" },
                    ]}
                    onChange={(value) =>
                      updateTotp(row.id, { digits: Number(value) as 6 | 8 })
                    }
                  />
                </label>
                <label className="text-sm">
                  Period (seconds)
                  <input
                    aria-label={`Authenticator ${index + 1} period`}
                    type="number"
                    min={15}
                    max={120}
                    className="sor-form-input"
                    value={row.period}
                    disabled={busy}
                    onChange={(event) =>
                      updateTotp(row.id, { period: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="text-sm">
                  Algorithm
                  <Select
                    label={`Authenticator ${index + 1} algorithm`}
                    value={row.algorithm}
                    disabled={busy}
                    options={[
                      { value: "sha1", label: "SHA-1" },
                      { value: "sha256", label: "SHA-256" },
                      { value: "sha512", label: "SHA-512" },
                    ]}
                    onChange={(value) =>
                      updateTotp(row.id, {
                        algorithm: value as VaultTotpFacet["algorithm"],
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                className="sor-btn sor-btn-danger"
                disabled={busy}
                onClick={() => {
                  const next = entry.facets.totp!.filter(
                    (item) => item.id !== row.id,
                  );
                  if (next.length) setFacet("totp", next);
                  else toggle("totp", false);
                }}
              >
                <Trash2 size={14} /> Remove authenticator {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={busy || entry.facets.totp.length >= 16}
            onClick={() =>
              setFacet("totp", [
                ...entry.facets.totp!,
                {
                  id: crypto.randomUUID(),
                  label: "Authenticator",
                  secret: "",
                  digits: 6,
                  period: 30,
                  algorithm: "sha1",
                },
              ])
            }
          >
            <Plus size={14} /> Add authenticator
          </button>
        </fieldset>
      )}
      {bindingEditor("social")}
      {bindingEditor("passkey")}
      {entry.facets.deviceTrust && (
        <fieldset className="space-y-3 rounded border border-[var(--color-border)] p-3">
          <legend className="px-1 text-sm">{FACET_LABELS.deviceTrust}</legend>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Remembered after a two-factor Synology NAS API sign-in, so that NAS
            account can skip the one-time code on the computer named here.
            Device tokens are never shown or exported. Forget a device and save
            to require a code again; DSM can also revoke it.
          </p>
          <ul className="space-y-2">
            {entry.facets.deviceTrust.map((row, index) => (
              <li
                key={row.id}
                className="flex flex-wrap items-end justify-between gap-2 border-t border-[var(--color-border)] pt-2"
              >
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-[var(--color-textSecondary)]">
                    NAS address
                  </dt>
                  <dd className="break-all">{row.target}</dd>
                  <dt className="text-[var(--color-textSecondary)]">Account</dt>
                  <dd className="break-all">{row.account}</dd>
                  <dt className="text-[var(--color-textSecondary)]">
                    Device name
                  </dt>
                  <dd className="break-all">{row.deviceName}</dd>
                  <dt className="text-[var(--color-textSecondary)]">
                    Trusted since
                  </dt>
                  <dd>
                    <time dateTime={row.createdAt}>
                      {new Date(row.createdAt).toLocaleString()}
                    </time>
                  </dd>
                </dl>
                <button
                  type="button"
                  className="sor-btn sor-btn-danger"
                  disabled={busy}
                  onClick={() => {
                    const next = entry.facets.deviceTrust!.filter(
                      (item) => item.id !== row.id,
                    );
                    if (next.length) setFacet("deviceTrust", next);
                    else toggle("deviceTrust", false);
                  }}
                >
                  <Trash2 size={14} /> Forget trusted device {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {!valid && (
        <p role="status" className="text-sm text-[var(--color-textSecondary)]">
          Add a name and at least one valid credential type. Seeds must be
          Base32; provider origins must be canonical HTTPS origins without a
          trailing slash; passkey bindings need a domain only.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel editing
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={busy || !valid}
          onClick={onSave}
        >
          {busy ? "Saving credential…" : "Save credential"}
        </button>
      </div>
    </section>
  );
}
