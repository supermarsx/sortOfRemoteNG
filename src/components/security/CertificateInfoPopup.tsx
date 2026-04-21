import React, { useState } from "react";
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Fingerprint,
  FileKey,
  AlertTriangle,
  Globe,
  Server,
  Key,
  Pencil,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import type {
  CertIdentity,
  CertChainEntry,
  SshHostKeyIdentity,
  TrustRecord,
} from "../../utils/auth/trustStore";
import {
  formatFingerprint,
} from "../../utils/auth/trustStore";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";
import { useCertificateInfoPopup } from "../../hooks/security/useCertificateInfoPopup";

const TRUST_ICONS = { ShieldAlert, ShieldCheck, Shield } as const;

interface CertificateInfoPopupProps {
  type: "tls" | "ssh";
  host: string;
  port: number;
  currentIdentity?: CertIdentity | SshHostKeyIdentity;
  trustRecord?: TrustRecord;
  connectionId?: string;
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export const CertificateInfoPopup: React.FC<CertificateInfoPopupProps> = ({
  type,
  host,
  port,
  currentIdentity,
  trustRecord,
  connectionId,
  triggerRef,
  onClose,
}) => {
  const mgr = useCertificateInfoPopup(type, host, port, currentIdentity, trustRecord, connectionId);

  const trustStatus = mgr.getTrustStatus();
  const TrustIcon = TRUST_ICONS[trustStatus.icon];

  if (!triggerRef) return null;

  return (
    <PopoverSurface
      isOpen
      onClose={onClose}
      anchorRef={triggerRef}
      align="start"
      offset={4}
      className="sor-popover-panel sor-popover-panel-strong z-[99999] w-96 overflow-y-auto"
      style={{ maxHeight: "calc(100vh - 60px)" }}
      dataTestId="certificate-info-popover"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <TrustIcon size={16} className={trustStatus.color} />
            <span className="text-sm font-medium text-[var(--color-text)]">
              {mgr.isTls ? "Certificate Information" : "Host Key Information"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Connection info */}
          <div className="flex items-center gap-2 text-sm">
            <Globe
              size={14}
              className="text-[var(--color-textSecondary)] flex-shrink-0"
            />
            <span className="text-[var(--color-textSecondary)]">
              {host}:{port}
            </span>
            <span
              className={`ml-auto text-xs font-medium ${trustStatus.color}`}
            >
              {trustStatus.label}
            </span>
          </div>

          {/* Nickname */}
          {trustRecord && (
            <div className="flex items-center gap-2 text-xs">
              {mgr.editingNick ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={mgr.nickDraft}
                    onChange={(e) => mgr.setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        mgr.saveNickname(mgr.nickDraft.trim());
                      } else if (e.key === "Escape") {
                        mgr.cancelEditing();
                      }
                    }}
                    placeholder="Add a nickname…"
                    className="flex-1 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-textSecondary)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                  />
                  <button
                    onClick={() => mgr.saveNickname(mgr.nickDraft.trim())}
                    className="text-success hover:text-success p-0.5"
                    title="Save"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={mgr.cancelEditing}
                    className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[var(--color-textMuted)] italic truncate">
                    {mgr.savedNick || "No nickname"}
                  </span>
                  <button
                    onClick={mgr.startEditing}
                    className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Edit nickname"
                  >
                    <Pencil size={10} />
                  </button>
                </>
              )}
            </div>
          )}

          {!mgr.identity ? (
            <p className="text-sm text-[var(--color-textMuted)] italic">
              No {mgr.isTls ? "certificate" : "host key"} information available yet.
              Connect to the server to retrieve it.
            </p>
          ) : (
            <>
              {/* Fingerprint */}
              <div className="bg-[var(--color-background)] rounded p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
                  <Fingerprint size={12} />
                  <span>Fingerprint (SHA-256)</span>
                </div>
                <p className="text-xs text-[var(--color-textSecondary)] font-mono break-all">
                  {formatFingerprint(mgr.identity.fingerprint)}
                </p>
              </div>

              {/* TLS-specific cert details */}
              {mgr.isCertIdentity(mgr.identity) && (
                <TlsCertDetails identity={mgr.identity} isExpired={mgr.isExpired} isExpiringSoon={mgr.isExpiringSoon} />
              )}

              {/* SSH-specific host key details */}
              {!mgr.isCertIdentity(mgr.identity) && (
                <SshKeyDetails identity={mgr.identity as SshHostKeyIdentity} />
              )}

              {/* First / last seen */}
              <div className="text-xs text-[var(--color-textMuted)] space-y-0.5 pt-1 border-t border-[var(--color-border)]">
                {mgr.identity.firstSeen && (
                  <p>
                    First seen: {new Date(mgr.identity.firstSeen).toLocaleString()}
                  </p>
                )}
                {mgr.identity.lastSeen && (
                  <p>
                    Last seen: {new Date(mgr.identity.lastSeen).toLocaleString()}
                  </p>
                )}
              </div>

              {/* History */}
              {trustRecord?.history && trustRecord.history.length > 0 && (
                <details className="text-xs">
                  <summary className="text-[var(--color-textMuted)] cursor-pointer hover:text-[var(--color-textSecondary)] flex items-center gap-1">
                    <AlertTriangle size={10} />
                    <span>
                      {trustRecord.history.length} previous{" "}
                      {trustRecord.history.length === 1
                        ? "identity"
                        : "identities"}
                    </span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {trustRecord.history.map((prev, i) => (
                      <div
                        key={i}
                        className="bg-[var(--color-background)]/50 rounded p-2 border border-[var(--color-border)]/50"
                      >
                        <p className="font-mono text-[var(--color-textSecondary)] break-all">
                          {formatFingerprint(prev.fingerprint)}
                        </p>
                        <p className="text-[var(--color-textMuted)] mt-1">
                          Seen: {new Date(prev.firstSeen).toLocaleDateString()}{" "}
                          — {new Date(prev.lastSeen).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </PopoverSurface>
  );
};

/** Helper: a single info row */
function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-[var(--color-textMuted)] flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-[var(--color-textMuted)] flex-shrink-0 w-16">{label}</span>
      <span className="text-[var(--color-textSecondary)] break-all">
        {value}
      </span>
    </div>
  );
}

/** Section heading used between groups of rows */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-2 border-t border-[var(--color-border)]">
      <span className="text-xs font-medium text-[var(--color-textMuted)]">{children}</span>
    </div>
  );
}

/** TLS certificate detail fields */
function TlsCertDetails({
  identity,
  isExpired,
  isExpiringSoon,
}: {
  identity: CertIdentity;
  isExpired: (id: CertIdentity) => boolean;
  isExpiringSoon: (id: CertIdentity) => boolean;
}) {
  const [showPem, setShowPem] = useState(false);
  const [showChain, setShowChain] = useState(false);

  const expired = isExpired(identity);
  const expiringSoon = isExpiringSoon(identity);
  const isCurrentlyValid = !expired && !expiringSoon && !!identity.validFrom && !!identity.validTo;

  const hasSubjectDetails = identity.subjectCn || identity.subjectOrg || identity.subjectOu || identity.subjectCountry || identity.subjectState || identity.subjectLocality || identity.subjectEmail;
  const hasIssuerDetails = identity.issuerCn || identity.issuerOrg || identity.issuerCountry;

  return (
    <>
      {/* ── Subject section ──────────────────────────────────── */}
      {(hasSubjectDetails || identity.subject) && (
        <>
          <SectionHeading>Subject</SectionHeading>
          {hasSubjectDetails ? (
            <>
              {identity.subjectCn && (
                <Row icon={<Server size={12} />} label="CN" value={identity.subjectCn} />
              )}
              {identity.subjectOrg && (
                <Row icon={<Server size={12} />} label="O" value={identity.subjectOrg} />
              )}
              {identity.subjectOu && (
                <Row icon={<Server size={12} />} label="OU" value={identity.subjectOu} />
              )}
              {identity.subjectCountry && (
                <Row icon={<Server size={12} />} label="C" value={identity.subjectCountry} />
              )}
              {identity.subjectState && (
                <Row icon={<Server size={12} />} label="ST" value={identity.subjectState} />
              )}
              {identity.subjectLocality && (
                <Row icon={<Server size={12} />} label="L" value={identity.subjectLocality} />
              )}
              {identity.subjectEmail && (
                <Row icon={<Server size={12} />} label="Email" value={identity.subjectEmail} />
              )}
            </>
          ) : (
            identity.subject && (
              <Row icon={<Server size={12} />} label="Subject" value={identity.subject} />
            )
          )}
        </>
      )}

      {/* ── Issuer section ───────────────────────────────────── */}
      {(hasIssuerDetails || identity.issuer) && (
        <>
          <SectionHeading>Issuer</SectionHeading>
          {hasIssuerDetails ? (
            <>
              {identity.issuerCn && (
                <Row icon={<FileKey size={12} />} label="CN" value={identity.issuerCn} />
              )}
              {identity.issuerOrg && (
                <Row icon={<FileKey size={12} />} label="O" value={identity.issuerOrg} />
              )}
              {identity.issuerCountry && (
                <Row icon={<FileKey size={12} />} label="C" value={identity.issuerCountry} />
              )}
            </>
          ) : (
            identity.issuer && (
              <Row icon={<FileKey size={12} />} label="Issuer" value={identity.issuer} />
            )
          )}
        </>
      )}

      {/* ── Validity section ─────────────────────────────────── */}
      {(identity.validFrom || identity.validTo) && (
        <>
          <SectionHeading>Validity</SectionHeading>
          <div className="bg-[var(--color-background)] rounded p-3 space-y-1">
            <div className="flex items-center gap-2 text-xs text-[var(--color-textMuted)]">
              <Clock size={12} />
              <span>Validity Period</span>
            </div>
            {identity.validFrom && (
              <p className="text-xs">
                Not Before:{" "}
                <span
                  className={
                    isCurrentlyValid
                      ? "text-success font-medium"
                      : "text-[var(--color-textSecondary)]"
                  }
                >
                  {new Date(identity.validFrom).toLocaleDateString()}
                </span>
              </p>
            )}
            {identity.validTo && (
              <p className="text-xs">
                Not After:{" "}
                <span
                  className={
                    expired
                      ? "text-error font-medium"
                      : expiringSoon
                        ? "text-warning font-medium"
                        : isCurrentlyValid
                          ? "text-success font-medium"
                          : "text-[var(--color-textSecondary)]"
                  }
                >
                  {new Date(identity.validTo).toLocaleDateString()}
                  {expired && " (EXPIRED)"}
                  {expiringSoon && " (expiring soon)"}
                </span>
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Key & Algorithm section ──────────────────────────── */}
      {(identity.version != null || identity.keyAlgorithm || identity.keySize != null || identity.signatureAlgorithm || identity.serial) && (
        <>
          <SectionHeading>Key & Algorithm</SectionHeading>
          {identity.version != null && (
            <Row icon={<Shield size={12} />} label="Version" value={`v${identity.version}`} />
          )}
          {identity.keyAlgorithm && (
            <Row icon={<Key size={12} />} label="Key Algo" value={identity.keyAlgorithm} />
          )}
          {identity.keySize != null && (
            <Row icon={<Key size={12} />} label="Key Size" value={`${identity.keySize} bits`} />
          )}
          {identity.signatureAlgorithm && (
            <Row icon={<Shield size={12} />} label="Sig Algo" value={identity.signatureAlgorithm} />
          )}
          {identity.serial && (
            <Row icon={<Key size={12} />} label="Serial" value={identity.serial} />
          )}
        </>
      )}

      {/* ── Subject Alternative Names ────────────────────────── */}
      {identity.san && identity.san.length > 0 && (
        <>
          <SectionHeading>Subject Alternative Names</SectionHeading>
          <div className="flex items-start gap-2 text-xs">
            <span className="text-[var(--color-textMuted)] flex-shrink-0 mt-0.5">
              <Globe size={12} />
            </span>
            <span className="text-[var(--color-textMuted)] flex-shrink-0 w-16">SANs</span>
            <ul className="text-[var(--color-textSecondary)] break-all list-none m-0 p-0 space-y-0.5">
              {identity.san.map((name, i) => (
                <li key={i} className="font-mono">{name}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* ── Certificate Chain section ────────────────────────── */}
      {identity.chain && identity.chain.length > 0 && (
        <>
          <SectionHeading>Certificate Chain</SectionHeading>
          <details open={showChain} onToggle={(e) => setShowChain((e.target as HTMLDetailsElement).open)}>
            <summary className="text-xs text-[var(--color-textMuted)] cursor-pointer hover:text-[var(--color-textSecondary)] flex items-center gap-1">
              <FileKey size={10} />
              <span>{identity.chain.length} certificate{identity.chain.length !== 1 ? "s" : ""} in chain</span>
            </summary>
            <div className="mt-2 space-y-2">
              {identity.chain.map((entry: CertChainEntry, i: number) => (
                <div
                  key={i}
                  className="bg-[var(--color-background)]/50 rounded p-2 border border-[var(--color-border)]/50 space-y-1"
                >
                  <p className="text-xs text-[var(--color-textSecondary)]">
                    <span className="font-medium">{entry.subject}</span>
                    {" \u2192 "}
                    <span className="text-[var(--color-textMuted)]">{entry.issuer}</span>
                  </p>
                  <p className="text-[10px] font-mono text-[var(--color-textMuted)] break-all">
                    {formatFingerprint(entry.fingerprint)}
                  </p>
                  <p className="text-[10px] text-[var(--color-textMuted)]">
                    {new Date(entry.validFrom).toLocaleDateString()} — {new Date(entry.validTo).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      {/* ── PEM section ──────────────────────────────────────── */}
      {identity.pem && (
        <>
          <SectionHeading>PEM Certificate</SectionHeading>
          <div className="space-y-1">
            <button
              onClick={() => setShowPem((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] transition-colors"
            >
              {showPem ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>{showPem ? "Hide" : "Show"} PEM Certificate</span>
            </button>
            {showPem && (
              <pre className="text-[10px] font-mono text-[var(--color-textSecondary)] bg-[var(--color-background)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {identity.pem}
              </pre>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** SSH host key detail fields */
function SshKeyDetails({ identity }: { identity: SshHostKeyIdentity }) {
  const [showPublicKey, setShowPublicKey] = useState(false);

  return (
    <>
      {identity.keyType && (
        <Row icon={<Key size={12} />} label="Key Type" value={identity.keyType} />
      )}
      {identity.keyBits != null && (
        <Row icon={<Shield size={12} />} label="Key Bits" value={String(identity.keyBits)} />
      )}

      {/* Public key show/hide toggle */}
      {identity.publicKey && (
        <div className="space-y-1">
          <button
            onClick={() => setShowPublicKey((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)] transition-colors"
          >
            {showPublicKey ? <EyeOff size={12} /> : <Eye size={12} />}
            <span>{showPublicKey ? "Hide" : "Show"} Public Key</span>
          </button>
          {showPublicKey && (
            <pre className="text-[10px] font-mono text-[var(--color-textSecondary)] bg-[var(--color-background)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {identity.publicKey}
            </pre>
          )}
        </div>
      )}
    </>
  );
}
