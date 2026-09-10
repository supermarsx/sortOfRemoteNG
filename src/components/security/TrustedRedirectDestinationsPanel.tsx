import { useRef, useState } from "react";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  useTrustedRedirectDestinations,
  type TrustedRedirectDestinationRow,
} from "../../hooks/security/useTrustedRedirectDestinations";
import { normalizeHttpRedirectOrigin } from "../../utils/protocol/httpTrustedRedirectDestinations";
import { Select } from "../ui/forms/Select";
import { Modal, ModalBody, ModalHeader } from "../ui/overlays/Modal";

type Manager = ReturnType<typeof useTrustedRedirectDestinations>;
type Review = { scopeKey: string } & (
  | {
      kind: "add";
      connectionId: string;
      connectionName: string;
      sourceOrigin: string;
      origin: string;
    }
  | { kind: "forget"; rows: TrustedRedirectDestinationRow[] }
);
const PAGE_SIZE = 50;

export default function TrustedRedirectDestinationsPanel() {
  const mgr = useTrustedRedirectDestinations();
  return <RedirectDestinationsContent key={mgr.scopeKey} mgr={mgr} />;
}

function RedirectDestinationsContent({ mgr }: { mgr: Manager }) {
  const latest = useRef(mgr);
  latest.current = mgr;
  const acting = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [origin, setOrigin] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [localError, setLocalError] = useState("");
  const disabled = !mgr.available || mgr.loading || mgr.busy;
  const rows = mgr.available ? mgr.rows : [];
  const visible = rows.filter(
    (row) =>
      (!filter || row.connectionId === filter) &&
      `${row.connectionName} ${row.sourceOrigin} ${row.origin}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const pageRows = visible.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const reviewed =
    review?.scopeKey === mgr.scopeKey && !disabled ? review : null;
  const options = mgr.connections.map((item) => ({
    value: item.id,
    label: `${item.name} — ${item.sourceOrigin}`,
  }));
  const confirm = async () => {
    if (!reviewed || acting.current) return;
    const current = latest.current;
    if (
      !current.available ||
      current.loading ||
      current.busy ||
      current.scopeKey !== reviewed.scopeKey
    )
      return;
    acting.current = true;
    setReview(null);
    setLocalError("");
    try {
      if (reviewed.kind === "add") {
        if (
          !current.connections.some(
            (item) =>
              item.id === reviewed.connectionId &&
              item.sourceOrigin === reviewed.sourceOrigin,
          )
        )
          throw new Error();
        await current.add(reviewed.connectionId, reviewed.origin);
        setOrigin("");
      } else {
        if (
          !reviewed.rows.every((row) =>
            current.rows.some(
              (item) =>
                item.id === row.id &&
                item.origin === row.origin &&
                item.sourceOrigin === row.sourceOrigin,
            ),
          )
        )
          throw new Error();
        await current.forget(reviewed.rows);
        setSelected(new Set());
      }
    } catch {
      setLocalError(
        "The destination change could not be saved. Refresh this database and review the addresses again.",
      );
    } finally {
      acting.current = false;
    }
  };
  return (
    <section
      aria-label="Trusted redirect destinations"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border)] p-4">
        <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
          Exact destination addresses, scoped to each saved connection in this
          database. A trusted destination skips repeated redirect review when
          the connection's redirect policy permits it. Certificate checks and
          login-forwarding approvals remain separate. No wildcards or
          database-wide grants.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--color-textMuted)]"
            />
            <input
              type="search"
              aria-label="Search redirect destinations"
              placeholder="Search connection or address"
              className="sor-form-input w-full !pl-8"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <Select
            label="Filter redirect connection"
            searchable
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(0);
            }}
            options={[
              { value: "", label: "All saved connections" },
              ...options,
            ]}
            variant="form-sm"
            className="min-w-52"
          />
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={mgr.busy || mgr.loading}
            onClick={() => void mgr.refresh().catch(() => {})}
          >
            <RefreshCw size={14} aria-hidden="true" />{" "}
            {mgr.loading ? "Refreshing…" : "Refresh destinations"}
          </button>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Add trusted redirect destination"
        >
          <Select
            label="Saved connection for destination"
            placeholder="Choose saved connection"
            searchable
            value={connectionId}
            onChange={setConnectionId}
            options={options}
            disabled={disabled}
            variant="form-sm"
            className="min-w-52 flex-1"
          />
          <input
            aria-label="Destination origin"
            placeholder="https://nas.example:5001"
            className="sor-form-input min-w-52 flex-1"
            value={origin}
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setOrigin(event.target.value);
              setLocalError("");
            }}
          />
          <button
            type="button"
            className="sor-btn-primary-sm"
            disabled={disabled || !connectionId || !origin.trim()}
            onClick={() => {
              const connection = mgr.connections.find(
                (item) => item.id === connectionId,
              );
              if (!connection) return;
              try {
                const normalized = normalizeHttpRedirectOrigin(origin.trim());
                setLocalError("");
                setReview({
                  kind: "add",
                  scopeKey: mgr.scopeKey,
                  connectionId,
                  connectionName: connection.name,
                  sourceOrigin: connection.sourceOrigin,
                  origin: normalized,
                });
              } catch {
                setLocalError(
                  "Enter an exact HTTP(S) origin without credentials, paths, query parameters, fragments or wildcards.",
                );
              }
            }}
          >
            <Plus size={14} aria-hidden="true" /> Review add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <span>
            {visible.length} of {rows.length} destinations ·{" "}
            {selectedRows.length} selected
          </span>
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={disabled || !selectedRows.length}
            onClick={() =>
              setReview({
                kind: "forget",
                scopeKey: mgr.scopeKey,
                rows: selectedRows,
              })
            }
          >
            <Trash2 size={14} aria-hidden="true" /> Forget selected
          </button>
          <button
            type="button"
            className="sor-btn-secondary-sm"
            disabled={!selected.size || mgr.busy}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
        {(localError || mgr.error) && (
          <p role="alert" className="text-xs text-error">
            {mgr.error || localError}
          </p>
        )}
        {mgr.notice && (
          <p
            role="status"
            className="text-xs text-[var(--color-textSecondary)]"
          >
            {mgr.notice}
          </p>
        )}
        {!mgr.available && (
          <p
            role="status"
            className="text-sm text-[var(--color-textSecondary)]"
          >
            Open and unlock the owning database to manage redirect destinations.
          </p>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        aria-busy={mgr.loading || mgr.busy}
      >
        {mgr.loading ? (
          <p role="status" className="p-6 text-sm">
            Loading saved redirect destinations…
          </p>
        ) : !visible.length ? (
          <p className="p-6 text-sm text-[var(--color-textSecondary)]">
            {rows.length
              ? "No destinations match these filters."
              : "No trusted redirect destinations in this database."}
          </p>
        ) : (
          <table className="w-full min-w-[42rem] text-left text-xs">
            <caption className="sr-only">
              Saved-connection redirect destinations
            </caption>
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr>
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    aria-label="Select destinations on this page"
                    disabled={disabled}
                    checked={
                      pageRows.length > 0 &&
                      pageRows.every((row) => selected.has(row.id))
                    }
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((previous) => {
                        const next = new Set(previous);
                        pageRows.forEach((row) =>
                          checked ? next.add(row.id) : next.delete(row.id),
                        );
                        return next;
                      });
                    }}
                  />
                </th>
                <th className="p-3">Saved connection</th>
                <th className="p-3">Source address</th>
                <th className="p-3">Trusted destination</th>
                <th className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="w-10 p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.connectionName}: ${row.origin}`}
                      checked={selected.has(row.id)}
                      disabled={disabled}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="p-3">{row.connectionName}</td>
                  <td className="break-all p-3 font-mono">
                    {row.sourceOrigin}
                  </td>
                  <td className="break-all p-3 font-mono">{row.origin}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="sor-icon-btn"
                      aria-label={`Forget ${row.connectionName}: ${row.origin}`}
                      disabled={disabled}
                      onClick={() =>
                        setReview({
                          kind: "forget",
                          scopeKey: mgr.scopeKey,
                          rows: [row],
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--color-border)] p-3 text-xs">
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          Page {currentPage + 1} of {pages}
        </span>
        <button
          type="button"
          className="sor-btn-secondary-sm"
          disabled={currentPage + 1 >= pages}
          onClick={() => setPage(currentPage + 1)}
        >
          Next
        </button>
      </footer>
      <Modal
        isOpen={!!reviewed}
        onClose={() => setReview(null)}
        panelClassName="max-w-xl"
        dataTestId="redirect-destination-review"
      >
        <ModalHeader
          title={
            reviewed?.kind === "add"
              ? "Trust this redirect destination?"
              : "Forget redirect destinations?"
          }
          onClose={() => setReview(null)}
        />
        <ModalBody>
          <p className="mb-3 text-sm">
            {reviewed?.kind === "add"
              ? "Future redirects to this exact address can skip destination review when this connection's redirect policy permits them. Certificate checks and login approvals are unchanged."
              : "Remove these exact saved preferences. Future redirects may ask for destination review again; existing sessions are not disconnected."}
          </p>
          <ul className="max-h-52 space-y-2 overflow-auto text-xs">
            {(reviewed?.kind === "add"
              ? [
                  {
                    connectionName: reviewed.connectionName,
                    sourceOrigin: reviewed.sourceOrigin,
                    origin: reviewed.origin,
                  },
                ]
              : (reviewed?.rows ?? [])
            ).map((row, index) => (
              <li
                key={index}
                className="space-y-1 rounded border border-[var(--color-border)] p-3"
              >
                <p>{row.connectionName}</p>
                <p className="break-all font-mono">From: {row.sourceOrigin}</p>
                <p className="break-all font-mono">To: {row.origin}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sor-btn-primary-sm"
              disabled={disabled}
              onClick={() => void confirm()}
            >
              {reviewed?.kind === "add"
                ? "Trust destination"
                : "Forget destinations"}
            </button>
          </div>
        </ModalBody>
      </Modal>
    </section>
  );
}
