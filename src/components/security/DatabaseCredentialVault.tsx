import React, { useContext, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  Download,
  Pencil,
  Trash2,
  ArrowRightToLine,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import SettingsContext from "../../contexts/SettingsContext";
import {
  normalizeCredentialVaultView,
  VAULT_COLUMNS,
  type VaultColumn,
} from "../../utils/settings/credentialVaultView";
import { ConnectionContext } from "../../contexts/ConnectionContextTypes";
import type { Connection } from "../../types/connection/connection";
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
import { Select } from "../ui/forms/Select";
import type { CredentialEditorRequest } from "../../types/security/credentialEditor";
import { registerCredentialVaultDraft } from "../../utils/security/credentialVaultDrafts";
import {
  CONNECTION_CREDENTIAL_LABELS,
  CONNECTION_CREDENTIAL_STORAGE_LABELS,
  connectionCredentialMatches,
} from "../../utils/security/connectionCredentialInventory";
import { useConnectionCredentialInventory } from "./databaseCredentialVault/useConnectionCredentialInventory";
import { vaultCredentialCategories } from "../../utils/security/credentialVaultCategories";
import type { DatabaseCredentialMetadata } from "../../types/security/databaseCredentialVault";
const VaultArchiveDialog = React.lazy(
  () => import("./databaseCredentialVault/VaultArchiveDialog"),
);

interface Props {
  sessionId?: string;
  onDirtyChange?: (value: boolean) => void;
  onBusyChange?: (value: boolean) => void;
  onEditConnection?: (connection: Connection) => void;
  onOpenEditor?: (request: CredentialEditorRequest) => void;
}

function VaultWorkspace({
  api,
  onDirtyChange,
  onBusyChange,
  sessionId,
  onEditConnection,
  onOpenEditor,
}: Props & { api: DatabaseCredentialVaultApi }) {
  const preferences = useContext(SettingsContext);
  const view = normalizeCredentialVaultView(
    preferences?.settings.credentialVaultView,
  );
  const [layoutError, setLayoutError] = useState(false);
  const drag = useRef<{
    id: VaultColumn;
    x: number;
    width: number;
    latest: number;
  } | null>(null);
  const [dragWidth, setDragWidth] = useState<{
    id: VaultColumn;
    width: number;
  } | null>(null);
  const saveView = (patch: Partial<typeof view>) => {
    setLayoutError(false);
    void preferences
      ?.updateSettings({
        credentialVaultView: normalizeCredentialVaultView({
          ...view,
          ...patch,
        }),
      })
      .catch(() => setLayoutError(true));
  };
  const mgr = useDatabaseCredentialVault(api);
  const inventory = useConnectionCredentialInventory(
    api,
    mgr.snapshot,
    mgr.loading,
    onEditConnection,
  );
  const [archive, setArchive] = useState<{
    mode: "import" | "export";
    snapshot: DatabaseCredentialSnapshot;
  } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const busy = mgr.busy || archiveBusy || inventory.opening;
  const draftVersion = useRef({
    draft: mgr.draft,
    busy,
    revision: 0,
  });
  if (
    draftVersion.current.draft !== mgr.draft ||
    draftVersion.current.busy !== busy
  )
    draftVersion.current = {
      draft: mgr.draft,
      busy,
      revision: draftVersion.current.revision + 1,
    };
  const closeState = useRef({
    databaseId: api.scope!.databaseId,
    scopeKey: credentialVaultScopeKey(api),
    dirty: mgr.dirty,
    busy,
    revision: draftVersion.current.revision,
  });
  closeState.current = {
    databaseId: api.scope!.databaseId,
    scopeKey: credentialVaultScopeKey(api),
    dirty: mgr.dirty,
    busy,
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
  const [source, setSource] = useState<"all" | "vault" | "connections">("all");
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
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const request = (action: () => void) => {
    if (busy) return;
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
  const assignmentText = (id: string) =>
    inventory.assignments === null
      ? "Assignments unavailable"
      : (inventory.assignments.get(id) ?? [])
          .map((row) =>
            row.application ? `${row.name} (${row.application})` : row.name,
          )
          .join(", ") || "Not assigned";
  const categoryLabels = (row: DatabaseCredentialMetadata) =>
    vaultCredentialCategories(
      row,
      (inventory.assignments?.get(row.id) ?? []).flatMap(
        (assignment) => assignment.categories,
      ),
    );
  const vaultRows = (mgr.snapshot?.entries ?? []).filter((row) =>
    `${row.name} ${row.availableFacets.map((key) => FACET_LABELS[key]).join(" ")} ${categoryLabels(row).join(" ")} ${assignmentText(row.id)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const rows = [
    ...(source === "connections"
      ? []
      : vaultRows.map((row) => ({ source: "vault" as const, row }))),
    ...(source === "vault"
      ? []
      : inventory.rows
          .filter(
            (row) =>
              connectionCredentialMatches(row, search) ||
              [
                ...(inventory.categories.get(row.id) ?? []),
                inventory.applications.get(row.id) ?? "",
              ]
                .join(" ")
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
          )
          .map((row) => ({ source: "connection" as const, row }))),
  ];
  const scope = JSON.stringify([
    credentialVaultScopeKey(api),
    search,
    source,
    view.pageSize,
    view.mode,
  ]);
  const scrollPane = useRef<HTMLDivElement>(null);
  const [windowState, setWindowState] = useState({
    scope,
    count: view.pageSize as number,
  });
  useEffect(() => {
    setWindowState({ scope, count: view.pageSize });
    setPage(0);
    if (scrollPane.current) scrollPane.current.scrollTop = 0;
  }, [scope, view.pageSize]);
  const visibleCount =
    windowState.scope === scope ? windowState.count : view.pageSize;
  const grow = () =>
    setWindowState({
      scope,
      count: Math.min(rows.length, visibleCount + view.pageSize),
    });
  const pages = Math.max(1, Math.ceil(rows.length / view.pageSize)),
    currentPage = Math.min(page, pages - 1);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <KeyRound size={20} className="text-primary" />
        <h2 className="font-semibold">Database credential vault</h2>
        <span className="text-xs text-[var(--color-textSecondary)]">
          Current protected database · {mgr.snapshot?.entries.length ?? 0}{" "}
          reusable credentials · {inventory.rows.length} connections with
          credentials / references
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="sor-btn-icon"
            aria-label="Import archive"
            data-tooltip="Import archive"
            disabled={busy || mgr.loading || !mgr.snapshot}
            onClick={() =>
              request(() => {
                mgr.discard();
                setArchive({ mode: "import", snapshot: mgr.snapshot! });
              })
            }
          >
            <Upload size={14} />
          </button>
          <button
            type="button"
            className="sor-btn-icon"
            aria-label="Export archive"
            data-tooltip="Export archive"
            disabled={
              busy ||
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
          </button>
          <button
            type="button"
            className="sor-btn-icon"
            aria-label="Reload vault"
            data-tooltip="Reload vault"
            disabled={busy || mgr.loading}
            onClick={() =>
              request(() => {
                mgr.discard();
                void mgr.reload();
              })
            }
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="sor-btn-icon text-primary"
            aria-label="New credential"
            data-tooltip="New credential"
            disabled={busy || mgr.loading || !mgr.snapshot || !onOpenEditor}
            onClick={() =>
              onOpenEditor?.({ mode: "create", scope: { ...api.scope! } })
            }
          >
            <Plus size={14} />
          </button>
        </div>
      </header>
      <p className="px-4 pt-3 text-xs text-[var(--color-textSecondary)]">
        Reusable entries and saved connection credentials are shown together
        without copying secrets. Connection rows open the original connection
        editor. External references stay in their owning stores; archive
        controls include reusable vault entries only, not these virtual rows.
      </p>
      {inventory.error && (
        <p role="alert" className="m-4 text-sm text-error">
          {inventory.error}
        </p>
      )}
      {inventory.unavailable && !mgr.loading && (
        <p
          role="status"
          className="m-4 text-sm text-[var(--color-textSecondary)]"
        >
          Connection-backed inventory is unavailable. Open and unlock this
          database in the main window, then reload.
        </p>
      )}
      {mgr.error && (
        <p
          role="alert"
          className="m-4 rounded border border-error/40 p-3 text-sm text-error"
        >
          {mgr.error}
        </p>
      )}
      <div
        className="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain p-4"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--color-border) var(--color-background)",
          scrollbarGutter: "stable",
        }}
        ref={scrollPane}
        onScroll={(event) => {
          const pane = event.currentTarget;
          if (
            view.mode === "infinite" &&
            pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120 &&
            visibleCount < rows.length
          )
            grow();
        }}
        role="region"
        aria-label="Credential inventory"
        tabIndex={0}
      >
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
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
                placeholder="Search names, tags, types or assignments"
              />
            </label>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="vault-credential-source-filter">Source</label>
              <Select
                id="vault-credential-source-filter"
                label="Credential source filter"
                variant="form-sm"
                value={source}
                onChange={(value) => {
                  setSource(value as typeof source);
                  setPage(0);
                }}
                options={[
                  { value: "all", label: "All sources" },
                  { value: "vault", label: "Reusable vault" },
                  { value: "connections", label: "Connections" },
                ]}
              />
            </div>
          </div>
          {layoutError && (
            <p role="alert">Could not save the credential list layout.</p>
          )}
          <table
            style={{
              width: view.columns.reduce(
                (sum, id) =>
                  sum +
                  (dragWidth?.id === id ? dragWidth.width : view.widths[id]),
                0,
              ),
            }}
            className="table-fixed text-left text-sm [&_td]:whitespace-nowrap [&_td]:px-2 [&_td]:py-1.5"
            aria-label="Database vault credentials"
            aria-busy={mgr.loading}
          >
            <colgroup>
              {view.columns.map((id) => (
                <col
                  key={id}
                  style={{
                    width:
                      dragWidth?.id === id ? dragWidth.width : view.widths[id],
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {VAULT_COLUMNS.filter((column) =>
                  view.columns.includes(column.id),
                ).map(({ id, label, min }) => (
                  <th key={id} scope="col" className="relative truncate p-2">
                    {label}
                    <span
                      role="separator"
                      aria-label={`Resize ${label} column`}
                      aria-orientation="vertical"
                      aria-valuemin={min}
                      aria-valuemax={640}
                      aria-valuenow={
                        dragWidth?.id === id ? dragWidth.width : view.widths[id]
                      }
                      tabIndex={preferences ? 0 : -1}
                      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-r border-[var(--color-border)] focus-visible:outline focus-visible:outline-primary"
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowLeft" ||
                          event.key === "ArrowRight"
                        ) {
                          event.preventDefault();
                          saveView({
                            widths: {
                              ...view.widths,
                              [id]:
                                view.widths[id] +
                                (event.key === "ArrowRight" ? 10 : -10),
                            },
                          });
                        }
                      }}
                      onPointerDown={(event) => {
                        if (!preferences) return;
                        event.preventDefault();
                        drag.current = {
                          id,
                          x: event.clientX,
                          width: view.widths[id],
                          latest: view.widths[id],
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        if (drag.current?.id !== id) return;
                        const width = Math.max(
                          min,
                          Math.min(
                            640,
                            drag.current.width + event.clientX - drag.current.x,
                          ),
                        );
                        drag.current.latest = width;
                        setDragWidth({ id, width });
                      }}
                      onPointerUp={(event) => {
                        if (drag.current?.id !== id) return;
                        const width = drag.current.latest;
                        drag.current = null;
                        setDragWidth(null);
                        event.currentTarget.releasePointerCapture(
                          event.pointerId,
                        );
                        saveView({ widths: { ...view.widths, [id]: width } });
                      }}
                      onLostPointerCapture={() => {
                        drag.current = null;
                        setDragWidth(null);
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                        setDragWidth(null);
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(
                  view.mode === "infinite" ? 0 : currentPage * view.pageSize,
                  view.mode === "infinite"
                    ? visibleCount
                    : (currentPage + 1) * view.pageSize,
                )
                .map((item) =>
                  item.source === "connection" ? (
                    <tr
                      key={`connection:${item.row.id}`}
                      className="border-b border-[var(--color-border)]"
                    >
                      <td
                        hidden={!view.columns.includes("name")}
                        className="p-2 font-medium"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="truncate"
                            data-tooltip={item.row.name}
                          >
                            {item.row.name}
                          </span>
                          <span className="shrink-0 text-xs font-normal text-[var(--color-textSecondary)]">
                            {item.row.protocol}
                          </span>
                        </span>
                      </td>
                      <td
                        hidden={!view.columns.includes("source")}
                        className="truncate text-xs"
                        data-tooltip={item.row.storage
                          .map(
                            (key) => CONNECTION_CREDENTIAL_STORAGE_LABELS[key],
                          )
                          .join(" · ")}
                      >
                        {item.row.storage
                          .map(
                            (key) => CONNECTION_CREDENTIAL_STORAGE_LABELS[key],
                          )
                          .join(" · ")}
                        {item.row.localValuesIgnored && (
                          <span
                            className="ml-1 text-[var(--color-textSecondary)]"
                            data-tooltip="Local login values retained, not a vault fallback"
                          >
                            · Local retained
                          </span>
                        )}
                      </td>
                      <td
                        hidden={!view.columns.includes("categories")}
                        className="truncate text-[var(--color-textSecondary)]"
                        data-tooltip={`Types: ${item.row.kinds.map((key) => CONNECTION_CREDENTIAL_LABELS[key]).join(", ")}`}
                      >
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs">
                          {(
                            inventory.categories.get(item.row.id) ?? ["Other"]
                          ).join(" · ")}
                        </span>
                      </td>
                      <td
                        hidden={!view.columns.includes("assigned")}
                        className="p-2 text-right text-[var(--color-textSecondary)]"
                        aria-label="Usage count not applicable to a connection-local row"
                      >
                        <span
                          className="block truncate"
                          data-tooltip={`${item.row.name}${inventory.applications.get(item.row.id) ? ` (${inventory.applications.get(item.row.id)})` : ""}`}
                        >
                          {item.row.name}
                          {inventory.applications.get(item.row.id)
                            ? ` (${inventory.applications.get(item.row.id)})`
                            : ""}
                        </span>
                      </td>
                      <td
                        hidden={!view.columns.includes("actions")}
                        className="p-2 text-right"
                      >
                        <div className="flex justify-end gap-2">
                          {inventory.migratable.has(item.row.id) && (
                            <button
                              type="button"
                              className="sor-btn-icon"
                              disabled={busy || mgr.loading || !onOpenEditor}
                              aria-label={`Move credentials from ${item.row.name} to vault`}
                              data-tooltip="Move to vault"
                              onClick={() =>
                                onOpenEditor?.({
                                  mode: "migrate",
                                  scope: { ...api.scope! },
                                  connectionId: item.row.id,
                                })
                              }
                            >
                              <ArrowRightToLine size={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="sor-btn-icon"
                            disabled={busy || mgr.loading || !onEditConnection}
                            aria-label={`Edit credentials in connection ${item.row.name}`}
                            data-tooltip="Open the owning connection editor; no secrets are copied into the vault"
                            onClick={() =>
                              request(() => {
                                void inventory.edit(item.row.id);
                              })
                            }
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={`vault:${item.row.id}`}
                      className="border-b border-[var(--color-border)]"
                    >
                      <td
                        hidden={!view.columns.includes("name")}
                        className="truncate font-medium"
                        data-tooltip={item.row.name}
                      >
                        {item.row.name}
                      </td>
                      <td
                        hidden={!view.columns.includes("source")}
                        className="p-2 text-xs"
                      >
                        Reusable vault
                      </td>
                      <td
                        hidden={!view.columns.includes("categories")}
                        className="truncate text-[var(--color-textSecondary)]"
                        data-tooltip={`${categoryLabels(item.row).join(", ")} · Types: ${item.row.availableFacets.map((key) => FACET_LABELS[key]).join(", ")}`}
                      >
                        <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-xs">
                          {categoryLabels(item.row).join(" · ")}
                        </span>
                      </td>
                      <td
                        hidden={!view.columns.includes("assigned")}
                        className="p-2 text-right tabular-nums"
                        aria-label={
                          inventory.usage === null
                            ? "Usage unavailable"
                            : `${inventory.usage.get(item.row.id) ?? 0} saved connection references`
                        }
                      >
                        <span className="flex min-w-0 items-center gap-1 text-left">
                          <span className="shrink-0" aria-hidden="true">
                            {inventory.usage === null
                              ? "—"
                              : (inventory.usage.get(item.row.id) ?? 0)}{" "}
                            ·
                          </span>
                          <span
                            className="truncate"
                            aria-label={assignmentText(item.row.id)}
                            data-tooltip={assignmentText(item.row.id)}
                          >
                            {assignmentText(item.row.id)}
                          </span>
                        </span>
                      </td>
                      <td
                        hidden={!view.columns.includes("actions")}
                        className="p-2"
                      >
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="sor-btn-icon"
                            disabled={busy || mgr.loading || !onOpenEditor}
                            aria-label={`Edit ${item.row.name}`}
                            data-tooltip="Explicitly load this credential into the private editor"
                            onClick={() => {
                              onOpenEditor?.({
                                mode: "edit",
                                scope: { ...api.scope! },
                                credentialId: item.row.id,
                              });
                            }}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="sor-btn-icon text-error"
                            disabled={busy || mgr.loading}
                            aria-label={`Delete ${item.row.name}`}
                            data-tooltip={`Delete ${item.row.name}`}
                            onClick={() => remove(mgr.snapshot!, item.row.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={view.columns.length}
                    className="p-5 text-center text-[var(--color-textSecondary)]"
                  >
                    {mgr.loading
                      ? "Loading credential metadata…"
                      : mgr.error
                        ? "The vault is unavailable. Reload after restoring access."
                        : search
                          ? "No matching credentials."
                          : "No credentials in this source. Create a reusable credential or save credentials in a connection."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <footer className="mt-3 flex items-center justify-between text-xs">
            <span>
              {rows.length} results ·{" "}
              {view.mode === "infinite"
                ? `Showing ${Math.min(visibleCount, rows.length)}`
                : `Page ${currentPage + 1} of ${pages}`}
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span>Per page</span>
                <Select
                  label="Credentials per page"
                  variant="form-sm"
                  value={view.pageSize}
                  disabled={!preferences}
                  onChange={(value) => {
                    setPage(0);
                    saveView({
                      pageSize: Number(value) as typeof view.pageSize,
                    });
                  }}
                  options={[25, 50, 100, 250].map((size) => ({
                    value: size,
                    label: String(size),
                  }))}
                />
              </div>
              {view.mode === "infinite" ? (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={visibleCount >= rows.length}
                  onClick={grow}
                >
                  Load more credentials
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="sor-btn-icon"
                    aria-label="Previous"
                    data-tooltip="Previous page"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="sor-btn-icon"
                    aria-label="Next"
                    data-tooltip="Next page"
                    disabled={currentPage + 1 >= pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </>
              )}
            </div>
          </footer>
        </>
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
          if (!review || reviewRef.current?.id !== review.id || busy) return;
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
