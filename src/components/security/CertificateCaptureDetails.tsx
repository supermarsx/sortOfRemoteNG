import { useState, type ReactNode } from "react";
import { formatBytes } from "../../utils/core/formatters";
import type {
  CertificateDetails,
  CertificateInspection,
  CertificateNameAttribute,
} from "../../types/security/certificateInspection";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[var(--color-textMuted)]">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {value === null || value === undefined || value === ""
          ? "Not captured"
          : value}
      </dd>
    </div>
  );
}
function Expand({
  title,
  children,
  fullTitle,
}: {
  title: string;
  children: ReactNode;
  fullTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="min-w-0 rounded-md border border-[var(--color-border)]"
    >
      <summary
        title={fullTitle}
        className="min-w-0 cursor-pointer break-words rounded-md px-3 py-2 font-medium [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {title}
      </summary>
      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] p-3">
          {children}
        </div>
      )}
    </details>
  );
}
function Raw({
  title,
  value,
}: {
  title: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <Expand title={title}>
      <pre
        tabIndex={0}
        className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--color-background)] p-2 text-[11px]"
      >
        {value}
      </pre>
    </Expand>
  );
}
function Attributes({
  title,
  values,
}: {
  title: string;
  values: CertificateNameAttribute[];
}) {
  return (
    <Expand title={`${title} (${values.length})`}>
      {!values.length && <p>No parsed attributes captured.</p>}
      {values.map((attribute, index) => (
        <dl
          key={`${attribute.rdn}:${attribute.oid}:${index}`}
          className="space-y-1 border-b border-[var(--color-border)] pb-2 last:border-0"
        >
          <Field
            label={`${attribute.name ?? attribute.oid} · RDN ${attribute.rdn}`}
            value={attribute.value}
          />
          <Field label="Attribute OID" value={attribute.oid} />
          <Raw
            title="Attribute ASN.1 DER (base64)"
            value={attribute.value_der_base64}
          />
        </dl>
      ))}
    </Expand>
  );
}
function Details({ details }: { details: CertificateDetails }) {
  return (
    <div className="space-y-3">
      {details.parse_error && (
        <p role="status" className="break-words text-warning">
          {details.parse_error} Raw DER and PEM below are the captured
          certificate, not reconstructed metadata.
        </p>
      )}
      <dl className="space-y-2">
        <Field label="Serial number" value={details.serial} />
        <Field label="X.509 version" value={details.version} />
        <Field
          label="Signature algorithm"
          value={details.signature_algorithm}
        />
        <Field
          label="Signature algorithm OID"
          value={details.signature_algorithm_oid}
        />
        <Field
          label="SHA-256 fingerprint"
          value={details.fingerprints.sha256}
        />
        <Field
          label="SHA-384 fingerprint"
          value={details.fingerprints.sha384}
        />
        <Field
          label="SHA-512 fingerprint"
          value={details.fingerprints.sha512}
        />
      </dl>
      <Attributes
        title="Subject distinguished-name attributes"
        values={details.subject_attributes}
      />
      <Attributes
        title="Issuer distinguished-name attributes"
        values={details.issuer_attributes}
      />
      <Expand
        title={`Subject alternative names (${details.san_entries.length})`}
      >
        {!details.san_entries.length && (
          <p>No parsed alternative names captured.</p>
        )}
        {details.san_entries.map((san, index) => (
          <dl key={`${index}:${san.type}`} className="space-y-2">
            <Field label={san.type} value={san.value} />
            {san.oid && <Field label="Name OID" value={san.oid} />}
            <Raw
              title="Alternative name DER (base64)"
              value={san.value_der_base64}
            />
          </dl>
        ))}
      </Expand>
      <Expand title="Public key">
        {details.public_key ? (
          <>
            <dl className="space-y-2">
              <Field
                label="Key algorithm"
                value={details.public_key.algorithm}
              />
              <Field
                label="Key algorithm OID"
                value={details.public_key.algorithm_oid}
              />
              <Field label="Key size (bits)" value={details.public_key.bits} />
              <Field
                label="Parameter / curve OID"
                value={details.public_key.parameter_oid}
              />
              <Field
                label="SPKI SHA-256"
                value={details.public_key.spki_sha256}
              />
            </dl>
            <Raw
              title="Subject Public Key Info DER (base64)"
              value={details.public_key.spki_der_base64}
            />
          </>
        ) : (
          <p>Public-key metadata was not captured.</p>
        )}
      </Expand>
      <Expand title={`Certificate extensions (${details.extensions.length})`}>
        {!details.extensions.length && <p>No parsed extensions captured.</p>}
        {details.extensions.map((extension, index) => (
          <div
            key={`${index}:${extension.oid}`}
            className="space-y-2 border-b border-[var(--color-border)] pb-2 last:border-0"
          >
            <dl className="space-y-2">
              <Field
                label={extension.name ?? "Extension"}
                value={extension.oid}
              />
              <Field
                label="Critical"
                value={extension.critical ? "Yes" : "No"}
              />
              <Field label="Parsed summary" value={extension.summary} />
            </dl>
            <Raw
              title="Extension value DER (base64)"
              value={extension.value_der_base64}
            />
          </div>
        ))}
      </Expand>
      <Raw
        title="Signature parameters DER (base64)"
        value={details.signature_parameters_der_base64}
      />
      <Raw
        title="Signature value (base64)"
        value={details.signature_value_base64}
      />
      <Raw title="Raw certificate PEM" value={details.pem} />
      <Raw title="Raw certificate DER (base64)" value={details.der_base64} />
    </div>
  );
}

/** All values come from this peer capture; no roots, validity or trust are inferred. */
export function CertificateCaptureDetails({
  inspection,
}: {
  inspection: CertificateInspection;
}) {
  const info = inspection.certificate;
  return (
    <section
      aria-label="Current peer certificate capture"
      className="space-y-3 border-t border-[var(--color-border)] pt-3 text-xs"
    >
      <h3 className="font-semibold">Current peer certificate capture</h3>
      <p className="text-[var(--color-textMuted)]">
        Observed at {inspection.host}:{inspection.port}. These are the
        certificates sent by this peer, not a verified certification path. No
        missing root or intermediate was fetched. Stored trust decisions are
        shown separately above.
      </p>
      {info.capture && (
        <dl className="space-y-2">
          <Field label="Captured at" value={info.capture.captured_at} />
          <Field
            label="Peer-presented certificates"
            value={info.capture.certificate_count}
          />
          <Field
            label="Captured DER size"
            value={
              <span
                tabIndex={0}
                data-tooltip={`${info.capture.total_der_bytes.toLocaleString()} bytes captured`}
                aria-label={`${info.capture.total_der_bytes.toLocaleString()} bytes captured`}
                className="inline-block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {formatBytes(info.capture.total_der_bytes)}
              </span>
            }
          />
        </dl>
      )}
      {info.warnings?.map((warning, index) => (
        <p
          key={`${index}:${warning}`}
          role="status"
          className="break-words text-warning"
        >
          {warning}
        </p>
      ))}
      {info.details ? (
        <Expand title="Observed leaf certificate — full details">
          <dl className="space-y-2">
            <Field label="Full subject DN" value={info.subject} />
            <Field label="Full issuer DN" value={info.issuer} />
            <Field label="Valid from" value={info.valid_from} />
            <Field label="Valid until" value={info.valid_to} />
          </dl>
          <Details details={info.details} />
        </Expand>
      ) : (
        <p>
          Full capture details are unavailable from this backend. Only the
          captured summary fields above are available.
        </p>
      )}
      <Expand title={`Peer-presented chain (${info.chain?.length ?? 0})`}>
        {!info.chain?.length && <p>No peer chain was captured.</p>}
        {info.chain?.map((entry, index) => (
          <Expand
            key={`${index}:${entry.fingerprint}`}
            title={`${index === 0 ? "Leaf" : `Peer certificate ${index + 1}`} · ${(entry.subject || entry.fingerprint).length > 120 ? `${(entry.subject || entry.fingerprint).slice(0, 120)}…` : entry.subject || entry.fingerprint}`}
            fullTitle={entry.subject || entry.fingerprint}
          >
            <dl className="space-y-2">
              <Field label="Full subject DN" value={entry.subject} />
              <Field label="Full issuer DN" value={entry.issuer} />
              <Field label="Valid from" value={entry.valid_from} />
              <Field label="Valid until" value={entry.valid_to} />
              <Field label="SHA-256 fingerprint" value={entry.fingerprint} />
            </dl>
            {entry.details ? (
              <Details details={entry.details} />
            ) : (
              <p>
                Only summary fields were supplied for this peer certificate.
              </p>
            )}
          </Expand>
        ))}
      </Expand>
    </section>
  );
}
