import React, { useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Fingerprint,
  ArrowRight,
  Server,
  FileKey,
  Clock,
  Globe,
  Key,
  Shield,
} from "lucide-react";
import type { CertIdentity, SshHostKeyIdentity } from "../../utils/auth/trustStore";
import { formatFingerprint } from "../../utils/auth/trustStore";
import { Modal } from "../ui/overlays/Modal";

interface TrustWarningDialogProps {
  type: "tls" | "ssh";
  host: string;
  port: number;
  /**
   * 'first-use': identity has never been seen — ask user to trust it.
   * 'mismatch': identity differs from what was stored — potential MITM.
   */
  reason: "first-use" | "mismatch";
  /** The identity presented by the remote server right now */
  receivedIdentity: CertIdentity | SshHostKeyIdentity;
  /** The previously stored identity (only for 'mismatch') */
  storedIdentity?: CertIdentity | SshHostKeyIdentity;
  /** Called when user chooses to trust & continue */
  onAccept: (remember?: boolean) => void;
  /** Called when user refuses to continue */
  onReject: () => void;
}

/**
 * A modal warning dialog shown when:
 * - A never-before-seen server presents its identity (first-use)
 * - A previously-seen server presents a DIFFERENT identity (mismatch / possible MITM)
 */
export const TrustWarningDialog: React.FC<TrustWarningDialogProps> = ({
  type,
  host,
  port,
  reason,
  receivedIdentity,
  storedIdentity,
  onAccept,
  onReject,
}) => {
  const isMismatch = reason === "mismatch";
  const isTls = type === "tls";
  const identityLabel = isTls ? "certificate" : "host key";
  const [rememberDecision, setRememberDecision] = useState(false);

  return (
    <Modal
      isOpen
      onClose={onReject}
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-lg mx-4"
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full">
        {/* Header */}
        <div
          className={`flex items-center gap-3 px-6 py-4 border-b ${
            isMismatch
              ? "border-error/50 bg-error/20"
              : "border-warning/50 bg-warning/20"
          } rounded-t-xl`}
        >
          {isMismatch ? (
            <ShieldAlert size={28} className="text-error flex-shrink-0" />
          ) : (
            <ShieldCheck size={28} className="text-warning flex-shrink-0" />
          )}
          <div>
            <h2
              className={`text-lg font-semibold ${isMismatch ? "text-error" : "text-warning"}`}
            >
              {isMismatch
                ? `${isTls ? "Certificate" : "Host Key"} Has Changed!`
                : `Unknown ${isTls ? "Certificate" : "Host Key"}`}
            </h2>
            <p className="text-sm text-[var(--color-textSecondary)]">
              {host}:{port}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isMismatch ? (
            <>
              <div className="flex items-start gap-2 p-3 bg-error/20 border border-error/40 rounded-lg">
                <AlertTriangle
                  size={16}
                  className="text-error flex-shrink-0 mt-0.5"
                />
                <div className="text-sm text-error">
                  <p className="font-medium">
                    The {identityLabel} presented by this server has changed
                    since the last connection.
                  </p>
                  <p className="mt-1 text-error/80">
                    This could indicate a man-in-the-middle attack, or the
                    server&apos;s {identityLabel} was legitimately rotated.
                    Proceed only if you trust this change.
                  </p>
                </div>
              </div>

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-2 gap-3">
                {/* Previously stored */}
                <div className="bg-[var(--color-background)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-textMuted)] font-medium mb-2">
                    Previously Stored
                  </p>
                  <IdentitySummary identity={storedIdentity} isTls={isTls} />
                </div>

                {/* Received now */}
                <div className="bg-[var(--color-background)] rounded-lg p-3 border border-error/30">
                  <p className="text-xs text-error font-medium mb-2">
                    Received Now
                  </p>
                  <IdentitySummary identity={receivedIdentity} isTls={isTls} accentClass="text-error" />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-textSecondary)]">
                The server at{" "}
                <span className="text-warning font-medium">
                  {host}:{port}
                </span>{" "}
                presented a {identityLabel} that has not been seen before.
              </p>
              <div className="bg-[var(--color-background)] rounded-lg p-3">
                <IdentitySummary identity={receivedIdentity} isTls={isTls} />
              </div>
              <p className="text-xs text-[var(--color-textSecondary)]">
                If you trust this server, accept the {identityLabel} to remember
                it for future connections. Any change to this {identityLabel}{" "}
                will trigger a warning.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberDecision}
                  onChange={(e) => setRememberDecision(e.target.checked)}
                  className="rounded border-[var(--color-border)]"
                />
                <span className="text-sm text-[var(--color-textSecondary)]">
                  Remember and trust for future connections
                </span>
              </label>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={onReject}
            className="px-4 py-2 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
          >
            Disconnect
          </button>
          <button
            onClick={() => onAccept(isMismatch ? undefined : rememberDecision)}
            className={`flex items-center gap-2 px-4 py-2 text-sm text-[var(--color-text)] rounded-lg transition-colors ${
              isMismatch
                ? "bg-error hover:bg-error/90"
                : "bg-primary hover:bg-primary/90"
            }`}
          >
            {isMismatch ? (
              <>
                <AlertTriangle size={14} />
                <span>
                  Trust New {isTls ? "Certificate" : "Key"} &amp; Continue
                </span>
              </>
            ) : (
              <>
                <ArrowRight size={14} />
                <span>Accept &amp; Continue</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCertIdentity(
  id: CertIdentity | SshHostKeyIdentity,
): id is CertIdentity {
  return "issuer" in id || "validFrom" in id || "serial" in id;
}

/** A compact, read-only summary of a TLS cert or SSH host key identity. */
function IdentitySummary({
  identity,
  isTls,
  accentClass,
}: {
  identity?: CertIdentity | SshHostKeyIdentity;
  isTls: boolean;
  accentClass?: string;
}) {
  if (!identity) {
    return <p className="text-[11px] text-[var(--color-textMuted)]">--</p>;
  }

  const fpColor = accentClass ?? "text-[var(--color-textSecondary)]";

  return (
    <div className="space-y-2">
      {/* Fingerprint */}
      <div>
        <div className="flex items-center gap-1 mb-0.5">
          <Fingerprint size={10} className="text-[var(--color-textMuted)]" />
          <span className="text-[10px] text-[var(--color-textMuted)]">
            Fingerprint (SHA-256)
          </span>
        </div>
        <p className={`text-[11px] font-mono break-all ${fpColor}`}>
          {formatFingerprint(identity.fingerprint)}
        </p>
      </div>

      {/* TLS-specific fields */}
      {isTls && isCertIdentity(identity) && (
        <>
          {identity.subject && (
            <SummaryRow icon={<Server size={10} />} label="Subject" value={identity.subject} />
          )}
          {identity.issuer && (
            <SummaryRow icon={<FileKey size={10} />} label="Issuer" value={identity.issuer} />
          )}
          {identity.san && identity.san.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-0.5">
                <Globe size={10} className="text-[var(--color-textMuted)]" />
                <span className="text-[10px] text-[var(--color-textMuted)]">SANs</span>
              </div>
              <ul className="text-[11px] text-[var(--color-textSecondary)] list-none m-0 p-0 space-y-0.5">
                {identity.san.map((name, i) => (
                  <li key={i} className="font-mono break-all">{name}</li>
                ))}
              </ul>
            </div>
          )}
          {(identity.validFrom || identity.validTo) && (
            <div>
              <div className="flex items-center gap-1 mb-0.5">
                <Clock size={10} className="text-[var(--color-textMuted)]" />
                <span className="text-[10px] text-[var(--color-textMuted)]">Validity</span>
              </div>
              {identity.validFrom && (
                <p className="text-[11px] text-[var(--color-textSecondary)]">
                  From: {new Date(identity.validFrom).toLocaleDateString()}
                </p>
              )}
              {identity.validTo && (
                <p className={`text-[11px] ${validityColor(identity)}`}>
                  To: {new Date(identity.validTo).toLocaleDateString()}
                  {isExpired(identity) && " (EXPIRED)"}
                  {isExpiringSoon(identity) && " (expiring soon)"}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* SSH-specific fields */}
      {!isTls && !isCertIdentity(identity) && (
        <>
          {(identity as SshHostKeyIdentity).keyType && (
            <SummaryRow icon={<Key size={10} />} label="Key Type" value={(identity as SshHostKeyIdentity).keyType!} />
          )}
          {(identity as SshHostKeyIdentity).keyBits != null && (
            <SummaryRow icon={<Shield size={10} />} label="Key Bits" value={String((identity as SshHostKeyIdentity).keyBits)} />
          )}
        </>
      )}

      {/* Last seen */}
      {identity.lastSeen && (
        <p className="text-[10px] text-[var(--color-textMuted)]">
          Last seen: {new Date(identity.lastSeen).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[var(--color-textMuted)]">{icon}</span>
        <span className="text-[10px] text-[var(--color-textMuted)]">{label}</span>
      </div>
      <p className="text-[11px] text-[var(--color-textSecondary)] break-all">{value}</p>
    </div>
  );
}

function isExpired(id: CertIdentity): boolean {
  if (!id.validTo) return false;
  return new Date(id.validTo).getTime() < Date.now();
}

function isExpiringSoon(id: CertIdentity): boolean {
  if (!id.validTo) return false;
  const daysLeft =
    (new Date(id.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft > 0 && daysLeft <= 5;
}

function validityColor(id: CertIdentity): string {
  if (isExpired(id)) return "text-error font-medium";
  if (isExpiringSoon(id)) return "text-warning font-medium";
  return "text-success font-medium";
}
