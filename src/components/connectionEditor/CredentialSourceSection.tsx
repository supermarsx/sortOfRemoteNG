import React, { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialSnapshot } from "../../types/security/databaseCredentialVault";
import {
  credentialVaultScopeKey,
  FACET_LABELS,
} from "../../hooks/security/useDatabaseCredentialVault";
import { normalizeConnectionCredentialSource } from "../../utils/security/databaseCredentialVault";
import { Select } from "../ui/forms";

export default function CredentialSourceSection({
  formData,
  setFormData,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}) {
  const context = useContext(ConnectionContext),
    api = context?.credentialVault,
    key = credentialVaultScopeKey(api);
  const owner = useRef(key);
  if (owner.current === "unavailable" && key !== "unavailable")
    owner.current = key;
  const latest = useRef({ api, key });
  latest.current = { api, key };
  const [choosing, setChoosing] = useState(false),
    [snapshot, setSnapshot] = useState<DatabaseCredentialSnapshot | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  let source: ReturnType<typeof normalizeConnectionCredentialSource>,
    invalid = false;
  try {
    source = normalizeConnectionCredentialSource(formData.credentialSource);
  } catch {
    invalid = true;
  }
  const vault = source?.kind === "vault",
    open = vault || choosing;
  const accessible = !!api?.scope && key === owner.current;
  useEffect(() => {
    let alive = true;
    if (!open || !accessible || !api?.scope) return;
    setLoading(true);
    setError(false);
    setSnapshot(null);
    void api
      .list({ ...api.scope })
      .then((value) => {
        if (alive && latest.current.key === key) setSnapshot(value);
      })
      .catch(() => {
        if (alive && latest.current.key === key) setError(true);
      })
      .finally(() => {
        if (alive && latest.current.key === key) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, api?.changeRevision, open, accessible, key, retry]);
  const rows =
    accessible &&
    snapshot !== null &&
    snapshot?.scope.databaseId === api?.scope?.databaseId &&
    snapshot.scope.generation === api?.scope?.generation
      ? snapshot.entries
      : [];
  const selected = source?.kind === "vault" ? source.credentialId : "";
  const mutate = (credentialSource: Connection["credentialSource"]) => {
    if (
      credentialSource?.kind === "vault" &&
      (!accessible ||
        latest.current.key !== owner.current ||
        !rows.some((row) => row.id === credentialSource.credentialId))
    )
      return;
    setFormData((previous) =>
      credentialSource?.kind === "vault" && latest.current.key !== owner.current
        ? previous
        : { ...previous, credentialSource },
    );
  };
  return (
    <section
      data-editor-search-section="credential-source"
      className="space-y-2 rounded border border-[var(--color-border)] p-3 text-sm"
      aria-label="Credential source"
    >
      <h3 className="font-medium">Credential source</h3>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Choose credential storage"
      >
        <button
          type="button"
          className="sor-option-chip"
          aria-pressed={!open && !invalid}
          onClick={() => {
            setChoosing(false);
            mutate({ kind: "local" });
          }}
        >
          Connection-local
        </button>
        <button
          type="button"
          className="sor-option-chip"
          aria-pressed={open}
          disabled={!accessible}
          onClick={() => setChoosing(true)}
        >
          Database vault
        </button>
      </div>
      {invalid && (
        <p role="alert" className="text-error">
          The saved credential source is invalid. Choose a source explicitly; it
          must not fall back to local credentials.
        </p>
      )}
      <p className="text-xs text-[var(--color-textSecondary)]">
        Create or edit reusable entries in Settings → Security → Database
        credential vault.
      </p>
      {!accessible && (
        <p role="status" className="text-[var(--color-textSecondary)]">
          {key !== "unavailable"
            ? "The owning database changed. Reopen this connection editor before selecting a credential."
            : "Open and unlock a managed protected database to choose reusable credentials."}
        </p>
      )}
      {open && (
        <>
          <Select
            id="editor-credential-source"
            label="Reusable vault credential"
            variant="form"
            searchable
            searchPlaceholder="Search credential names or types"
            disabled={!accessible || loading}
            value={selected}
            placeholder={
              loading ? "Loading credential metadata…" : "Choose a credential"
            }
            options={[
              { value: "", label: "Choose a credential", disabled: true },
              ...(selected && !rows.some((row) => row.id === selected)
                ? [
                    {
                      value: selected,
                      label:
                        "Saved credential unavailable — review this database",
                      disabled: true,
                    },
                  ]
                : []),
              ...rows.map((row) => ({
                value: row.id,
                label: `${row.name} · ${row.availableFacets.map((key) => FACET_LABELS[key]).join(", ")}`,
              })),
            ]}
            onChange={(credentialId) => {
              mutate({ kind: "vault", credentialId });
              setChoosing(false);
            }}
          />
          {error && (
            <p role="alert" className="text-error">
              The vault metadata could not be loaded. Unlock or reload the
              owning database; no other vault was searched.
            </p>
          )}
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!accessible || loading}
            onClick={() => setRetry((value) => value + 1)}
          >
            Reload credentials
          </button>
          <p className="text-xs text-[var(--color-textSecondary)]">
            Only this database's names and credential types are listed.
            Selecting an entry stores its reference, not a copy of its secrets.
          </p>
        </>
      )}
      {vault ? (
        <p role="note" className="rounded border border-primary/30 p-2 text-xs">
          Connection-local username, password, key and TOTP values are preserved
          but ignored while this vault reference is selected. Authentication
          depends on the adapter's supported credential types; unsupported or
          missing vault credentials must fail closed, never fall back to the
          local values.
        </p>
      ) : (
        <p className="text-xs text-[var(--color-textSecondary)]">
          {choosing
            ? "Choose a vault entry to change the saved source. Until then, existing local credentials remain selected."
            : "Credentials configured in this connection are used. No reusable vault entry is modified."}
        </p>
      )}
    </section>
  );
}
