import React from "react";
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
} from "lucide-react";
import type {
  CertIdentity,
  SshHostKeyIdentity,
  TrustRecord,
} from "../utils/trustStore";
import {
  formatFingerprint,
} from "../utils/trustStore";
import { PopoverSurface } from "./ui/PopoverSurface";
import { useCertificateInfoPopup } from "../hooks/security/useCertificateInfoPopup";

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
                    className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                  />
                  <button
                    onClick={() => mgr.saveNickname(mgr.nickDraft.trim())}
                    className="text-green-400 hover:text-green-300 p-0.5"
                    title="Save"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={mgr.cancelEditing}
                    className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-gray-500 italic truncate">
                    {mgr.savedNick || "No nickname"}
                  </span>
                  <button
                    onClick={mgr.startEditing}
                    className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Edit nickname"
                  >
                    <Pencil size={10} />
                  </button>
                </>
              )}
            </div>
          )}

          {!mgr.identity ? (
            <p className="text-sm text-gray-500 italic">
              No {mgr.isTls ? "certificate" : "host key"} information available yet.
              Connect to the server to retrieve it.
            </p>
          ) : (
            <>
              {/* Fingerprint */}
              <div className="bg-[var(--color-background)] rounded p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Fingerprint size={12} />
                  <span>Fingerprint (SHA-256)</span>
                </div>
                <p className="text-xs text-[var(--color-textSecondary)] font-mono break-all">
                  {formatFingerprint(mgr.identity.fingerprint)}
                </p>
              </div>

              {/* TLS-specific cert details */}
              {mgr.isCertIdentity(mgr.identity) && (
                <>
                  {mgr.identity.subject && (
                    <Row
                      icon={<Server size={12} />}
                      label="Subject"
                      value={mgr.identity.subject}
                    />
                  )}
                  {mgr.identity.issuer && (
                    <Row
                      icon={<FileKey size={12} />}
                      label="Issuer"
                      value={mgr.identity.issuer}
                    />
                  )}
                  {mgr.identity.serial && (
                    <Row
                      icon={<Key size={12} />}
                      label="Serial"
                      value={mgr.identity.serial}
                    />
                  )}
                  {mgr.identity.signatureAlgorithm && (
                    <Row
                      icon={<Shield size={12} />}
                      label="Algorithm"
                      value={mgr.identity.signatureAlgorithm}
                    />
                  )}
                  {mgr.identity.san && mgr.identity.san.length > 0 && (
                    <Row
                      icon={<Globe size={12} />}
                      label="SANs"
                      value={mgr.identity.san.join(", ")}
                    />
                  )}

                  {/* Validity */}
                  <div className="bg-[var(--color-background)] rounded p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock size={12} />
                      <span>Validity</span>
                    </div>
                    {mgr.identity.validFrom && (
                      <p className="text-xs text-[var(--color-textSecondary)]">
                        From:{" "}
                        <span className="text-[var(--color-textSecondary)]">
                          {new Date(mgr.identity.validFrom).toLocaleDateString()}
                        </span>
                      </p>
                    )}
                    {mgr.identity.validTo && (
                      <p className="text-xs text-[var(--color-textSecondary)]">
                        To:{" "}
                        <span
                          className={
                            mgr.isExpired(mgr.identity)
                              ? "text-red-400 font-medium"
                              : mgr.isExpiringSoon(mgr.identity)
                                ? "text-yellow-400 font-medium"
                                : "text-[var(--color-textSecondary)]"
                          }
                        >
                          {new Date(mgr.identity.validTo).toLocaleDateString()}
                          {mgr.isExpired(mgr.identity) && " (EXPIRED)"}
                          {mgr.isExpiringSoon(mgr.identity) && " (expiring soon)"}
                        </span>
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* SSH-specific host key details */}
              {!mgr.isCertIdentity(mgr.identity) && (
                <>
                  {(mgr.identity as SshHostKeyIdentity).keyType && (
                    <Row
                      icon={<Key size={12} />}
                      label="Key Type"
                      value={(mgr.identity as SshHostKeyIdentity).keyType!}
                    />
                  )}
                  {(mgr.identity as SshHostKeyIdentity).keyBits && (
                    <Row
                      icon={<Shield size={12} />}
                      label="Key Bits"
                      value={String((mgr.identity as SshHostKeyIdentity).keyBits)}
                    />
                  )}
                </>
              )}

              {/* First / last seen */}
              <div className="text-xs text-gray-500 space-y-0.5 pt-1 border-t border-[var(--color-border)]">
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
                  <summary className="text-gray-500 cursor-pointer hover:text-[var(--color-textSecondary)] flex items-center gap-1">
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
                        <p className="text-gray-500 mt-1">
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
      <span className="text-gray-500 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-gray-500 flex-shrink-0 w-16">{label}</span>
      <span className="text-[var(--color-textSecondary)] break-all">
        {value}
      </span>
    </div>
  );
}
