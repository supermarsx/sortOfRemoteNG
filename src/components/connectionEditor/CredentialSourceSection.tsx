import React, { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
import type { DatabaseCredentialSnapshot } from "../../types/security/databaseCredentialVault";
import {
  credentialVaultScopeKey,
  FACET_LABELS,
} from "../../hooks/security/useDatabaseCredentialVault";
import {
  normalizeConnectionCredentialSource,
  normalizeDatabaseCredentialEntry,
} from "../../utils/security/databaseCredentialVault";
import {
  clearLocalCredentialFields,
  convertibleVaultFacets,
  localCredentialFacets,
  LOCAL_CREDENTIAL_FACETS,
  vaultCredentialLocalFields,
} from "../../utils/security/connectionCredentialConversion";
import { Select } from "../ui/forms";
import { useVaultTotpChoices } from "../../hooks/security/useVaultTotpChoices";

export default function CredentialSourceSection({
  formData,
  setFormData,
  credentialConversion,
}: {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
  credentialConversion?: {
    read: () => Partial<Connection>;
    apply: (patch: Partial<Connection>) => void;
  };
}) {
  const authenticators = useVaultTotpChoices(formData);
  const context = useContext(ConnectionContext),
    api = context?.credentialVault,
    key = credentialVaultScopeKey(api);
  const owner = useRef(key);
  if (owner.current === "unavailable" && key !== "unavailable")
    owner.current = key;
  const latest = useRef({ api, key });
  latest.current = { api, key };
  const currentDraft = useRef({ formData, credentialConversion });
  currentDraft.current = { formData, credentialConversion };
  const alive = useRef(true),
    converting = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionTarget, setConversionTarget] = useState("");
  const [conversionName, setConversionName] = useState("");
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionError, setConversionError] = useState("");
  const [conversionStatus, setConversionStatus] = useState("");
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
    open = vault || choosing || conversionOpen;
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
    if (converting.current) return;
    if (
      credentialSource?.kind === "vault" &&
      (!accessible ||
        latest.current.key !== owner.current ||
        !rows.some((row) => row.id === credentialSource.credentialId))
    )
      return;
    setFormData((previous) => {
      if (
        credentialSource?.kind === "vault" &&
        latest.current.key !== owner.current
      )
        return previous;
      const old = previous.credentialSource;
      const same =
        old?.kind === credentialSource?.kind &&
        (old?.kind !== "vault" ||
          (credentialSource?.kind === "vault" &&
            old.credentialId === credentialSource.credentialId &&
            old.totpId === credentialSource.totpId));
      if (same) return previous;
      return {
        ...previous,
        credentialSource,
        httpAutoMfa: previous.httpAutoMfa
          ? { version: 1, enabled: false }
          : undefined,
      };
    });
  };
  const convert = async (direction: "vault" | "local") => {
    if (converting.current || !accessible || !api?.scope) return;
    converting.current = true;
    setConversionBusy(true);
    setConversionError("");
    setConversionStatus("");
    const original = currentDraft.current;
    const draft = original.credentialConversion?.read() ?? original.formData;
    const draftVersion = JSON.stringify(draft);
    const scope = { ...api.scope };
    const check = () => {
      if (
        !alive.current ||
        latest.current.key !== owner.current ||
        latest.current.key !== key ||
        credentialVaultScopeKey(api) !== key ||
        currentDraft.current.formData !== original.formData ||
        JSON.stringify(
          currentDraft.current.credentialConversion?.read() ??
            currentDraft.current.formData,
        ) !== draftVersion
      )
        throw new Error("Credential conversion context changed.");
    };
    try {
      check();
      const review = await api.list(scope);
      check();
      if (
        review.scope.databaseId !== scope.databaseId ||
        review.scope.generation !== scope.generation
      )
        throw new Error("Credential owner changed.");
      let patch: Partial<Connection>;
      if (direction === "vault") {
        if (
          normalizeConnectionCredentialSource(draft.credentialSource)?.kind ===
          "vault"
        )
          throw new Error();
        const facets = localCredentialFacets(draft);
        const existing = conversionTarget
          ? review.entries.find((entry) => entry.id === conversionTarget)
          : undefined;
        if (conversionTarget && !existing) throw new Error();
        const retainedFacets =
          existing?.availableFacets.filter(
            (facet) =>
              !LOCAL_CREDENTIAL_FACETS.some((local) => local === facet),
          ) ?? [];
        const retained =
          existing && retainedFacets.length
            ? await api.resolve(review, existing.id, retainedFacets)
            : {};
        check();
        const now = new Date().toISOString();
        const entry = normalizeDatabaseCredentialEntry({
          id: existing?.id ?? crypto.randomUUID(),
          name: existing?.name ?? conversionName.trim(),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          facets: { ...retained, ...facets },
        });
        await api.compareAndSwap(review, [{ operation: "put", entry }]);
        check();
        const verified = await api.list(scope);
        check();
        if (
          verified.scope.databaseId !== scope.databaseId ||
          verified.scope.generation !== scope.generation ||
          verified.revision <= review.revision ||
          !verified.entries.some((row) => row.id === entry.id)
        )
          throw new Error();
        const stored = await api.resolve(
          verified,
          entry.id,
          LOCAL_CREDENTIAL_FACETS.filter(
            (facet) => facets[facet] !== undefined,
          ),
        );
        check();
        if (
          Object.entries(facets).some(
            ([facet, value]) =>
              JSON.stringify(stored[facet as keyof typeof stored]) !==
              JSON.stringify(value),
          )
        )
          throw new Error("Credential verification failed.");
        patch = {
          ...clearLocalCredentialFields(),
          credentialSource: {
            kind: "vault",
            credentialId: entry.id,
            ...(draft.totpSecret
              ? {
                  totpId: facets.totp?.find(
                    (item) =>
                      item.secret ===
                      draft.totpSecret?.replace(/\s/g, "").toUpperCase(),
                  )?.id,
                }
              : {}),
          },
        };
        setSnapshot(verified);
      } else {
        const reference = normalizeConnectionCredentialSource(
          draft.credentialSource,
        );
        if (reference?.kind !== "vault") throw new Error();
        const row = review.entries.find(
          (entry) => entry.id === reference.credentialId,
        );
        if (!row) throw new Error();
        const required =
          draft.protocol === "ssh" && draft.authType === "key"
            ? (["username", "privateKey"] as const)
            : (["username", "password"] as const);
        if (required.some((facet) => !row.availableFacets.includes(facet)))
          throw new Error();
        const needed = convertibleVaultFacets(row, draft);
        if (!needed.length) throw new Error();
        const facets = await api.resolve(review, row.id, needed);
        check();
        if (needed.some((facet) => facets[facet] === undefined))
          throw new Error();
        normalizeDatabaseCredentialEntry({
          id: row.id,
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          facets,
        });
        const selectedTotp = facets.totp?.find(
          (entry) => entry.id === reference.totpId,
        );
        if (
          draft.protocol === "ssh" &&
          selectedTotp &&
          (selectedTotp.digits !== 6 ||
            selectedTotp.period !== 30 ||
            selectedTotp.algorithm !== "sha1")
        )
          throw new Error();
        patch = {
          ...vaultCredentialLocalFields(facets, reference.totpId),
          credentialSource: { kind: "local" },
        };
      }
      check();
      patch.httpAutoMfa = draft.httpAutoMfa
        ? { version: 1, enabled: false }
        : undefined;
      if (original.credentialConversion)
        original.credentialConversion.apply(patch);
      else
        setFormData((previous) =>
          previous === original.formData &&
          alive.current &&
          latest.current.key === key
            ? { ...previous, ...patch }
            : previous,
        );
      setChoosing(false);
      setConversionOpen(false);
      setConversionStatus(
        direction === "vault"
          ? "Vault write verified. Local credential fields were cleared in this draft. Save the connection to keep the new source."
          : "Vault credentials copied into this draft. The reusable vault entry is unchanged. Save the connection to keep the local source.",
      );
    } catch {
      if (alive.current)
        setConversionError(
          "Conversion could not be completed. The connection's source and local fields were kept. Unlock and reload the owning database, review the destination, then retry. A completed vault write may remain even if verification failed.",
        );
    } finally {
      converting.current = false;
      if (alive.current) setConversionBusy(false);
    }
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
          disabled={conversionBusy}
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
          disabled={!accessible || conversionBusy}
          onClick={() => setChoosing(true)}
        >
          Database vault
        </button>
      </div>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={!accessible || invalid || conversionBusy}
        onClick={() => {
          if (vault) void convert("local");
          else {
            setConversionOpen(true);
            setConversionName(formData.name ?? "");
          }
        }}
      >
        {conversionBusy
          ? "Converting credentials…"
          : vault
            ? "Copy vault credentials to connection-local"
            : "Move local credentials to vault"}
      </button>
      {conversionOpen && !vault && (
        <div className="space-y-2 rounded border border-[var(--color-border)] p-3">
          <Select
            label="Conversion destination"
            variant="form"
            value={conversionTarget}
            disabled={conversionBusy || loading || !accessible}
            options={[
              { value: "", label: "New vault credential" },
              ...rows.map((row) => ({ value: row.id, label: row.name })),
            ]}
            onChange={setConversionTarget}
          />
          {!conversionTarget && (
            <label className="block">
              New credential name
              <input
                className="sor-form-input"
                value={conversionName}
                disabled={conversionBusy}
                maxLength={128}
                onChange={(event) => setConversionName(event.target.value)}
              />
            </label>
          )}
          <p className="text-xs text-[var(--color-textSecondary)]">
            {conversionTarget
              ? "Username, password, domain, key and authenticator fields in the selected shared credential will be replaced. Other connections using it will use the updated credentials. Provider bindings and trusted devices are preserved. "
              : "A reusable credential will be saved in this database. "}
            Local fields are cleared only after the vault write is verified.
            Recovery codes and separate HTTP accounts cannot be moved together.
            Automatic 2FA must be reviewed again after conversion.
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={
              conversionBusy ||
              loading ||
              !accessible ||
              (!conversionTarget && !conversionName.trim())
            }
            onClick={() => void convert("vault")}
          >
            Save to vault and switch source
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={conversionBusy}
            onClick={() => setConversionOpen(false)}
          >
            Cancel conversion
          </button>
        </div>
      )}
      {conversionError && (
        <p role="alert" className="text-error">
          {conversionError}
        </p>
      )}
      {conversionStatus && <p role="status">{conversionStatus}</p>}
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
            disabled={!accessible || loading || conversionBusy}
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
          {vault && (
            <div className="space-y-2">
              <Select
                label="Vault authenticator for login challenges"
                variant="form"
                value={source?.kind === "vault" ? (source.totpId ?? "") : ""}
                disabled={
                  !authenticators.available ||
                  authenticators.loading ||
                  conversionBusy
                }
                options={[
                  { value: "", label: "None — enter codes manually" },
                  ...authenticators.entries.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  })),
                ]}
                onChange={(totpId) => {
                  if (
                    source?.kind !== "vault" ||
                    (totpId &&
                      !authenticators.entries.some(
                        (entry) => entry.id === totpId,
                      ))
                  )
                    return;
                  const { totpId: _previousTotp, ...reference } = source;
                  mutate(totpId ? { ...reference, totpId } : reference);
                }}
              />
              <p className="text-xs text-[var(--color-textSecondary)]">
                Optional and never selected automatically. SSH and Synology use
                this authenticator only when the server requests a code.
                Websites additionally require explicit automatic 2FA consent in
                Application settings. All vault authenticators remain available
                for manual generation.
              </p>
              {authenticators.error && (
                <p role="alert" className="text-xs text-error">
                  {authenticators.error}
                </p>
              )}
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={!authenticators.available || authenticators.loading}
                onClick={authenticators.reload}
              >
                Reload authenticators
              </button>
            </div>
          )}
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
