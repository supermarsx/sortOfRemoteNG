import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Fingerprint,
  RefreshCw,
  Download,
  Upload,
  Ban,
  RotateCcw,
  Trash2,
  Eye,
  Search,
  X,
  Settings,
} from "lucide-react";
import {
  useTrustCenter,
  type TrustCenterRow,
  type TrustCenterAction,
} from "../../hooks/security/useTrustCenter";
import ConfirmDialog from "../ui/dialogs/ConfirmDialog";
import { TrustIdentityImportDialog } from "./TrustIdentityImportDialog";
import TrustIdentityInspector from "./TrustIdentityInspector";
import { useConnections } from "../../contexts/useConnections";
import type { TrustPolicy } from "../../utils/auth/trustStore";

const button =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed";
const field =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-primary";
const actionLabels: Record<TrustCenterAction, string> = {
  revoke: "Revoke",
  reinstate: "Reinstate",
  forget: "Forget",
  policy: "Change policy",
  tags: "Replace tags",
};
const actionHints: Record<TrustCenterAction, string> = {
  revoke:
    "Block these exact stored identities after review; existing sessions are not disconnected",
  reinstate:
    "Remove the revocation block after review; other trust checks still apply",
  forget:
    "Remove remembered identities after review; first-use policy applies to a future connection",
  policy: "Review how future connections verify this identity",
  tags: "Review replacing all existing tags; fingerprints and trust are unchanged",
};

export default function TrustCenterTab({
  onClose,
  showClose = true,
  onOpenTrustSettings,
}: {
  onClose: () => void;
  showClose?: boolean;
  onOpenTrustSettings?: () => void;
}) {
  const { state } = useConnections();
  const connectionNames = useMemo(
    () =>
      new Map(
        state.connections.map((connection) => [connection.id, connection.name]),
      ),
    [state.connections],
  );
  const lookupConnection = useCallback(
    (id: string) => connectionNames.get(id) ?? id,
    [connectionNames],
  );
  const mgr = useTrustCenter(lookupConnection);
  const [detailSelection, setDetail] = useState<
    (TrustCenterRow & { databaseId: string | null }) | null
  >(null);
  const detail =
    detailSelection?.databaseId === mgr.databaseId ? detailSelection : null;
  const [nickname, setNickname] = useState("");
  const [policy, setPolicy] = useState<TrustPolicy | "inherit">("inherit");
  const [tags, setTags] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    // A click may already belong to the newly hydrated scope when this passive
    // effect runs. Only discard an inspector captured for a different scope.
    setDetail((previous) =>
      previous?.databaseId === mgr.databaseId ? previous : null,
    );
  }, [mgr.databaseId]);
  useEffect(
    () => setPage(0),
    [
      mgr.databaseId,
      mgr.query,
      mgr.type,
      mgr.status,
      mgr.sort,
      mgr.scopeFilter,
    ],
  );
  const pageCount = Math.max(1, Math.ceil(mgr.visible.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = mgr.visible.slice(
    currentPage * 100,
    currentPage * 100 + 100,
  );
  const selected = mgr.rows.filter((row) => mgr.selected.has(row.id));
  const visibleSelected = pageRows.filter((row) => mgr.selected.has(row.id));
  const disabled = mgr.loading || mgr.busy || !mgr.databaseName;
  const connectionName = (row: TrustCenterRow) =>
    row.connectionId ? lookupConnection(row.connectionId) : "Database-wide";
  const review = mgr.review;
  const request = (action: TrustCenterAction, rows: TrustCenterRow[]) =>
    mgr.requestAction(action, rows);
  const confirmation =
    review && review.action !== "import"
      ? `${review.rows.length} identities in ${review.databaseName}. ${review.action === "tags" ? `Replace all existing tags with: ${review.tags?.filter((tag) => tag.trim()).join(", ") || "no tags (clear tags)"}. This does not change trust or fingerprints.` : review.action === "policy" ? `Set per-host policy to ${review.policy ?? "inherit global"}. This changes future verification; always-trust bypasses identity checks. Existing fingerprints are not replaced.` : review.action === "forget" ? "Forgetting removes remembered identity and revocation history. A future connection may prompt again; this does not block the host." : review.action === "reinstate" ? "Reinstating removes the revocation block on these exact stored fingerprints; other trust and expiry checks remain." : "Revocation blocks these stored identities. It does not terminate existing connections."} The entire record batch is validated before one write; any changed target rejects the batch.`
      : "";
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label="Trust Center"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Fingerprint className="h-5 w-5 text-primary" aria-hidden="true" />
            Trust Center
          </h2>
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            {mgr.databaseName
              ? `Trusted identities in ${mgr.databaseName}`
              : "Open a database to manage its trusted identities."}
          </p>
          <p className="mt-1 max-w-3xl text-xs text-[var(--color-textMuted)]">
            Certificates and SSH host identities—not passwords, private keys, or
            the credential vault. Trust is database-scoped. Global verification
            policies remain in Settings → Trust Center.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenTrustSettings && (
            <button
              type="button"
              className={button}
              onClick={onOpenTrustSettings}
              data-tooltip="Open global Trust Verification settings"
            >
              <Settings size={14} aria-hidden="true" />
              Trust settings
            </button>
          )}
          {showClose && (
            <button
              type="button"
              className={button}
              onClick={onClose}
              aria-label="Close Trust Center"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <div className="space-y-3 border-b border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--color-textMuted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search trusted identities"
              placeholder="Search host, fingerprint, certificate, or connection"
              className={`${field} w-full !pl-8`}
              value={mgr.query}
              onChange={(event) => mgr.setQuery(event.target.value)}
            />
          </div>
          <select
            aria-label="Identity type"
            className={field}
            value={mgr.type}
            onChange={(event) => mgr.setType(event.target.value)}
          >
            <option value="all">All identity types</option>
            {["https", "certificate", "rdp", "ssh", "tls"].map((type) => (
              <option key={type} value={type}>
                {type.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            aria-label="Identity status"
            className={field}
            value={mgr.status}
            onChange={(event) => mgr.setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Not revoked</option>
            <option value="revoked">Revoked</option>
          </select>
          <select
            aria-label="Identity scope"
            className={field}
            value={mgr.scopeFilter}
            onChange={(event) => mgr.setScopeFilter(event.target.value)}
          >
            <option value="all">All scopes</option>
            <option value="database">Database-wide</option>
            <option value="connection">Connection-specific</option>
          </select>
          <select
            aria-label="Sort identities"
            className={field}
            value={mgr.sort}
            onChange={(event) => mgr.setSort(event.target.value)}
          >
            <option value="host">Host A–Z</option>
            <option value="type">Type, then host</option>
            <option value="recent">Recently seen</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={button}
            disabled={mgr.loading || mgr.busy}
            onClick={() => void mgr.refresh()}
            data-tooltip="Reload current records and verification counts from the native Trust Center"
          >
            <RefreshCw
              size={14}
              className={
                mgr.loading ? "animate-spin motion-reduce:animate-none" : ""
              }
              aria-hidden="true"
            />
            {mgr.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void mgr.importFile()}
            data-tooltip="Preview a trust export and review its identities before merging"
          >
            <Upload size={14} aria-hidden="true" />
            Import identities
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void mgr.importKnownHosts()}
            data-tooltip="Preview supported identities from the default SSH known_hosts file; no automatic import"
          >
            Review default known_hosts
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void mgr.importKnownHosts(true)}
            data-tooltip="Choose an SSH known_hosts file and review supported identities before merging"
          >
            Choose known_hosts file
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled || !mgr.rows.length}
            onClick={() => void mgr.exportRows()}
            data-tooltip="Export all stored public identities in this database, including filtered-out rows"
          >
            <Download size={14} aria-hidden="true" />
            Export all
          </button>
          <span className="text-xs text-[var(--color-textMuted)]">
            {mgr.visible.length} visible / {mgr.rows.length} identities ·{" "}
            {selected.length} selected
          </span>
          <button
            type="button"
            className={button}
            disabled={disabled || !mgr.visible.length}
            data-tooltip="Add every filtered identity across all pages to the selection"
            onClick={() =>
              mgr.setSelected(
                (previous) =>
                  new Set([...previous, ...mgr.visible.map((row) => row.id)]),
              )
            }
          >
            Select all filtered
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled || !pageRows.length}
            data-tooltip="Add only the identities on the current page to the selection"
            onClick={() =>
              mgr.setSelected(
                (previous) =>
                  new Set([...previous, ...pageRows.map((row) => row.id)]),
              )
            }
          >
            Select page
          </button>
          <button
            type="button"
            className={button}
            disabled={mgr.busy || !selected.length}
            onClick={() => mgr.setSelected(new Set())}
            data-tooltip="Clear selected identities on every page without changing records"
          >
            Clear selection
          </button>
        </div>
        <div
          role="group"
          aria-label="Selected identity actions"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-medium">
            Selected (including hidden):
          </span>
          <button
            type="button"
            className={button}
            disabled={disabled || !selected.length}
            onClick={() => void mgr.exportRows(selected)}
            data-tooltip="Export the selected public identities, including selected rows hidden by filters"
          >
            Export selected
          </button>
          {(["revoke", "reinstate", "forget"] as const).map((action) => (
            <button
              key={action}
              type="button"
              className={button}
              disabled={disabled || !selected.length}
              onClick={() => request(action, selected)}
              data-tooltip={actionHints[action]}
            >
              {actionLabels[action]} selected
            </button>
          ))}
          <input
            aria-label="Tags for selected identities"
            className={field}
            placeholder="Tags, comma separated"
            data-tooltip="Tags replace existing labels after review; they do not change certificate trust"
            value={bulkTags}
            onChange={(event) => setBulkTags(event.target.value)}
          />
          <button
            type="button"
            className={button}
            disabled={disabled || !selected.length}
            onClick={() =>
              mgr.requestAction(
                "tags",
                selected,
                undefined,
                bulkTags.split(","),
              )
            }
          >
            Replace selected tags
          </button>
        </div>
        {mgr.summary && (
          <p
            className="text-xs text-[var(--color-textMuted)]"
            aria-label="Native trust summary"
          >
            Native summary: {mgr.summary.total_records} records ·{" "}
            {mgr.summary.revoked_count} revoked · {mgr.summary.expired_count}{" "}
            expired · {mgr.summary.total_verifications} verifications ·{" "}
            {mgr.summary.total_mismatches} mismatches · average score{" "}
            {mgr.summary.average_trust_score}/100
          </p>
        )}
        {mgr.error && (
          <p role="alert" className="text-xs text-error">
            {mgr.error}
          </p>
        )}
        {mgr.message && (
          <p role="status" className="text-xs text-success">
            {mgr.message}
          </p>
        )}
        {mgr.busy && (
          <p role="status" className="text-xs">
            Validating the reviewed database and identities. A record batch is
            applied as one write after every target passes validation.
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!mgr.loading && !mgr.visible.length ? (
          <p className="p-6 text-sm text-[var(--color-textMuted)]">
            {mgr.rows.length
              ? "No identities match these filters."
              : "No stored identities to manage. Accepted connection identities appear here; you can also review and import a trust export."}
          </p>
        ) : (
          <table className="w-full min-w-[48rem] text-left text-xs">
            <caption className="sr-only">
              Stored trusted certificates and host identities
            </caption>
            <thead className="sticky top-0 bg-[var(--color-surface)]">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    aria-label="Select identities on this page"
                    disabled={disabled || !pageRows.length}
                    checked={
                      pageRows.length > 0 &&
                      visibleSelected.length === pageRows.length
                    }
                    ref={(input) => {
                      if (input)
                        input.indeterminate =
                          visibleSelected.length > 0 &&
                          visibleSelected.length < pageRows.length;
                    }}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      mgr.setSelected((previous) => {
                        const next = new Set(previous);
                        pageRows.forEach((row) =>
                          checked ? next.add(row.id) : next.delete(row.id),
                        );
                        return next;
                      });
                    }}
                  />
                </th>
                {[
                  "Identity",
                  "Type / status",
                  "Scope",
                  "Fingerprint",
                  "Last seen",
                  "Actions",
                ].map((label) => (
                  <th key={label} className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.record.type} ${row.record.host} ${connectionName(row)}`}
                      disabled={disabled}
                      checked={mgr.selected.has(row.id)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        mgr.setSelected((previous) => {
                          const next = new Set(previous);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="p-3">
                    <span className="font-medium">
                      {row.record.nickname || row.record.host}
                    </span>
                    {row.record.nickname && (
                      <span className="block text-[var(--color-textMuted)]">
                        {row.record.host}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {row.record.type.toUpperCase()}
                    <span
                      className={`block ${row.record.revoked ? "text-error" : "text-[var(--color-textMuted)]"}`}
                    >
                      {row.record.revoked ? "Revoked" : "Not revoked"}
                    </span>
                    {row.record.trustExpires && (
                      <span className="block">
                        Trust expires: {row.record.trustExpires}
                      </span>
                    )}
                  </td>
                  <td className="max-w-48 break-words p-3">
                    {connectionName(row)}
                  </td>
                  <td className="max-w-64 break-all p-3 font-mono">
                    {row.record.identity.fingerprint}
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {row.record.identity.lastSeen || "Unknown"}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={button}
                        aria-label={`Inspect ${row.record.host}`}
                        disabled={disabled}
                        data-tooltip="Inspect identity and certificate details"
                        onClick={() => {
                          setDetail({ ...row, databaseId: mgr.databaseId });
                          setNickname(row.record.nickname ?? "");
                          setPolicy(row.record.hostPolicy ?? "inherit");
                          setTags(row.record.tags?.join(", ") ?? "");
                          void mgr.inspect(row);
                        }}
                      >
                        <Eye size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={button}
                        disabled={disabled}
                        aria-label={`${row.record.revoked ? "Reinstate" : "Revoke"} ${row.record.host}`}
                        data-tooltip={
                          actionHints[
                            row.record.revoked ? "reinstate" : "revoke"
                          ]
                        }
                        onClick={() =>
                          request(row.record.revoked ? "reinstate" : "revoke", [
                            row,
                          ])
                        }
                      >
                        {row.record.revoked ? (
                          <RotateCcw size={14} aria-hidden="true" />
                        ) : (
                          <Ban size={14} aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={button}
                        disabled={disabled}
                        aria-label={`Forget ${row.record.host}`}
                        data-tooltip={actionHints.forget}
                        onClick={() => request("forget", [row])}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <nav
        aria-label="Trust identity pages"
        className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2 text-xs"
      >
        <span>
          Page {currentPage + 1} of {pageCount} · up to 100 identities per page
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className={button}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous page
          </button>
          <button
            type="button"
            className={button}
            disabled={currentPage + 1 >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next page
          </button>
        </div>
      </nav>
      {detail && (
        <TrustIdentityInspector
          key={detail.id}
          row={detail}
          databaseName={mgr.databaseName ?? "Current database"}
          connectionName={connectionName(detail)}
          inspection={mgr.inspection}
          loading={mgr.busy}
          error={mgr.error}
          onClose={() => setDetail(null)}
        >
          <label className="block text-xs">
            Label
            <input
              className={`${field} mt-1 w-full`}
              value={nickname}
              maxLength={128}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={disabled}
            onClick={() => detail && void mgr.rename(detail, nickname)}
            data-tooltip="Save a display label without changing the accepted fingerprint"
          >
            Save label
          </button>
          <label className="mt-4 block text-xs">
            Per-host verification policy
            <select
              aria-label="Per-host verification policy"
              className={`${field} ml-2`}
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as TrustPolicy | "inherit")
              }
            >
              <option value="inherit">Inherit global policy</option>
              {(["tofu", "always-ask", "always-trust", "strict"] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {value.replace(/-/g, " ")}
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            An override changes future identity verification. Always trust
            bypasses identity checks; it is never selected automatically.
          </p>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={disabled}
            onClick={() => {
              if (detail)
                mgr.requestAction(
                  "policy",
                  [detail],
                  policy === "inherit" ? undefined : policy,
                );
              setDetail(null);
            }}
          >
            Review policy change
          </button>
          <label className="mt-4 block text-xs">
            Tags
            <input
              aria-label="Identity tags"
              className={`${field} mt-1 w-full`}
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Comma separated"
            />
          </label>
          <button
            type="button"
            className={`${button} mt-2`}
            disabled={disabled}
            onClick={() => {
              if (detail)
                mgr.requestAction("tags", [detail], undefined, tags.split(","));
              setDetail(null);
            }}
          >
            Review tag replacement
          </button>
        </TrustIdentityInspector>
      )}
      <ConfirmDialog
        isOpen={!!review && review.action !== "import"}
        title={
          review?.action === "import"
            ? "Import reviewed trust identities?"
            : `${review ? actionLabels[review.action] : "Change"} trusted identities?`
        }
        confirmText={
          review?.action === "import"
            ? "Merge reviewed identities"
            : review
              ? actionLabels[review.action]
              : "Confirm"
        }
        variant="warning"
        confirmOnEnter={false}
        onCancel={mgr.dismissReview}
        onConfirm={() => void mgr.apply()}
        message={confirmation}
      />
      <TrustIdentityImportDialog
        connectionName={lookupConnection}
        review={review?.action === "import" ? review : null}
        busy={mgr.busy}
        onClose={mgr.dismissReview}
        onConfirm={() => void mgr.apply()}
      />
    </section>
  );
}
