import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, FileCheck2 } from "lucide-react";
import { decodeNativeHost } from "../../utils/auth/trustStore";
import type {
  TrustExportDocument,
  TrustExportRecord,
} from "../../utils/auth/trustStore";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";

export interface TrustIdentityImportReview {
  databaseId: string;
  databaseName: string;
  document: TrustExportDocument;
  expectedRecords: TrustExportRecord[];
  warnings?: string[];
  skipped?: number;
}
const button =
  "inline-flex items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40";

export function TrustIdentityImportDialog({
  review,
  busy,
  onClose,
  onConfirm,
  connectionName,
}: {
  review: TrustIdentityImportReview | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  connectionName?: (id: string) => string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    setAcknowledged(false);
    setPage(0);
  }, [review]);
  const existing = useMemo(
    () =>
      new Map(
        review?.expectedRecords.map((row) => [
          `${row.record_type}:${row.host}`,
          row,
        ]) ?? [],
      ),
    [review],
  );
  const changes = useMemo(() => {
    let replacements = 0;
    let newRecords = 0;
    for (const row of review?.document.records ?? []) {
      const previous = existing.get(`${row.record_type}:${row.host}`);
      if (!previous) newRecords++;
      else if (previous.identity.fingerprint !== row.identity.fingerprint)
        replacements++;
    }
    return { replacements, newRecords };
  }, [review, existing]);
  const endpoints = useMemo(
    () =>
      new Map(
        review?.document.records.map((row) => [
          row.host,
          decodeNativeHost(row.host),
        ]) ?? [],
      ),
    [review],
  );
  const scopes = useMemo(() => {
    let database = 0;
    let connection = 0;
    let unknown = 0;
    for (const row of review?.document.records ?? []) {
      const endpoint = endpoints.get(row.host);
      if (!endpoint) unknown++;
      else if (endpoint.connectionId) connection++;
      else database++;
    }
    return { database, connection, unknown };
  }, [review, endpoints]);
  const pageCount = Math.max(
    1,
    Math.ceil((review?.document.records.length ?? 0) / 100),
  );
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <Modal
      isOpen={!!review}
      onClose={busy ? undefined : onClose}
      closeOnEscape={!busy}
      closeOnBackdrop={false}
      ariaLabel="Review trust identity import"
      panelClassName="max-w-5xl !max-h-[calc(100dvh-5rem)]"
      contentClassName="min-w-0"
      dataTestId="trust-import-review"
    >
      <ModalHeader
        title="Review trust identity import"
        onClose={busy ? undefined : onClose}
        className="shrink-0"
      />
      {review && (
        <>
          <ModalBody className="space-y-4 px-4 py-4 sm:px-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                <p className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
                  <Database size={14} aria-hidden="true" />
                  Destination database
                </p>
                <p className="mt-1 break-words text-sm font-semibold">
                  {review.databaseName}
                </p>
                <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                  Imported scopes are preserved within this database. No
                  connection is opened or moved.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                <p className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
                  <FileCheck2 size={14} aria-hidden="true" />
                  Incoming trust decisions
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {review.document.records.length.toLocaleString()} identities
                </p>
                <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                  {changes.newRecords.toLocaleString()} new ·{" "}
                  {changes.replacements.toLocaleString()} different fingerprints
                  to review
                </p>
                <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                  {scopes.database.toLocaleString()} database-wide ·{" "}
                  {scopes.connection.toLocaleString()} connection-scoped
                  {!!scopes.unknown &&
                    ` · ${scopes.unknown.toLocaleString()} unrecognized`}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed">
              <p className="mb-1 flex items-center gap-2 font-medium">
                <AlertTriangle size={14} aria-hidden="true" />
                Importing changes future trust decisions
              </p>
              {!!scopes.unknown && (
                <p role="alert" className="mt-2 text-error">
                  Some scopes or endpoints could not be recognized. Import is
                  unavailable; correct the source file and preview it again.
                </p>
              )}
              <p>
                This imports trust decisions, not credentials or global
                policies. New hosts may become trusted; a more recently seen
                identity may replace an existing fingerprint and its per-host
                policy. Existing revoked records cannot be reinstated by merge.
                Incoming expiry and revocation settings are retained when a
                record is imported. Check the file origin and every identity
                before continuing.
              </p>
              {!!review.skipped && (
                <p className="mt-2 text-warning">
                  {review.skipped} unsupported or unnamed entries were skipped
                  during preview.
                </p>
              )}
              {review.warnings?.map((warning, index) => (
                <p
                  role="status"
                  key={`${index}:${warning}`}
                  className="mt-2 break-words text-warning [overflow-wrap:anywhere]"
                >
                  {warning}
                </p>
              ))}
            </div>
            <div
              className="overflow-x-auto rounded-lg border border-[var(--color-border)]"
              tabIndex={0}
              role="region"
              aria-label="Incoming trust identity comparison"
            >
              <table className="w-full min-w-[42rem] table-fixed text-left text-xs">
                <caption className="sr-only">
                  Incoming identity fingerprints and existing conflicts
                </caption>
                <thead className="bg-[var(--color-background)] text-[var(--color-textMuted)]">
                  <tr>
                    {[
                      "Host / type",
                      "Existing fingerprint",
                      "Incoming fingerprint",
                      "Trust intent",
                    ].map((label) => (
                      <th
                        scope="col"
                        key={label}
                        className="px-3 py-2.5 font-medium"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {review.document.records
                    .slice(currentPage * 100, currentPage * 100 + 100)
                    .map((row) => {
                      const endpoint = endpoints.get(row.host);
                      const scopeName = endpoint?.connectionId
                        ? (connectionName?.(endpoint.connectionId) ??
                          endpoint.connectionId)
                        : undefined;
                      const previous = existing.get(
                        `${row.record_type}:${row.host}`,
                      );
                      const changed =
                        previous &&
                        previous.identity.fingerprint !==
                          row.identity.fingerprint;
                      return (
                        <tr
                          key={`${row.record_type}:${row.host}`}
                          className="border-t border-[var(--color-border)] align-top"
                        >
                          <td className="break-words px-3 py-3 [overflow-wrap:anywhere]">
                            <span className="font-medium">
                              {endpoint
                                ? `${endpoint.host.includes(":") ? `[${endpoint.host}]` : endpoint.host}:${endpoint.port}`
                                : row.host}
                            </span>
                            <span className="mt-1 block text-[var(--color-textMuted)]">
                              {row.record_type} ·{" "}
                              {!endpoint
                                ? "Unrecognized scope / endpoint"
                                : endpoint.connectionId
                                  ? `Connection: ${scopeName}`
                                  : "Database-wide"}
                            </span>
                            {endpoint?.connectionId && (
                              <span className="mt-1 block text-[var(--color-textMuted)]">
                                Connection ID: {endpoint.connectionId}
                              </span>
                            )}
                            {changed && (
                              <strong className="mt-2 block text-warning">
                                Different fingerprint — possible replacement
                              </strong>
                            )}
                          </td>
                          <td className="break-all px-3 py-3 font-mono">
                            {String(
                              previous?.identity.fingerprint ?? "New identity",
                            )}
                            {previous?.revoked && (
                              <span className="mt-2 block font-sans text-error">
                                Existing revocation preserved
                              </span>
                            )}
                          </td>
                          <td className="break-all px-3 py-3 font-mono">
                            {String(row.identity.fingerprint)}
                          </td>
                          <td className="break-words px-3 py-3 [overflow-wrap:anywhere]">
                            <span
                              className={
                                row.revoked
                                  ? "font-medium text-error"
                                  : "font-medium"
                              }
                            >
                              {row.revoked
                                ? "Revoked / blocked"
                                : row.user_approved
                                  ? "User-approved trust"
                                  : "Stored identity; not user-approved"}
                            </span>
                            <span className="mt-2 block">
                              Policy: {row.host_policy ?? "inherit global"}
                            </span>
                            <span className="mt-1 block">
                              Expiry:{" "}
                              {row.trust_expires ?? "No explicit trust expiry"}
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
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span>
                Review page {currentPage + 1} of {pageCount} · confirmation
                covers all {review.document.records.length} identities
              </span>
              <div className="flex flex-wrap gap-2">
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
                className="mt-0.5 shrink-0"
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I reviewed these fingerprints, replacement conflicts and trust
              decisions for {review.databaseName}.
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
                disabled={!acknowledged || busy || scopes.unknown > 0}
                onClick={onConfirm}
              >
                Merge reviewed identities
              </button>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
