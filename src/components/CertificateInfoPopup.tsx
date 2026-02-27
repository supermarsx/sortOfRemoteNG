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
} from "lucide-react";
import type {
  CertIdentity,
  SshHostKeyIdentity,
  TrustRecord,
} from "../utils/trustStore";
import {
  formatFingerprint,
  updateTrustRecordNickname,
} from "../utils/trustStore";
import { PopoverSurface } from "./ui/PopoverSurface";

interface CertificateInfoPopupProps {
  type: "tls" | "ssh";
  host: string;
  port: number;
  /** Current identity from the live connection (if available) */
  currentIdentity?: CertIdentity | SshHostKeyIdentity;
  /** Stored trust record (if previously memorized) */
  trustRecord?: TrustRecord;
  /** Connection ID owning this trust record (for per-connection stores) */
  connectionId?: string;
  /** Ref to the trigger element — popup positions itself below it */
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * A popup that shows certificate/host-key details when the user clicks/hovers
 * the lock icon in the URL bar (TLS) or the fingerprint icon in the terminal
 * toolbar (SSH).
 */
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
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(trustRecord?.nickname ?? "");
  const [savedNick, setSavedNick] = useState(trustRecord?.nickname ?? "");

  const isTls = type === "tls";
  const identity = currentIdentity ?? trustRecord?.identity;

  const isCertIdentity = (
    id: CertIdentity | SshHostKeyIdentity,
  ): id is CertIdentity =>
    "issuer" in id || "validFrom" in id || "serial" in id;

  const isExpiringSoon = (id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    const daysLeft =
      (new Date(id.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysLeft > 0 && daysLeft <= 5;
  };

  const isExpired = (id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    return new Date(id.validTo).getTime() < Date.now();
  };

  const getTrustStatus = () => {
    if (!trustRecord)
      return {
        label: "Unknown",
        color: "text-[var(--color-textSecondary)]",
        icon: ShieldAlert,
      };
    if (
      currentIdentity &&
      trustRecord.identity.fingerprint !== currentIdentity.fingerprint
    ) {
      return { label: "Changed!", color: "text-red-400", icon: ShieldAlert };
    }
    if (trustRecord.userApproved) {
      return { label: "Trusted", color: "text-green-400", icon: ShieldCheck };
    }
    return { label: "Remembered", color: "text-blue-400", icon: Shield };
  };

  const trustStatus = getTrustStatus();
  const TrustIcon = trustStatus.icon;

  if (!triggerRef) return null;

  return (
    <PopoverSurface
      isOpen
      onClose={onClose}
      anchorRef={triggerRef}
      align="start"
      offset={4}
      className="sor-popover-surface z-[99999] w-96 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-y-auto"
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
              {isTls ? "Certificate Information" : "Host Key Information"}
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
              {editingNick ? (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={nickDraft}
                    onChange={(e) => setNickDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        updateTrustRecordNickname(
                          host,
                          port,
                          type,
                          nickDraft.trim(),
                          connectionId,
                        );
                        setSavedNick(nickDraft.trim());
                        setEditingNick(false);
                      } else if (e.key === "Escape") {
                        setNickDraft(savedNick);
                        setEditingNick(false);
                      }
                    }}
                    placeholder="Add a nickname…"
                    className="flex-1 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                  />
                  <button
                    onClick={() => {
                      updateTrustRecordNickname(
                        host,
                        port,
                        type,
                        nickDraft.trim(),
                        connectionId,
                      );
                      setSavedNick(nickDraft.trim());
                      setEditingNick(false);
                    }}
                    className="text-green-400 hover:text-green-300 p-0.5"
                    title="Save"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => {
                      setNickDraft(savedNick);
                      setEditingNick(false);
                    }}
                    className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Cancel"
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-gray-500 italic truncate">
                    {savedNick || "No nickname"}
                  </span>
                  <button
                    onClick={() => {
                      setNickDraft(savedNick);
                      setEditingNick(true);
                    }}
                    className="text-gray-500 hover:text-[var(--color-textSecondary)] p-0.5"
                    title="Edit nickname"
                  >
                    <Pencil size={10} />
                  </button>
                </>
              )}
            </div>
          )}

          {!identity ? (
            <p className="text-sm text-gray-500 italic">
              No {isTls ? "certificate" : "host key"} information available yet.
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
                  {formatFingerprint(identity.fingerprint)}
                </p>
              </div>

              {/* TLS-specific cert details */}
              {isCertIdentity(identity) && (
                <>
                  {identity.subject && (
                    <Row
                      icon={<Server size={12} />}
                      label="Subject"
                      value={identity.subject}
                    />
                  )}
                  {identity.issuer && (
                    <Row
                      icon={<FileKey size={12} />}
                      label="Issuer"
                      value={identity.issuer}
                    />
                  )}
                  {identity.serial && (
                    <Row
                      icon={<Key size={12} />}
                      label="Serial"
                      value={identity.serial}
                    />
                  )}
                  {identity.signatureAlgorithm && (
                    <Row
                      icon={<Shield size={12} />}
                      label="Algorithm"
                      value={identity.signatureAlgorithm}
                    />
                  )}
                  {identity.san && identity.san.length > 0 && (
                    <Row
                      icon={<Globe size={12} />}
                      label="SANs"
                      value={identity.san.join(", ")}
                    />
                  )}

                  {/* Validity */}
                  <div className="bg-[var(--color-background)] rounded p-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock size={12} />
                      <span>Validity</span>
                    </div>
                    {identity.validFrom && (
                      <p className="text-xs text-[var(--color-textSecondary)]">
                        From:{" "}
                        <span className="text-[var(--color-textSecondary)]">
                          {new Date(identity.validFrom).toLocaleDateString()}
                        </span>
                      </p>
                    )}
                    {identity.validTo && (
                      <p className="text-xs text-[var(--color-textSecondary)]">
                        To:{" "}
                        <span
                          className={
                            isExpired(identity)
                              ? "text-red-400 font-medium"
                              : isExpiringSoon(identity)
                                ? "text-yellow-400 font-medium"
                                : "text-[var(--color-textSecondary)]"
                          }
                        >
                          {new Date(identity.validTo).toLocaleDateString()}
                          {isExpired(identity) && " (EXPIRED)"}
                          {isExpiringSoon(identity) && " (expiring soon)"}
                        </span>
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* SSH-specific host key details */}
              {!isCertIdentity(identity) && (
                <>
                  {(identity as SshHostKeyIdentity).keyType && (
                    <Row
                      icon={<Key size={12} />}
                      label="Key Type"
                      value={(identity as SshHostKeyIdentity).keyType!}
                    />
                  )}
                  {(identity as SshHostKeyIdentity).keyBits && (
                    <Row
                      icon={<Shield size={12} />}
                      label="Key Bits"
                      value={String((identity as SshHostKeyIdentity).keyBits)}
                    />
                  )}
                </>
              )}

              {/* First / last seen */}
              <div className="text-xs text-gray-500 space-y-0.5 pt-1 border-t border-[var(--color-border)]">
                {identity.firstSeen && (
                  <p>
                    First seen: {new Date(identity.firstSeen).toLocaleString()}
                  </p>
                )}
                {identity.lastSeen && (
                  <p>
                    Last seen: {new Date(identity.lastSeen).toLocaleString()}
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
