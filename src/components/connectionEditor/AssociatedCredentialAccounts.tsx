import React, { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type {
  ConnectionCredentialAccount,
  DatabaseCredentialSnapshot,
} from "../../types/security/databaseCredentialVault";
import { credentialVaultScopeKey } from "../../hooks/security/useDatabaseCredentialVault";
import {
  connectionCredentialAccounts,
  MAX_CONNECTION_CREDENTIAL_ACCOUNTS,
} from "../../utils/security/connectionCredentialAccounts";
import { PasswordInput, Select } from "../ui/forms";

export default function AssociatedCredentialAccounts({
  formData,
  setFormData,
  onSelect,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  onSelect: (account: ConnectionCredentialAccount) => void;
}) {
  const api = useContext(ConnectionContext)?.credentialVault;
  const scopeKey = credentialVaultScopeKey(api);
  const owner = useRef(scopeKey);
  if (owner.current === "unavailable" && scopeKey !== "unavailable")
    owner.current = scopeKey;
  const snapshotKey = (value: DatabaseCredentialSnapshot) =>
    JSON.stringify([value.scope.databaseId, value.scope.generation]);
  const live = useRef({ scopeKey, id: formData.id, mounted: true });
  live.current = { scopeKey, id: formData.id, mounted: true };
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
    };
  }, []);
  const [snapshot, setSnapshot] = useState<DatabaseCredentialSnapshot | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState({
    name: "",
    username: "",
    password: "",
    domain: "",
  });
  const pending = useRef<string | null>(null);
  const writing = useRef(false);
  const accessible = !!api?.scope && owner.current === scopeKey;
  const current = () =>
    accessible &&
    live.current.mounted &&
    live.current.scopeKey === scopeKey &&
    live.current.id === formData.id;
  let accounts: ConnectionCredentialAccount[] = [];
  let invalid = false;
  try {
    accounts = connectionCredentialAccounts(formData);
  } catch {
    invalid = true;
  }
  const needed = open || creating || accounts.length > 0;
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    if (!accessible || !needed || !api?.scope) return;
    void api
      .list({ ...api.scope })
      .then((value) => {
        if (
          active &&
          live.current.scopeKey === scopeKey &&
          snapshotKey(value) === scopeKey
        )
          setSnapshot(value);
      })
      .catch(() => {
        if (active)
          setError(
            "Accounts could not be loaded. Unlock the owning database and reload.",
          );
      });
    return () => {
      active = false;
    };
  }, [api, api?.changeRevision, accessible, needed, scopeKey, reload]);
  useEffect(() => {
    if (!accessible) {
      setDraft({ name: "", username: "", password: "", domain: "" });
      setSnapshot(null);
      setCreating(false);
      setOpen(false);
    }
  }, [accessible]);
  const attach = (account: ConnectionCredentialAccount) => {
    if (!current()) return;
    setFormData((previous) => {
      if (!current() || previous.id !== formData.id) return previous;
      const entries = connectionCredentialAccounts(previous);
      if (entries.some((entry) => entry.credentialId === account.credentialId))
        return previous;
      if (entries.length >= MAX_CONNECTION_CREDENTIAL_ACCOUNTS) return previous;
      return { ...previous, credentialAccounts: [...entries, account] };
    });
  };
  const finish = (id: string) => {
    attach({ credentialId: id });
    pending.current = null;
    setDraft({ name: "", username: "", password: "", domain: "" });
    setCreating(false);
    setOpen(false);
    setError("");
  };
  const saveAccount = async () => {
    if (
      writing.current ||
      !current() ||
      !api?.scope ||
      !snapshot ||
      pending.current ||
      !draft.name.trim() ||
      !draft.username.trim() ||
      !draft.password
    )
      return;
    writing.current = true;
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    pending.current = id;
    const timestamp = new Date().toISOString();
    try {
      await api.compareAndSwap(snapshot, [
        {
          operation: "put",
          entry: {
            id,
            name: draft.name.trim(),
            createdAt: timestamp,
            updatedAt: timestamp,
            facets: {
              username: draft.username,
              password: draft.password,
              ...(draft.domain ? { domain: draft.domain } : {}),
            },
          },
        },
      ]);
      if (!current()) return;
      const confirmed = await api.list({ ...api.scope });
      if (
        !current() ||
        snapshotKey(confirmed) !== scopeKey ||
        !confirmed.entries.some((entry) => entry.id === id)
      )
        throw new Error();
      setSnapshot(confirmed);
      finish(id);
    } catch {
      if (current())
        setError(
          "The save could not be confirmed. Reload accounts to check its result before trying again.",
        );
    } finally {
      writing.current = false;
      if (live.current.mounted) setBusy(false);
    }
  };
  const reloadAccounts = async () => {
    if (!current() || !api?.scope || writing.current) return;
    setBusy(true);
    try {
      const value = await api.list({ ...api.scope });
      if (!current() || snapshotKey(value) !== scopeKey) return;
      setSnapshot(value);
      setError("");
      if (
        pending.current &&
        value.entries.some((entry) => entry.id === pending.current)
      )
        finish(pending.current);
      else pending.current = null;
      setReload((value) => value + 1);
    } catch {
      if (current())
        setError(
          "Accounts could not be reloaded. Unlock the owning database and retry.",
        );
    } finally {
      if (live.current.mounted) setBusy(false);
    }
  };
  return (
    <section
      aria-label="Associated accounts"
      data-editor-search-field="credential-accounts"
      className="space-y-3 border-t border-[var(--color-border)] pt-3"
    >
      <div>
        <h4 className="font-medium">Accounts for this connection</h4>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Keep separate administrator, personal or service accounts together.
          The default account is used on the next connection; accounts are never
          tried in sequence.
        </p>
      </div>
      {!accessible && (
        <p role="status" className="text-xs text-[var(--color-textSecondary)]">
          Open and unlock the owning database to manage these accounts. Reopen
          this editor if the database changed.
        </p>
      )}
      {invalid ? (
        <div className="space-y-2">
          <p role="alert" className="text-error">
            Saved account associations are invalid. Review the connection data
            before editing accounts.
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!accessible || busy}
            onClick={() =>
              setFormData((previous) =>
                current() && previous.id === formData.id
                  ? { ...previous, credentialAccounts: undefined }
                  : previous,
              )
            }
          >
            Reset account associations
          </button>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Resetting links keeps the default credential and all reusable vault
            entries.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={
                !accessible ||
                busy ||
                accounts.length >= MAX_CONNECTION_CREDENTIAL_ACCOUNTS
              }
              onClick={() => {
                setOpen(true);
                setCreating(false);
              }}
            >
              Link saved account
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={
                !accessible ||
                busy ||
                accounts.length >= MAX_CONNECTION_CREDENTIAL_ACCOUNTS
              }
              onClick={() => {
                setCreating(true);
                setOpen(false);
              }}
            >
              New account
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <table
              aria-label="Accounts for this connection"
              className="w-full text-left text-sm"
            >
              <thead className="bg-[var(--color-surfaceHover)] text-xs text-[var(--color-textSecondary)]">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Account
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Sign-in
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {accounts.map((account) => {
                  const entry = accessible
                    ? snapshot?.entries.find(
                        (entry) => entry.id === account.credentialId,
                      )
                    : undefined;
                  const isDefault =
                    formData.credentialSource?.kind === "vault" &&
                    formData.credentialSource.credentialId ===
                      account.credentialId;
                  return (
                    <tr key={account.credentialId}>
                      <th
                        scope="row"
                        className="max-w-64 break-words px-3 py-2 font-medium"
                      >
                        {entry?.name ??
                          (snapshot
                            ? "Unavailable account"
                            : "Loading account…")}
                      </th>
                      <td className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                        {isDefault ? (
                          <span className="text-primary">Default</span>
                        ) : (
                          "Available"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          {!isDefault && (
                            <button
                              type="button"
                              className="sor-btn sor-btn-secondary"
                              disabled={!accessible || !entry || busy}
                              onClick={() => {
                                if (current()) onSelect(account);
                              }}
                            >
                              Make default
                            </button>
                          )}
                          <button
                            type="button"
                            className="sor-btn sor-btn-secondary"
                            disabled={!accessible || busy || isDefault}
                            title={
                              isDefault
                                ? "Choose another default before removing this account"
                                : "Remove this association; keep the reusable credential"
                            }
                            aria-label={`Remove ${entry?.name ?? "unavailable account"} association`}
                            onClick={() =>
                              setFormData((previous) => {
                                if (
                                  !current() ||
                                  previous.id !== formData.id ||
                                  (previous.credentialSource?.kind ===
                                    "vault" &&
                                    previous.credentialSource.credentialId ===
                                      account.credentialId)
                                )
                                  return previous;
                                const remaining = connectionCredentialAccounts(
                                  previous,
                                ).filter(
                                  (item) =>
                                    item.credentialId !== account.credentialId,
                                );
                                return {
                                  ...previous,
                                  credentialAccounts: remaining.length
                                    ? remaining
                                    : undefined,
                                };
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-5 text-center text-[var(--color-textSecondary)]"
                    >
                      No saved accounts linked yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {formData.credentialSource?.kind !== "vault" && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              Default: connection-local credentials.
            </p>
          )}
          {open && accessible && (
            <div className="space-y-2">
              <Select
                label="Account to associate"
                searchable
                value={selected}
                disabled={!snapshot || busy}
                options={(snapshot?.entries ?? [])
                  .filter(
                    (entry) =>
                      !accounts.some(
                        (account) => account.credentialId === entry.id,
                      ),
                  )
                  .map((entry) => ({ value: entry.id, label: entry.name }))}
                onChange={setSelected}
              />
              <button
                type="button"
                className="sor-btn sor-btn-primary"
                disabled={
                  !current() ||
                  busy ||
                  !selected ||
                  !snapshot?.entries.some((entry) => entry.id === selected)
                }
                onClick={() => {
                  attach({ credentialId: selected });
                  setSelected("");
                  setOpen(false);
                }}
              >
                Link account
              </button>
            </div>
          )}
          {creating && accessible && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-2">
              {(
                [
                  ["name", "Account name"],
                  ["username", "Username"],
                  ["domain", "Domain (optional)"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="block text-sm">
                  {label}
                  <input
                    className="sor-form-input mt-1 w-full"
                    value={draft[field]}
                    disabled={busy || !!pending.current}
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <label className="block text-sm">
                Password
                <PasswordInput
                  value={draft.password}
                  disabled={busy || !!pending.current}
                  autoComplete="new-password"
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
              <p className="text-xs text-[var(--color-textSecondary)] sm:col-span-2">
                Saved in this database's encrypted credential vault. Linking it
                does not change your default account.
              </p>
              <button
                type="button"
                className="sor-btn sor-btn-primary"
                disabled={
                  !snapshot ||
                  busy ||
                  !!pending.current ||
                  !draft.name.trim() ||
                  !draft.username.trim() ||
                  !draft.password
                }
                onClick={() => void saveAccount()}
              >
                Save account
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={busy || !!pending.current}
                onClick={() => {
                  setCreating(false);
                  setDraft({
                    name: "",
                    username: "",
                    password: "",
                    domain: "",
                  });
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {(error || open || creating) && (
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!accessible || busy}
          onClick={() => void reloadAccounts()}
        >
          Reload accounts
        </button>
      )}
    </section>
  );
}
