import { useState, type ReactNode } from "react";
import { Copy, Fingerprint, Globe, KeyRound, ShieldAlert } from "lucide-react";
import type { TrustCenterRow } from "../../hooks/security/useTrustCenter";
import type {
  CertIdentity,
  SshHostKeyIdentity,
} from "../../utils/auth/trustStore";
import { Modal, ModalBody, ModalHeader } from "../ui/overlays/Modal";

const actionClass =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const sectionClass =
  "min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, fallback = "Not available"): string {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : fallback;
}
function date(value: unknown, fallback = "Not available"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(timestamp) + " UTC"
    : "Unrecognized date";
}
function Fields({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(7rem,1fr)_minmax(0,3fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="pt-2 text-[var(--color-textMuted)]">{label}</dt>
          <dd className="min-w-0 break-words pb-1 sm:pt-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Props {
  row: TrustCenterRow;
  databaseName: string;
  connectionName: string;
  inspection: { rowId: string; history: unknown; stats: unknown } | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  children: ReactNode;
}

export default function TrustIdentityInspector({
  row,
  databaseName,
  connectionName,
  inspection,
  loading,
  error,
  onClose,
  children,
}: Props) {
  const [copyMessage, setCopyMessage] = useState("");
  const record = row.record;
  const identity = record.identity;
  const certificate = record.type !== "ssh" ? (identity as CertIdentity) : null;
  const ssh = !certificate ? (identity as SshHostKeyIdentity) : null;
  const currentInspection = inspection?.rowId === row.id ? inspection : null;
  const stats = object(currentInspection?.stats);
  const history = Array.isArray(currentInspection?.history)
    ? currentInspection.history
    : [];
  const notBefore = certificate?.validFrom
    ? Date.parse(certificate.validFrom)
    : NaN;
  const notAfter = certificate?.validTo ? Date.parse(certificate.validTo) : NaN;
  const validity =
    Number.isFinite(notBefore) && notBefore > Date.now()
      ? "Not yet valid"
      : Number.isFinite(notAfter) && notAfter < Date.now()
        ? "Expired"
        : Number.isFinite(notBefore) && Number.isFinite(notAfter)
          ? "Within stored validity dates"
          : "Validity dates unavailable";
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyMessage(
        `Could not copy ${label.toLowerCase()}. Select and copy the displayed text instead.`,
      );
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      panelClassName="max-w-5xl !max-h-[calc(100dvh-5rem)]"
      dataTestId="trust-identity-details"
    >
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            <Fingerprint
              size={18}
              className="shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="break-all">Identity — {record.host}</span>
          </span>
        }
        onClose={onClose}
      />
      <ModalBody className="space-y-4 bg-[var(--color-background)] p-4 sm:p-5">
        <section aria-label="Identity overview" className={sectionClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-textMuted)]">
                {record.type.toUpperCase()} ·{" "}
                {certificate ? "Certificate" : "SSH host key"}
              </p>
              <h3 className="break-words text-lg font-semibold">
                {record.nickname || record.host}
              </h3>
              <p className="mt-1 flex items-center gap-1.5 break-all text-xs text-[var(--color-textMuted)]">
                <Globe size={13} className="shrink-0" aria-hidden="true" />
                {record.host}
              </p>
            </div>
            <span
              className={`rounded-md border px-2.5 py-1 text-xs font-medium ${record.revoked ? "border-error/40 text-error" : "border-[var(--color-border)] text-[var(--color-text)]"}`}
            >
              {record.revoked ? "Revoked / blocked" : "Not revoked"}
            </span>
          </div>
          <Fields
            rows={[
              ["Database", databaseName],
              [
                "Applies to",
                row.connectionId
                  ? connectionName
                  : "All connections in this database",
              ],
              ...(row.connectionId
                ? [["Connection ID", row.connectionId] as [string, ReactNode]]
                : []),
              [
                "Approval",
                record.userApproved ? "User approved" : "Not user approved",
              ],
              [
                "Trust expiry",
                date(record.trustExpires, "No explicit trust expiry"),
              ],
            ]}
          />
          <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-medium">Accepted fingerprint</h4>
              <button
                type="button"
                className={actionClass}
                onClick={() => void copy(identity.fingerprint, "Fingerprint")}
                data-tooltip="Copy the exact stored fingerprint to compare through a trusted channel"
              >
                <Copy size={13} aria-hidden="true" />
                Copy fingerprint
              </button>
            </div>
            <p className="select-text break-all font-mono text-xs leading-6">
              {identity.fingerprint}
            </p>
          </div>
          <p className="mt-2 text-xs text-[var(--color-textMuted)]">
            Stored identity, not a live connection check. A label or tag does
            not change this fingerprint.
          </p>
          {copyMessage && (
            <p role="status" className="mt-2 text-xs">
              {copyMessage}
            </p>
          )}
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
          <div className="min-w-0 space-y-4">
            <section
              aria-label={
                certificate ? "Certificate details" : "SSH key details"
              }
              className={sectionClass}
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound
                  size={15}
                  className="text-primary"
                  aria-hidden="true"
                />
                {certificate ? "Certificate and validity" : "SSH host key"}
              </h3>
              {certificate ? (
                <>
                  <p
                    className={`mt-3 text-xs font-medium ${validity === "Expired" || validity === "Not yet valid" ? "text-warning" : "text-[var(--color-textMuted)]"}`}
                  >
                    {validity}
                  </p>
                  <Fields
                    rows={[
                      [
                        "Subject",
                        text(
                          certificate.subject,
                          "Not supplied by certificate or extractor",
                        ),
                      ],
                      ["Issuer", text(certificate.issuer)],
                      ["Valid from", date(certificate.validFrom)],
                      ["Valid until", date(certificate.validTo)],
                      ["Serial number", text(certificate.serial)],
                      ["Public-key algorithm", text(certificate.keyAlgorithm)],
                      [
                        "Key size",
                        certificate.keySize
                          ? `${certificate.keySize} bits`
                          : "Not available",
                      ],
                      [
                        "Signature algorithm",
                        text(certificate.signatureAlgorithm),
                      ],
                      ["Certificate version", text(certificate.version)],
                    ]}
                  />
                  {!!certificate.san?.length && (
                    <div className="mt-4">
                      <h4 className="mb-2 text-xs font-medium">
                        Subject alternative names
                      </h4>
                      <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                        {certificate.san.map((name, index) => (
                          <span
                            key={`${index}:${name}`}
                            className="max-w-full break-all rounded border border-[var(--color-border)] px-2 py-1 font-mono text-xs"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-[var(--color-textMuted)]">
                    Date range is separate from trust approval and CA
                    validation. Missing display metadata does not remove the
                    fingerprint check.
                  </p>
                </>
              ) : (
                <Fields
                  rows={[
                    ["Key type", text(ssh?.keyType)],
                    [
                      "Key size",
                      ssh?.keyBits ? `${ssh.keyBits} bits` : "Not available",
                    ],
                  ]}
                />
              )}
              <Fields
                rows={[
                  ["First seen", date(identity.firstSeen)],
                  ["Last seen", date(identity.lastSeen)],
                ]}
              />
              {!!certificate?.chain?.length && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    Certificate chain ({certificate.chain.length})
                  </summary>
                  <div className="mt-2 max-h-64 space-y-3 overflow-y-auto">
                    {certificate.chain.map((entry, index) => (
                      <div
                        key={`${index}:${entry.fingerprint}`}
                        className="rounded border border-[var(--color-border)] p-3"
                      >
                        <h4 className="mb-1 text-xs font-medium">
                          Certificate {index + 1}
                        </h4>
                        <Fields
                          rows={[
                            ["Subject", text(entry.subject)],
                            ["Issuer", text(entry.issuer)],
                            ["Valid from", date(entry.validFrom)],
                            ["Valid until", date(entry.validTo)],
                            [
                              "Fingerprint",
                              <span className="break-all font-mono">
                                {entry.fingerprint}
                              </span>,
                            ],
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
            <section
              aria-label="Verification activity"
              className={sectionClass}
            >
              <h3 className="text-sm font-semibold">Verification statistics</h3>
              {loading && !currentInspection && (
                <p role="status" className="mt-3 text-xs">
                  Loading native verification activity…
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="mt-3 flex items-start gap-2 text-xs text-error"
                >
                  <ShieldAlert
                    size={14}
                    className="shrink-0"
                    aria-hidden="true"
                  />
                  {error}
                </p>
              )}
              {currentInspection ? (
                <Fields
                  rows={[
                    ["Verification checks", text(stats.total_checks)],
                    ["Identity matches", text(stats.match_count)],
                    ["Identity mismatches", text(stats.mismatch_count)],
                    ["Recorded trust score", text(stats.trust_score)],
                    [
                      "Last verified",
                      date(stats.last_verified, "Never recorded"),
                    ],
                    [
                      "Last mismatch",
                      date(stats.last_mismatch, "Never recorded"),
                    ],
                  ]}
                />
              ) : (
                !loading &&
                !error && (
                  <p className="mt-3 text-xs text-[var(--color-textMuted)]">
                    Native verification activity is not available.
                  </p>
                )
              )}
              <h4 className="mb-2 mt-5 text-xs font-semibold">
                Recent identity history
              </h4>
              {history.length ? (
                <ol className="max-h-64 space-y-3 overflow-y-auto text-xs">
                  {history
                    .slice(-50)
                    .reverse()
                    .map((value, index) => {
                      const entry = object(value);
                      return (
                        <li
                          key={`${index}:${text(entry.changed_at)}`}
                          className="border-l-2 border-[var(--color-border)] pl-3"
                        >
                          <p className="font-medium capitalize">
                            {text(entry.reason, "Identity change").replace(
                              /_/g,
                              " ",
                            )}
                          </p>
                          <p className="mt-1 text-[var(--color-textMuted)]">
                            {date(entry.changed_at, "Unknown time")}
                          </p>
                          {object(entry.identity).fingerprint != null && (
                            <p className="mt-1 break-all font-mono">
                              {text(object(entry.identity).fingerprint)}
                            </p>
                          )}
                          {entry.note != null && (
                            <p className="mt-1 break-words">
                              {text(entry.note)}
                            </p>
                          )}
                          {entry.approved_by != null && (
                            <p className="mt-1 text-[var(--color-textMuted)]">
                              Approved by {text(entry.approved_by)}
                            </p>
                          )}
                        </li>
                      );
                    })}
                </ol>
              ) : (
                currentInspection && (
                  <p className="text-xs text-[var(--color-textMuted)]">
                    No recorded identity changes.
                  </p>
                )
              )}
              {!!history.length && (
                <p className="mt-3 text-xs text-[var(--color-textMuted)]">
                  Latest 50 entries, newest first. Complete data remains in
                  Advanced below.
                </p>
              )}
            </section>
          </div>
          <section
            aria-label="Identity labels and verification rules"
            className={sectionClass}
          >
            <h3 className="mb-3 text-sm font-semibold">
              Label and verification rules
            </h3>
            {children}
          </section>
        </div>
        <details className={sectionClass}>
          <summary className="cursor-pointer text-xs font-semibold">
            Advanced raw identity and history
          </summary>
          <p className="mt-2 text-xs text-[var(--color-textMuted)]">
            Public identity data for troubleshooting; this does not contain a
            private key or saved password.
          </p>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-background)] p-3 text-xs">
            {JSON.stringify(
              {
                identity,
                history: currentInspection?.history ?? record.history ?? [],
                statistics: currentInspection?.stats ?? null,
                tags: record.tags ?? [],
                revoked: !!record.revoked,
                hostPolicy: record.hostPolicy ?? "inherit",
                trustExpires: record.trustExpires,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </ModalBody>
    </Modal>
  );
}
