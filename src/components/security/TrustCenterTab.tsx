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
} from "lucide-react";
import {
  useTrustCenter,
  type TrustCenterRow,
  type TrustCenterAction,
} from "../../hooks/security/useTrustCenter";
import ConfirmDialog from "../ui/dialogs/ConfirmDialog";
import { Modal, ModalBody, ModalHeader } from "../ui/overlays/Modal";
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

export default function TrustCenterTab({
  onClose,
  showClose = true,
}: {
  onClose: () => void;
  showClose?: boolean;
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
  const [detail, setDetail] = useState<TrustCenterRow | null>(null);
  const [nickname, setNickname] = useState("");
  const [policy, setPolicy] = useState<TrustPolicy | "inherit">("inherit");
  const [tags, setTags] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [importReviewed, setImportReviewed] = useState(false);
  const [page, setPage] = useState(0);
  const [importPage, setImportPage] = useState(0);
  useEffect(() => {
    setDetail(null);
    setNickname("");
  }, [mgr.databaseId]);
  useEffect(() => {
    setImportReviewed(false);
    setImportPage(0);
  }, [mgr.review]);
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
  const importPageCount =
    review?.action === "import"
      ? Math.max(1, Math.ceil(review.document.records.length / 100))
      : 1;
  const existingImportRecords = useMemo(
    () =>
      new Map(
        mgr.review?.action === "import"
          ? mgr.review.expectedRecords.map((record) => [
              `${record.record_type}:${record.host}`,
              record,
            ])
          : [],
      ),
    [mgr.review],
  );
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
          >
            <Upload size={14} aria-hidden="true" />
            Import identities
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void mgr.importKnownHosts()}
          >
            Review default known_hosts
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled}
            onClick={() => void mgr.importKnownHosts(true)}
          >
            Choose known_hosts file
          </button>
          <button
            type="button"
            className={button}
            disabled={disabled || !mgr.rows.length}
            onClick={() => void mgr.exportRows()}
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
            >
              {actionLabels[action]} selected
            </button>
          ))}
          <input
            aria-label="Tags for selected identities"
            className={field}
            placeholder="Tags, comma separated"
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
                          setDetail(row);
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
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        panelClassName="max-w-2xl"
        dataTestId="trust-identity-details"
      >
        <ModalHeader
          title={`Identity — ${detail?.record.host ?? ""}`}
          onClose={() => setDetail(null)}
        />
        <ModalBody>
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
          <p className="my-3 text-xs">
            Public identity details and recorded history. Editing a label does
            not change the accepted fingerprint.
          </p>
          {detail && (
            <dl className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,3fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-[var(--color-textMuted)]">Fingerprint</dt>
              <dd className="break-all font-mono">
                {detail.record.identity.fingerprint}
              </dd>
              <dt className="text-[var(--color-textMuted)]">Trust status</dt>
              <dd>
                {detail.record.revoked ? "Revoked / blocked" : "Not revoked"};{" "}
                {detail.record.userApproved
                  ? "user approved"
                  : "not user approved"}
              </dd>
              <dt className="text-[var(--color-textMuted)]">Trust expiry</dt>
              <dd>
                {detail.record.trustExpires ?? "No explicit trust expiry"}
              </dd>
              {Object.entries(detail.record.identity)
                .filter(
                  ([key, value]) =>
                    value != null &&
                    [
                      "subject",
                      "issuer",
                      "validFrom",
                      "validTo",
                      "keyType",
                      "keyBits",
                      "keyAlgorithm",
                      "keySize",
                      "signatureAlgorithm",
                      "firstSeen",
                      "lastSeen",
                    ].includes(key),
                )
                .map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-[var(--color-textMuted)]">
                      {key
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, (letter) => letter.toUpperCase())}
                    </dt>
                    <dd className="break-words">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          )}
          {detail && mgr.inspection?.rowId === detail.id && (
            <>
              <h3 className="mb-2 mt-4 text-sm font-medium">
                Verification statistics
              </h3>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(
                  mgr.inspection.stats &&
                    typeof mgr.inspection.stats === "object"
                    ? mgr.inspection.stats
                    : {},
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-[var(--color-textMuted)]">
                      {key.replace(/_/g, " ")}
                    </dt>
                    <dd>{value == null ? "Never" : String(value)}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mb-2 mt-4 text-sm font-medium">
                Recent identity history
              </h3>
              {Array.isArray(mgr.inspection.history) &&
              mgr.inspection.history.length ? (
                <ol className="max-h-48 space-y-2 overflow-auto text-xs">
                  {mgr.inspection.history
                    .slice(-50)
                    .reverse()
                    .map((entry, index) => (
                      <li
                        key={`${index}:${entry.changed_at ?? ""}`}
                        className="rounded border border-[var(--color-border)] p-2"
                      >
                        <span className="font-medium">
                          {String(entry.reason ?? "Identity change").replace(
                            /_/g,
                            " ",
                          )}
                        </span>{" "}
                        · {String(entry.changed_at ?? "Unknown time")}
                        <span className="block break-all font-mono">
                          {String(entry.identity?.fingerprint ?? "")}
                        </span>
                        {entry.note && (
                          <span className="block">{String(entry.note)}</span>
                        )}
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="text-xs text-[var(--color-textMuted)]">
                  No recorded identity changes.
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                Up to 50 latest history entries shown; the complete record is
                available below.
              </p>
            </>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium">
              Advanced raw identity and history
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-background)] p-3 text-xs">
              {detail
                ? JSON.stringify(
                    {
                      identity: detail.record.identity,
                      history:
                        mgr.inspection?.rowId === detail.id
                          ? mgr.inspection.history
                          : (detail.record.history ?? []),
                      statistics:
                        mgr.inspection?.rowId === detail.id
                          ? mgr.inspection.stats
                          : "Loading native statistics…",
                      tags: detail.record.tags ?? [],
                      revoked: !!detail.record.revoked,
                      hostPolicy: detail.record.hostPolicy ?? "inherit",
                      trustExpires: detail.record.trustExpires,
                    },
                    null,
                    2,
                  )
                : ""}
            </pre>
          </details>
        </ModalBody>
      </Modal>
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
      <Modal
        isOpen={review?.action === "import"}
        onClose={mgr.dismissReview}
        panelClassName="max-w-5xl"
        dataTestId="trust-import-review"
      >
        <ModalHeader
          title="Review trust identity import"
          onClose={mgr.dismissReview}
        />
        <ModalBody>
          {review?.action === "import" && (
            <>
              <p className="text-sm font-medium">
                {review.document.records.length} incoming identities →{" "}
                {review.databaseName}
              </p>
              {!!review.skipped && (
                <p className="mt-2 text-xs text-warning">
                  {review.skipped} unsupported or unnamed entries were skipped
                  during preview.
                </p>
              )}
              {review.warnings?.map((warning, index) => (
                <p
                  key={`${index}:${warning}`}
                  role="status"
                  className="mt-1 text-xs text-warning"
                >
                  {warning}
                </p>
              ))}
              <p className="my-2 text-xs text-[var(--color-textMuted)]">
                This imports trust decisions, not credentials or global
                policies. New hosts may become trusted; a more recently seen
                identity may replace an existing fingerprint and its per-host
                policy. Existing revoked records cannot be reinstated by merge.
                Incoming expiry and revocation settings are retained when a
                record is imported. Check the file origin and every identity
                before continuing.
              </p>
              <div className="max-h-80 overflow-auto rounded-md border border-[var(--color-border)]">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">
                    Incoming identity fingerprints and existing conflicts
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "Host / type",
                        "Existing fingerprint",
                        "Incoming fingerprint",
                        "Trust intent",
                      ].map((label) => (
                        <th key={label} className="p-2">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {review.document.records
                      .slice(importPage * 100, importPage * 100 + 100)
                      .map((row) => {
                        const existing = existingImportRecords.get(
                          `${row.record_type}:${row.host}`,
                        );
                        const changed =
                          existing &&
                          existing.identity.fingerprint !==
                            row.identity.fingerprint;
                        return (
                          <tr
                            key={`${row.record_type}:${row.host}`}
                            className="border-t border-[var(--color-border)]"
                          >
                            <td className="max-w-48 break-all p-2">
                              {row.host}
                              <span className="block">{row.record_type}</span>
                              {changed && (
                                <strong className="block text-warning">
                                  Different fingerprint — possible replacement
                                </strong>
                              )}
                            </td>
                            <td className="max-w-56 break-all p-2 font-mono">
                              {String(
                                existing?.identity.fingerprint ??
                                  "New identity",
                              )}
                              {existing?.revoked && (
                                <span className="block font-sans text-error">
                                  Existing revocation preserved
                                </span>
                              )}
                            </td>
                            <td className="max-w-56 break-all p-2 font-mono">
                              {String(row.identity.fingerprint)}
                            </td>
                            <td className="p-2">
                              {row.revoked
                                ? "Revoked / blocked"
                                : row.user_approved
                                  ? "User-approved trust"
                                  : "Stored identity; not user-approved"}
                              <span className="block">
                                Policy: {row.host_policy ?? "inherit global"}
                              </span>
                              <span className="block">
                                Expiry:{" "}
                                {row.trust_expires ??
                                  "No explicit trust expiry"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <nav
                aria-label="Import review pages"
                className="mt-2 flex items-center justify-between gap-2 text-xs"
              >
                <span>
                  Review page {importPage + 1} of {importPageCount} ·
                  confirmation covers all {review.document.records.length}{" "}
                  identities
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={importPage === 0}
                    onClick={() => setImportPage(importPage - 1)}
                  >
                    Previous review page
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={importPage + 1 >= importPageCount}
                    onClick={() => setImportPage(importPage + 1)}
                  >
                    Next review page
                  </button>
                </div>
              </nav>
              <label className="my-3 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={importReviewed}
                  onChange={(event) => setImportReviewed(event.target.checked)}
                />
                I reviewed these fingerprints, replacement conflicts and trust
                decisions for {review.databaseName}.
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={mgr.dismissReview}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={!importReviewed || mgr.busy}
                  onClick={() => void mgr.apply()}
                >
                  Merge reviewed identities
                </button>
              </div>
            </>
          )}
        </ModalBody>
      </Modal>
    </section>
  );
}
