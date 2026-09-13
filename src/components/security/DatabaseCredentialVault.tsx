import React, { useContext, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  Download,
} from "lucide-react";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type {
  DatabaseCredentialSnapshot,
  DatabaseCredentialVaultApi,
} from "../../types/security/databaseCredentialVault";
import {
  credentialVaultScopeKey,
  FACET_LABELS,
  useDatabaseCredentialVault,
} from "../../hooks/security/useDatabaseCredentialVault";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import CredentialEntryForm from "./databaseCredentialVault/CredentialEntryForm";
import { registerCredentialVaultDraft } from "../../utils/security/credentialVaultDrafts";
const VaultArchiveDialog = React.lazy(
  () => import("./databaseCredentialVault/VaultArchiveDialog"),
);

interface Props {
  sessionId?: string;
  onDirtyChange?: (value: boolean) => void;
  onBusyChange?: (value: boolean) => void;
}

function VaultWorkspace({
  api,
  onDirtyChange,
  onBusyChange,
  sessionId,
}: Props & { api: DatabaseCredentialVaultApi }) {
  const mgr = useDatabaseCredentialVault(api);
  const [archive, setArchive] = useState<{
    mode: "import" | "export";
    snapshot: DatabaseCredentialSnapshot;
  } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const draftVersion = useRef({
    draft: mgr.draft,
    busy: mgr.busy || archiveBusy,
    revision: 0,
  });
  if (
    draftVersion.current.draft !== mgr.draft ||
    draftVersion.current.busy !== (mgr.busy || archiveBusy)
  )
    draftVersion.current = {
      draft: mgr.draft,
      busy: mgr.busy || archiveBusy,
      revision: draftVersion.current.revision + 1,
    };
  const closeState = useRef({
    databaseId: api.scope!.databaseId,
    scopeKey: credentialVaultScopeKey(api),
    dirty: mgr.dirty,
    busy: mgr.busy || archiveBusy,
    revision: draftVersion.current.revision,
  });
  closeState.current = {
    databaseId: api.scope!.databaseId,
    scopeKey: credentialVaultScopeKey(api),
    dirty: mgr.dirty,
    busy: mgr.busy || archiveBusy,
    revision: draftVersion.current.revision,
  };
  useEffect(
    () =>
      sessionId
        ? registerCredentialVaultDraft(sessionId, () => closeState.current)
        : undefined,
    [sessionId],
  );
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [review, setReview] = useState<{
    id: string;
    message: string;
    danger: boolean;
    action: () => void;
  } | null>(null);
  const reviewRef = useRef(review);
  reviewRef.current = review;
  useEffect(() => {
    onDirtyChange?.(mgr.dirty);
    return () => onDirtyChange?.(false);
  }, [mgr.dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(mgr.busy || archiveBusy);
    return () => onBusyChange?.(false);
  }, [mgr.busy, archiveBusy, onBusyChange]);
  const request = (action: () => void) => {
    if (mgr.busy || archiveBusy) return;
    if (mgr.dirty) {
      const next = {
        id: crypto.randomUUID(),
        message:
          "Discard the unsaved credential changes? The saved vault entry will not be changed.",
        danger: false,
        action,
      };
      reviewRef.current = next;
      setReview(next);
    } else action();
  };
  const remove = (snapshot: DatabaseCredentialSnapshot, id: string) => {
    const next = {
      id: crypto.randomUUID(),
      message:
        "Delete this credential from this database? Referencing connections will need another credential. This does not revoke credentials at the remote service.",
      danger: true,
      action: () => {
        void mgr.remove(snapshot, id);
      },
    };
    reviewRef.current = next;
    setReview(next);
  };
  const rows = (mgr.snapshot?.entries ?? []).filter((row) =>
    `${row.name} ${row.availableFacets.map((key) => FACET_LABELS[key]).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 25)),
    currentPage = Math.min(page, pages - 1);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
        <KeyRound size={20} className="text-primary" />
        <h2 className="font-semibold">Database credential vault</h2>
        <span className="text-xs text-[var(--color-textSecondary)]">
          Current protected database · {mgr.snapshot?.entries.length ?? 0}{" "}
          credentials
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={mgr.busy || mgr.loading || !mgr.snapshot || archiveBusy}
            onClick={() =>
              request(() => {
                mgr.discard();
                setArchive({ mode: "import", snapshot: mgr.snapshot! });
              })
            }
          >
            <Upload size={14} />
            Import archive
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={
              mgr.busy ||
              mgr.loading ||
              !mgr.snapshot?.entries.length ||
              archiveBusy
            }
            onClick={() =>
              request(() => {
                mgr.discard();
                setArchive({ mode: "export", snapshot: mgr.snapshot! });
              })
            }
          >
            <Download size={14} />
            Export archive
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={mgr.busy || mgr.loading}
            onClick={() =>
              request(() => {
                mgr.discard();
                void mgr.reload();
              })
            }
          >
            <RefreshCw size={14} />
            Reload vault
          </button>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={mgr.busy || mgr.loading || !mgr.snapshot}
            onClick={() => request(mgr.create)}
          >
            <Plus size={14} />
            New credential
          </button>
        </div>
      </header>
      <p className="px-4 pt-3 text-xs text-[var(--color-textSecondary)]">
        Reusable credentials stay inside this database's managed protection.
        Global rotation tracking and integration credentials are separate and
        are never imported automatically.
      </p>
      {mgr.error && (
        <p
          role="alert"
          className="m-4 rounded border border-error/40 p-3 text-sm text-error"
        >
          {mgr.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {mgr.draft ? (
          <CredentialEntryForm
            key={mgr.draft.id}
            entry={mgr.draft}
            onChange={mgr.update}
            onSave={() => {
              void mgr.save();
            }}
            onCancel={() => request(mgr.discard)}
            busy={mgr.busy}
          />
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2">
              <Search size={16} />
              <input
                type="search"
                aria-label="Search vault credentials"
                className="sor-form-input"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Search names or credential types"
              />
            </label>
            <table
              className="w-full text-left text-sm"
              aria-label="Database vault credentials"
              aria-busy={mgr.loading}
            >
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="p-2">Name</th>
                  <th className="p-2">Credential types</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(currentPage * 25, currentPage * 25 + 25)
                  .map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-[var(--color-border)]"
                    >
                      <td className="p-2 font-medium">{row.name}</td>
                      <td className="p-2 text-[var(--color-textSecondary)]">
                        {row.availableFacets
                          .map((key) => FACET_LABELS[key])
                          .join(", ")}
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="sor-btn sor-btn-secondary"
                            disabled={mgr.busy || mgr.loading}
                            aria-label={`Edit ${row.name}`}
                            data-tooltip="Explicitly load this credential into the private editor"
                            onClick={() => {
                              void mgr.edit(row);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="sor-btn sor-btn-danger"
                            disabled={mgr.busy || mgr.loading}
                            aria-label={`Delete ${row.name}`}
                            onClick={() => remove(mgr.snapshot!, row.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {!rows.length && (
                  <tr>
                    <td
                      colSpan={3}
                      className="p-5 text-center text-[var(--color-textSecondary)]"
                    >
                      {mgr.loading
                        ? "Loading credential metadata…"
                        : mgr.error
                          ? "The vault is unavailable. Reload after restoring access."
                          : search
                            ? "No matching credentials."
                            : "This database's vault is empty. Create a credential to reuse it across connections."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <footer className="mt-3 flex items-center justify-between text-xs">
              <span>
                Page {currentPage + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
      {archive && (
        <React.Suspense
          fallback={
            <p role="status" className="p-4">
              Loading encrypted archive controls…
            </p>
          }
        >
          <VaultArchiveDialog
            key={`${credentialVaultScopeKey(api)}:${archive.snapshot.receipt}`}
            api={api}
            snapshot={archive.snapshot}
            mode={archive.mode}
            onClose={() => setArchive(null)}
            onImported={mgr.reload}
            onBusyChange={setArchiveBusy}
          />
        </React.Suspense>
      )}
      <ConfirmDialog
        isOpen={!!review}
        title={
          review?.danger ? "Delete vault credential" : "Discard private draft"
        }
        message={review?.message ?? ""}
        confirmText={review?.danger ? "Delete credential" : "Discard changes"}
        variant={review?.danger ? "danger" : "warning"}
        confirmOnEnter={false}
        onCancel={() => {
          reviewRef.current = null;
          setReview(null);
        }}
        onConfirm={() => {
          if (!review || reviewRef.current?.id !== review.id || mgr.busy)
            return;
          const action = review.action;
          reviewRef.current = null;
          setReview(null);
          action();
        }}
      />
    </div>
  );
}

export default function DatabaseCredentialVault(props: Props) {
  const context = useContext(ConnectionContext),
    api = context?.credentialVault;
  const key = credentialVaultScopeKey(api);
  if (!api?.scope)
    return (
      <section className="p-6 text-sm" aria-label="Database credential vault">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <ShieldAlert size={18} />
          Database credential vault unavailable
        </h2>
        <p>
          Open and unlock the owning database. Protect it in Settings → Security
          → Current database, or enable unlocked app-wide encryption for
          connection data. No plaintext or unrelated global vault fallback is
          used.
        </p>
      </section>
    );
  return <VaultWorkspace key={key} api={api} {...props} />;
}
