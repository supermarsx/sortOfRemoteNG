import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, AlertTriangle } from "lucide-react";
import type { TrustCenterRow } from "../../hooks/security/useTrustCenter";
import type { Connection } from "../../types/connection/connection";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";
import { Select } from "../ui/forms/Select";

export interface TrustScopeReview {
  databaseId: string;
  databaseName: string;
  rows: TrustCenterRow[];
}
const button =
  "inline-flex w-fit items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40";
export function TrustIdentityScopeDialog({
  review,
  connections,
  busy,
  onClose,
  onConfirm,
}: {
  review: TrustScopeReview | null;
  connections: Connection[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (connectionId: string | null) => void;
}) {
  const [destination, setDestination] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setDestination("");
    setAcknowledged(false);
    setPage(0);
  }, [review]);
  const savedConnections = useMemo(
    () => connections.filter((connection) => !connection.isGroup),
    [connections],
  );
  const connectionNames = useMemo(
    () =>
      new Map(
        connections.map((connection) => [connection.id, connection.name]),
      ),
    [connections],
  );
  const options = useMemo(
    () => [
      {
        value: "database",
        label: "Database-wide — all matching connections in this database",
      },
      ...savedConnections.map((connection) => ({
        value: `connection:${connection.id}`,
        label: `${connection.name} — ${connection.protocol.toUpperCase()} · ${connection.hostname}${connection.port ? `:${connection.port}` : ""} · ${connection.id}`,
      })),
    ],
    [savedConnections],
  );
  const targetId =
    destination === "database"
      ? null
      : destination.startsWith("connection:")
        ? destination.slice(11)
        : undefined;
  const hasDecisions =
    !!review?.rows.length &&
    review.rows.every((row) => !!row.record.scopeDecision);
  const validTarget =
    hasDecisions &&
    (targetId === null ||
      (targetId !== undefined &&
        savedConnections.some((connection) => connection.id === targetId)));
  const broadening =
    targetId === null
      ? (review?.rows.filter((row) => row.connectionId).length ?? 0)
      : 0;
  const pageCount = Math.max(1, Math.ceil((review?.rows.length ?? 0) / 100));
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <Modal
      isOpen={!!review}
      ariaLabel="Review identity scope change"
      onClose={busy ? undefined : onClose}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      panelClassName="max-w-4xl !max-h-[calc(100dvh-5rem)]"
    >
      <ModalHeader
        title="Review identity scope change"
        onClose={busy ? undefined : onClose}
        className="shrink-0"
      />
      {review && (
        <>
          <ModalBody className="space-y-4 px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm">
              <p className="font-semibold">
                {review.rows.length.toLocaleString()} identities ·{" "}
                {review.databaseName}
              </p>
              <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                Change only where these existing decisions apply within this
                database. Nothing moves to another database and no connection is
                opened.
              </p>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="trust-scope-destination"
                className="block text-xs font-medium"
              >
                New identity scope
              </label>
              <Select
                id="trust-scope-destination"
                label="New identity scope"
                value={destination}
                onChange={(value) => {
                  setDestination(value);
                  setAcknowledged(false);
                }}
                options={options}
                placeholder="Choose a scope to review…"
                searchable
                searchPlaceholder="Search saved connection name, host, protocol or ID"
                disabled={busy}
                variant="form"
                className="w-full"
              />
              <p className="text-xs text-[var(--color-textMuted)]">
                A connection-specific decision applies only when that saved
                connection verifies the same stored endpoint and identity type.
                Choosing a different host does not rebind this certificate or
                SSH key to that host. The destination connection must already be
                saved in this database.
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle size={15} aria-hidden="true" />
                Review the trust boundary
              </p>
              {broadening > 0 && (
                <p className="font-medium text-warning">
                  This broadens {broadening} connection-specific decisions to
                  database-wide scope. Other matching connections may inherit
                  them unless a specific decision or Forget marker blocks
                  inheritance.
                </p>
              )}
              <p>
                Stored endpoints, fingerprints, identity types, approval flags,
                revocation, expiry, history and policies are unchanged. This
                does not approve or reinstate an identity. Existing destination
                records are never overwritten. Conflicting targets or changed
                fingerprints, approval, revocation, expiry, policy or policy
                constraints reject the entire batch.
              </p>
              {!hasDecisions && (
                <p role="alert">
                  Native reviewed security metadata is unavailable. Refresh the
                  Trust Center before changing scope.
                </p>
              )}
              <p>
                No password or OS-vault unlock is attempted automatically. If
                the current database lease has expired, reauthenticate first and
                review again.
              </p>
            </div>
            <div
              className="overflow-x-auto rounded-lg border border-[var(--color-border)]"
              tabIndex={0}
              role="region"
              aria-label="Reviewed identity scopes"
            >
              <table className="w-full min-w-[34rem] table-fixed text-left text-xs">
                <thead className="bg-[var(--color-background)]">
                  <tr>
                    {[
                      "Stored endpoint / type",
                      "Current scope",
                      "Reviewed fingerprint",
                    ].map((title) => (
                      <th key={title} scope="col" className="p-3 font-medium">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {review.rows
                    .slice(currentPage * 100, currentPage * 100 + 100)
                    .map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-[var(--color-border)] align-top"
                      >
                        <td className="break-words p-3 [overflow-wrap:anywhere]">
                          {row.record.host}
                          <span className="mt-1 block text-[var(--color-textMuted)]">
                            {row.record.type.toUpperCase()} ·{" "}
                            {row.record.revoked
                              ? "Revoked (retained)"
                              : row.record.userApproved
                                ? "Approved (retained)"
                                : "Not user-approved (retained)"}
                          </span>
                        </td>
                        <td className="break-words p-3 [overflow-wrap:anywhere]">
                          {row.connectionId ? (
                            <>
                              {connectionNames.get(row.connectionId) ??
                                "Saved connection"}
                              <span className="mt-1 block text-[var(--color-textMuted)]">
                                {row.connectionId}
                              </span>
                            </>
                          ) : (
                            "Database-wide"
                          )}
                        </td>
                        <td className="break-all p-3 font-mono">
                          {row.record.identity.fingerprint}
                          <p className="mt-2 font-sans">
                            Policy:{" "}
                            {row.record.scopeDecision?.hostPolicy ??
                              "inherit global"}
                          </p>
                          <p className="mt-1 font-sans">
                            Expiry:{" "}
                            {row.record.scopeDecision?.trustExpires ??
                              "No record expiry"}
                          </p>
                          {row.record.scopeDecision?.hostPolicyConfig && (
                            <details className="mt-1 font-sans">
                              <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                Policy constraints (preserved)
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-all text-[11px]">
                                {JSON.stringify(
                                  row.record.scopeDecision.hostPolicyConfig,
                                  null,
                                  2,
                                )}
                              </pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <nav
              aria-label="Scope review pages"
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span>
                Page {currentPage + 1} of {pageCount} · all {review.rows.length}{" "}
                identities are included
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous review page
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy || currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next review page
                </button>
              </div>
            </nav>
          </ModalBody>
          <ModalFooter className="shrink-0 flex-col items-stretch bg-[var(--color-surface)]">
            <label className="flex items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                disabled={busy || !validTarget}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I reviewed these identities and their new scope in{" "}
              {review.databaseName}, including any broader trust inheritance.
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${button} border-primary/50 text-primary`}
                disabled={busy || !validTarget || !acknowledged}
                onClick={() => {
                  if (validTarget && targetId !== undefined)
                    onConfirm(targetId);
                }}
              >
                <ArrowRightLeft size={14} aria-hidden="true" />
                Apply reviewed scope
              </button>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
