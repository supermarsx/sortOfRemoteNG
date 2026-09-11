import React, { useEffect, useRef, useState } from "react";
import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../../types/security/databaseCredentialVault";
import type {
  DatabaseVaultArchive,
  VaultArchiveConnection,
} from "../../../types/security/vaultArchive";
import {
  decryptVaultArchive,
  encryptVaultArchive,
  VaultArchiveError,
} from "../../../utils/security/vaultArchive";
import {
  chooseVaultArchiveFile,
  saveVaultArchiveFile,
} from "../../../utils/security/vaultArchiveFiles";
import { credentialVaultScopeKey } from "../../../hooks/security/useDatabaseCredentialVault";
import { Checkbox, PasswordInput } from "../../ui/forms";
import { Modal } from "../../ui/overlays/Modal";

export default function VaultArchiveDialog({
  api,
  snapshot,
  mode,
  onClose,
  onImported,
  onBusyChange,
}: {
  api: DatabaseCredentialVaultApi;
  snapshot: DatabaseCredentialSnapshot;
  mode: "import" | "export";
  onClose: () => void;
  onImported: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const scope = credentialVaultScopeKey(api);
  const latest = useRef({ api, scope, receipt: snapshot.receipt });
  latest.current = { api, scope, receipt: snapshot.receipt };
  const alive = useRef(true),
    busyRef = useRef(false);
  const onBusyRef = useRef(onBusyChange);
  onBusyRef.current = onBusyChange;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [selected, setSelected] = useState(
    () => new Set(snapshot.entries.map((row) => row.id)),
  );
  const [connections, setConnections] = useState<VaultArchiveConnection[]>([]),
    [connectionIds, setConnectionIds] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<DatabaseVaultArchive | null>(null);
  const supported =
    !!api.exportArchive && !!api.importArchive && !!api.archiveConnections;
  const assertCurrent = () => {
    if (
      !alive.current ||
      latest.current.scope !== scope ||
      latest.current.receipt !== snapshot.receipt ||
      !latest.current.api.scope
    )
      throw new Error("Vault access changed.");
  };
  const verify = async () => {
    assertCurrent();
    if (!latest.current.api.archiveConnections)
      throw new Error("Archive unavailable.");
    await latest.current.api.archiveConnections(snapshot);
    assertCurrent();
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyRef.current?.(false);
    };
  }, []);
  useEffect(() => {
    if (mode !== "export" || !api.archiveConnections) return;
    let cancelled = false;
    void api
      .archiveConnections(snapshot)
      .then((rows) => {
        if (!cancelled && alive.current) setConnections(rows);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Linked connections could not be read. Reload the vault before exporting.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [api, snapshot, mode]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current || !supported) return;
    busyRef.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setNotice(null);
    try {
      assertCurrent();
      await action();
      assertCurrent();
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof VaultArchiveError
            ? error.message
            : "The archive operation could not be completed. Check selected records and owning database access, then reload the vault. No fallback store was used.",
        );
    } finally {
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        setPassword("");
        setConfirmation("");
        onBusyChange?.(false);
      }
    }
  };
  const exportFile = () =>
    run(async () => {
      if (password !== confirmation || [...password].length < 12)
        throw new Error("Confirm archive password.");
      await verify();
      const archive = await latest.current.api.exportArchive!(
        snapshot,
        [...selected],
        [...connectionIds],
      );
      assertCurrent();
      const ciphertext = await encryptVaultArchive(archive, password);
      assertCurrent();
      const saved = await saveVaultArchiveFile(
        ciphertext,
        assertCurrent,
        verify,
      );
      assertCurrent();
      if (saved)
        setNotice(
          "Encrypted archive saved. Keep its password separately; it cannot be recovered.",
        );
    });
  const openFile = () =>
    run(async () => {
      const file = await chooseVaultArchiveFile(assertCurrent);
      if (file === null) return;
      const archive = await decryptVaultArchive(file, password);
      assertCurrent();
      await verify();
      setReview(archive);
    });
  const importReviewed = () =>
    run(async () => {
      if (!review) throw new Error("Review required.");
      await verify();
      const result = await latest.current.api.importArchive!(snapshot, review);
      assertCurrent();
      setReview(null);
      setNotice(
        `Imported ${result.credentialCount} credentials and ${result.connectionCount} linked connections as new records.${result.warning ? " Additional pending edits could not be saved. Keep the database open and review its save error; do not import this archive again." : ""}`,
      );
      const refreshFailed = () =>
        setNotice((previous) =>
          result.warning
            ? `${previous} The vault list could not refresh; keep this database open and preserve pending drafts.`
            : "Import committed successfully. Close this dialog and reload the vault to refresh its list.",
        );
      try {
        if ((await onImported()) === false && alive.current) refreshFailed();
      } catch {
        if (alive.current) refreshFailed();
      }
    });
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : onClose}
      ariaLabel={`${mode === "export" ? "Export" : "Import"} encrypted vault archive`}
      panelClassName="!max-w-2xl max-h-[85vh] overflow-y-auto"
    >
      <div className="p-5 space-y-4">
        <h3 className="font-semibold">
          {mode === "export" ? "Export" : "Import"} encrypted vault archive
        </h3>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Password-encrypted credentials and optional linked connections only.
          Social sign-in and passkey entries are descriptive bindings, not
          transferable sessions or hardware keys; sign in or enroll again on the
          destination.
        </p>
        {!supported && (
          <p role="alert">
            Archive operations are unavailable in this database context. Open
            the current protected database in the main window.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {mode === "export" && (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                className="sor-btn-secondary-sm"
                disabled={busy}
                onClick={() =>
                  setSelected(new Set(snapshot.entries.map((row) => row.id)))
                }
              >
                Select all credentials
              </button>
              <button
                type="button"
                className="sor-btn-secondary-sm"
                disabled={busy}
                onClick={() => {
                  setSelected(new Set());
                  setConnectionIds(new Set());
                }}
              >
                Clear selection
              </button>
            </div>
            <fieldset
              disabled={busy}
              className="max-h-44 overflow-auto space-y-2 border border-[var(--color-border)] rounded p-3"
            >
              <legend className="text-sm">Credentials ({selected.size})</legend>
              {snapshot.entries.map((row) => (
                <label key={row.id} className="flex gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onChange={(checked) => {
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      });
                      if (!checked)
                        setConnectionIds(
                          (previous) =>
                            new Set(
                              [...previous].filter(
                                (id) =>
                                  connections.find(
                                    (connection) => connection.id === id,
                                  )?.credentialId !== row.id,
                              ),
                            ),
                        );
                    }}
                  />
                  {row.name}
                </label>
              ))}
            </fieldset>
            <fieldset
              disabled={busy}
              className="max-h-44 overflow-auto space-y-2 border border-[var(--color-border)] rounded p-3"
            >
              <legend className="text-sm">
                Optional linked connections ({connectionIds.size})
              </legend>
              {connections.length ? (
                connections.map((row) => (
                  <label key={row.id} className="flex gap-2 text-sm">
                    <Checkbox
                      checked={connectionIds.has(row.id)}
                      disabled={!selected.has(row.credentialId)}
                      onChange={(checked) =>
                        setConnectionIds((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {row.name}{" "}
                      <span className="text-[var(--color-textMuted)]">
                        ({row.protocol})
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-[var(--color-textMuted)]">
                  No readable linked connections available.
                </p>
              )}
            </fieldset>
          </>
        )}
        {review ? (
          <section className="space-y-3 rounded border border-warning/40 p-3">
            <h4 className="font-medium">Review import</h4>
            <p>
              {review.credentials.length} credentials ·{" "}
              {review.connections.length} linked connections
            </p>
            <p className="text-xs text-[var(--color-textSecondary)]">
              All records receive fresh IDs; nothing is overwritten. Connections
              are placed at the database root. Custom icon assets and external
              libraries are not included. Scripts, automatic login/MFA and
              redirect trust require new review; missing external route
              dependencies are rejected. Certificate and host-key verification
              starts fresh.
            </p>
            <ul className="max-h-32 overflow-auto text-sm">
              {review.credentials.map((row) => (
                <li key={row.id}>{row.name}</li>
              ))}
              {review.connections.map((row) => (
                <li key={row.id}>
                  {row.name} · {row.protocol}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="sor-btn-primary-sm"
              disabled={busy || !supported}
              onClick={() => void importReviewed()}
            >
              Import reviewed records
            </button>
          </section>
        ) : (
          <>
            <label className="block space-y-1 text-sm">
              Archive password
              <PasswordInput
                aria-label="Archive password"
                autoComplete={mode === "export" ? "new-password" : "off"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={1024}
                disabled={busy}
                className="sor-form-input"
              />
            </label>
            {mode === "export" && (
              <label className="block space-y-1 text-sm">
                Confirm archive password
                <PasswordInput
                  aria-label="Confirm archive password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  maxLength={1024}
                  disabled={busy}
                  className="sor-form-input"
                />
              </label>
            )}
            {mode === "export" && (
              <p className="text-xs text-[var(--color-textMuted)]">
                Use at least 12 characters. The configured app password policy
                also applies. Selected secret values are disclosed only into
                this encrypted file.
              </p>
            )}
            <button
              type="button"
              className="sor-btn-primary-sm"
              disabled={
                busy ||
                !supported ||
                !password ||
                (mode === "export" &&
                  (!selected.size ||
                    password !== confirmation ||
                    [...password].length < 12))
              }
              onClick={() =>
                void (mode === "export" ? exportFile() : openFile())
              }
            >
              {busy
                ? "Working…"
                : mode === "export"
                  ? "Encrypt and save archive"
                  : "Open and review archive"}
            </button>
          </>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
