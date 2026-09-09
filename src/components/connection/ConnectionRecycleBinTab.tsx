import { useId, useMemo, useState } from "react";
import { ArrowUpFromLine, Folder, Lock, Search, Trash2 } from "lucide-react";
import { useConnectionRecycleBin } from "../../hooks/connection/useConnectionRecycleBin";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import { RecycleBinReviewDialog } from "./RecycleBinReviewDialog";

const PAGE_SIZE = 50;
const EMPTY_SELECTION: string[] = [];
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString();

export default function ConnectionRecycleBinTab({
  databaseId,
}: {
  databaseId: string;
}) {
  const mgr = useConnectionRecycleBin(databaseId);
  const inputId = useId();
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState("");
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({
    key: "",
    ids: [],
  });
  const [pageState, setPage] = useState({ key: "", page: 0 });
  const rows = mgr.snapshot?.entries;
  const selected =
    selection.key === mgr.scopeKey ? selection.ids : EMPTY_SELECTION;
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filterKey = JSON.stringify([mgr.scopeKey, search, protocol]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (rows ?? []).filter(
      (row) =>
        (!protocol || (row.isGroup ? "folder" : row.protocol) === protocol) &&
        (!term ||
          `${row.name} ${row.protocol} ${row.parentName ?? ""}`
            .toLocaleLowerCase()
            .includes(term)),
    );
  }, [rows, search, protocol]);
  const protocols = useMemo(
    () =>
      [
        ...new Set(
          (rows ?? []).map((row) => (row.isGroup ? "folder" : row.protocol)),
        ),
      ].sort(),
    [rows],
  );
  const page = Math.min(
    pageState.key === filterKey ? pageState.page : 0,
    Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1),
  );
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selectedVisible =
    visible.length > 0 && visible.every((row) => selectedSet.has(row.id));
  const setSelected = (ids: string[]) =>
    setSelection({ key: mgr.scopeKey, ids });
  const toggle = (id: string) =>
    setSelected(
      selectedSet.has(id)
        ? selected.filter((item) => item !== id)
        : [...selected, id],
    );
  const database = DatabaseManager.getInstance().getCurrentDatabase();
  const databaseName = database?.id === databaseId ? database.name : databaseId;

  return (
    <section
      aria-label="Connection recycle bin"
      className="h-full min-h-0 flex flex-col bg-[var(--color-background)] text-[var(--color-text)]"
    >
      <header className="shrink-0 border-b border-[var(--color-border)] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Trash2 size={20} className="text-primary" />
          <h2 className="text-lg font-medium">Recycle Bin</h2>
        </div>
        <p className="text-sm break-words">
          Database:{" "}
          <span className="font-medium">{databaseName || "Unavailable"}</span>
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Deleted connections stay in this database. Restoring a folder includes
          its retained children from the same deletion. Existing connections are
          never overwritten.
        </p>
      </header>
      {!mgr.snapshot ? (
        <div
          role="status"
          className="m-auto max-w-md p-6 text-center space-y-2"
        >
          <Lock className="mx-auto text-[var(--color-textSecondary)]" />
          <h3 className="font-medium">Recycle bin unavailable</h3>
          <p className="text-sm text-[var(--color-textSecondary)]">
            Open and unlock this database to view its deleted connections. This
            tab does not switch databases or bypass the application lock.
          </p>
        </div>
      ) : (
        <>
          <div className="shrink-0 p-4 border-b border-[var(--color-border)] space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72 max-w-full">
                <label htmlFor={inputId} className="block text-xs mb-1">
                  Search deleted connections
                </label>
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]"
                  />
                  <input
                    id={inputId}
                    className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Name, protocol or original folder"
                  />
                </div>
              </div>
              <label className="text-xs">
                Type
                <select
                  className="sor-form-input-xs block mt-1 w-40"
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value)}
                >
                  <option value="">All types</option>
                  {protocols.map((value) => (
                    <option key={value} value={value}>
                      {value === "folder" ? "Folders" : value.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              {(search || protocol) && (
                <button
                  className="sor-btn sor-btn-secondary text-xs"
                  onClick={() => {
                    setSearch("");
                    setProtocol("");
                  }}
                >
                  Clear filters
                </button>
              )}
              <span className="text-xs text-[var(--color-textSecondary)] pb-1">
                {filtered.length} of {rows?.length ?? 0} items ·{" "}
                {selected.length} selected
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="sor-btn sor-btn-secondary text-xs"
                disabled={mgr.busy || !filtered.length}
                onClick={() =>
                  setSelected([
                    ...new Set([...selected, ...filtered.map((row) => row.id)]),
                  ])
                }
              >
                Select all matching
              </button>
              <button
                className="sor-btn sor-btn-secondary text-xs"
                disabled={mgr.busy || !selected.length}
                onClick={() => setSelected([])}
              >
                Clear selection
              </button>
              <button
                className="sor-btn sor-btn-secondary text-xs"
                disabled={mgr.busy || !selected.length}
                onClick={() => void mgr.restore(selected)}
                data-tooltip="Restore selected items; existing connections are retained"
              >
                <ArrowUpFromLine size={14} />
                Restore selected
              </button>
              <button
                className="sor-btn sor-btn-secondary text-xs"
                disabled={mgr.busy || !selected.length}
                onClick={() => void mgr.reviewPurge(selected)}
                data-tooltip="Review permanent deletion of selected items"
              >
                <Trash2 size={14} />
                Delete selected permanently
              </button>
              <button
                className="sor-btn sor-btn-secondary text-xs ml-auto"
                disabled={mgr.busy || !rows?.length}
                onClick={() => void mgr.reviewPurge(null)}
                data-tooltip="Review permanent deletion of all items, including filtered-out entries"
              >
                Empty recycle bin
              </button>
            </div>
            <p className="text-xs text-[var(--color-textSecondary)]">
              Retention:{" "}
              {mgr.snapshot.policy.mode === "forever"
                ? "Keep indefinitely"
                : `${mgr.snapshot.policy.days} days after deletion`}
              . Change it in Settings → Security → Current database recycle bin.
              Backups and shared vault artifacts are not erased.
            </p>
            {mgr.error && (
              <p role="alert" className="text-sm text-error break-words">
                {mgr.error}
              </p>
            )}
            {mgr.message && (
              <p role="status" className="text-sm break-words">
                {mgr.message}
              </p>
            )}
            {mgr.busy && (
              <p role="status" className="text-xs">
                Saving recycle-bin changes…
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {!filtered.length ? (
              <p className="p-8 text-center text-sm text-[var(--color-textSecondary)]">
                {rows?.length
                  ? "No deleted connections match these filters."
                  : "The recycle bin is empty. Deleted connections will appear here."}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-surface)] text-xs text-[var(--color-textSecondary)]">
                  <tr>
                    <th className="p-3">
                      <input
                        type="checkbox"
                        aria-label="Select this page"
                        checked={selectedVisible}
                        disabled={mgr.busy}
                        onChange={() =>
                          setSelected(
                            selectedVisible
                              ? (() => {
                                  const pageIds = new Set(
                                    visible.map((row) => row.id),
                                  );
                                  return selected.filter(
                                    (id) => !pageIds.has(id),
                                  );
                                })()
                              : [
                                  ...new Set([
                                    ...selected,
                                    ...visible.map((row) => row.id),
                                  ]),
                                ],
                          )
                        }
                      />
                    </th>
                    <th className="p-3 text-left">Name / original folder</th>
                    <th className="p-3 text-left">Type</th>
                    <th className="p-3 text-left">Deleted</th>
                    <th className="p-3 text-left">Expires</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          checked={selectedSet.has(row.id)}
                          disabled={mgr.busy}
                          onChange={() => toggle(row.id)}
                        />
                      </td>
                      <td className="p-3 min-w-40 max-w-sm">
                        <span className="flex items-center gap-2 break-words">
                          {row.isGroup && (
                            <Folder size={14} className="shrink-0" />
                          )}
                          {row.name}
                        </span>
                        <span className="block text-xs text-[var(--color-textSecondary)] break-words">
                          {row.parentName ?? "Root"}
                          {row.descendantCount > 0
                            ? ` · ${row.descendantCount} retained children`
                            : ""}
                        </span>
                      </td>
                      <td className="p-3 text-xs">
                        {row.isGroup ? "Folder" : row.protocol.toUpperCase()}
                      </td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        {formatDate(row.deletedAt)}
                      </td>
                      <td className="p-3 text-xs whitespace-nowrap">
                        {row.expiresAt === null
                          ? "Never"
                          : formatDate(row.expiresAt)}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <button
                            className="sor-btn sor-btn-secondary p-2"
                            aria-label={`Restore ${row.name}`}
                            data-tooltip="Restore this item and retained children"
                            disabled={mgr.busy}
                            onClick={() => void mgr.restore([row.id])}
                          >
                            <ArrowUpFromLine size={14} />
                          </button>
                          <button
                            className="sor-btn sor-btn-secondary p-2"
                            aria-label={`Permanently delete ${row.name}`}
                            data-tooltip="Review permanent deletion"
                            disabled={mgr.busy}
                            onClick={() => void mgr.reviewPurge([row.id])}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="shrink-0 border-t border-[var(--color-border)] p-3 flex items-center justify-end gap-3 text-xs">
            <span>
              Page {page + 1} of{" "}
              {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
            </span>
            <button
              className="sor-btn sor-btn-secondary"
              disabled={!page}
              onClick={() => setPage({ key: filterKey, page: page - 1 })}
            >
              Previous page
            </button>
            <button
              className="sor-btn sor-btn-secondary"
              disabled={(page + 1) * PAGE_SIZE >= filtered.length}
              onClick={() => setPage({ key: filterKey, page: page + 1 })}
            >
              Next page
            </button>
          </footer>
          <RecycleBinReviewDialog
            databaseName={databaseName}
            review={mgr.review}
            busy={mgr.busy}
            onConfirm={mgr.confirm}
            onCancel={mgr.cancelReview}
          />
        </>
      )}
    </section>
  );
}
