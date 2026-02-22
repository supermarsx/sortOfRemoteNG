import React from 'react';
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
} from 'lucide-react';
import type { CertIdentity, SshHostKeyIdentity, TrustRecord } from '../utils/trustStore';
import { formatFingerprint } from '../utils/trustStore';

interface CertificateInfoPopupProps {
  type: 'tls' | 'ssh';
  host: string;
  port: number;
  /** Current identity from the live connection (if available) */
  currentIdentity?: CertIdentity | SshHostKeyIdentity;
  /** Stored trust record (if previously memorized) */
  trustRecord?: TrustRecord;
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
  onClose,
}) => {
  const isTls = type === 'tls';
  const identity = currentIdentity ?? trustRecord?.identity;

  const isCertIdentity = (id: CertIdentity | SshHostKeyIdentity): id is CertIdentity =>
    'issuer' in id || 'validFrom' in id || 'serial' in id;

  const isExpiringSoon = (id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    const daysLeft = (new Date(id.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysLeft > 0 && daysLeft <= 30;
  };

  const isExpired = (id: CertIdentity): boolean => {
    if (!id.validTo) return false;
    return new Date(id.validTo).getTime() < Date.now();
  };

  const getTrustStatus = () => {
    if (!trustRecord) return { label: 'Unknown', color: 'text-gray-400', icon: ShieldAlert };
    if (currentIdentity && trustRecord.identity.fingerprint !== currentIdentity.fingerprint) {
      return { label: 'Changed!', color: 'text-red-400', icon: ShieldAlert };
    }
    if (trustRecord.userApproved) {
      return { label: 'Trusted', color: 'text-green-400', icon: ShieldCheck };
    }
    return { label: 'Remembered', color: 'text-blue-400', icon: Shield };
  };

  const trustStatus = getTrustStatus();
  const TrustIcon = trustStatus.icon;

  return (
    <div className="absolute z-50 bottom-full left-0 mb-2 w-96 bg-gray-800 border border-gray-600 rounded-lg shadow-xl">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <TrustIcon size={16} className={trustStatus.color} />
          <span className="text-sm font-medium text-white">
            {isTls ? 'Certificate Information' : 'Host Key Information'}
          </span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {/* Connection info */}
        <div className="flex items-center gap-2 text-sm">
          <Globe size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-gray-300">{host}:{port}</span>
          <span className={`ml-auto text-xs font-medium ${trustStatus.color}`}>
            {trustStatus.label}
          </span>
        </div>

        {!identity ? (
          <p className="text-sm text-gray-500 italic">
            No {isTls ? 'certificate' : 'host key'} information available yet.
            Connect to the server to retrieve it.
          </p>
        ) : (
          <>
            {/* Fingerprint */}
            <div className="bg-gray-900 rounded p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Fingerprint size={12} />
                <span>Fingerprint (SHA-256)</span>
              </div>
              <p className="text-xs text-gray-300 font-mono break-all">
                {formatFingerprint(identity.fingerprint)}
              </p>
            </div>

            {/* TLS-specific cert details */}
            {isCertIdentity(identity) && (
              <>
                {identity.subject && (
                  <Row icon={<Server size={12} />} label="Subject" value={identity.subject} />
                )}
                {identity.issuer && (
                  <Row icon={<FileKey size={12} />} label="Issuer" value={identity.issuer} />
                )}
                {identity.serial && (
                  <Row icon={<Key size={12} />} label="Serial" value={identity.serial} />
                )}
                {identity.signatureAlgorithm && (
                  <Row icon={<Shield size={12} />} label="Algorithm" value={identity.signatureAlgorithm} />
                )}
                {identity.san && identity.san.length > 0 && (
                  <Row icon={<Globe size={12} />} label="SANs" value={identity.san.join(', ')} />
                )}

                {/* Validity */}
                <div className="bg-gray-900 rounded p-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Clock size={12} />
                    <span>Validity</span>
                  </div>
                  {identity.validFrom && (
                    <p className="text-xs text-gray-400">
                      From: <span className="text-gray-300">{new Date(identity.validFrom).toLocaleDateString()}</span>
                    </p>
                  )}
                  {identity.validTo && (
                    <p className="text-xs text-gray-400">
                      To: <span className={
                        isExpired(identity)
                          ? 'text-red-400 font-medium'
                          : isExpiringSoon(identity)
                            ? 'text-yellow-400 font-medium'
                            : 'text-gray-300'
                      }>
                        {new Date(identity.validTo).toLocaleDateString()}
                        {isExpired(identity) && ' (EXPIRED)'}
                        {isExpiringSoon(identity) && ' (expiring soon)'}
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
                  <Row icon={<Key size={12} />} label="Key Type" value={(identity as SshHostKeyIdentity).keyType!} />
                )}
                {(identity as SshHostKeyIdentity).keyBits && (
                  <Row icon={<Shield size={12} />} label="Key Bits" value={String((identity as SshHostKeyIdentity).keyBits)} />
                )}
              </>
            )}

            {/* First / last seen */}
            <div className="text-xs text-gray-500 space-y-0.5 pt-1 border-t border-gray-700">
              {identity.firstSeen && (
                <p>First seen: {new Date(identity.firstSeen).toLocaleString()}</p>
              )}
              {identity.lastSeen && (
                <p>Last seen: {new Date(identity.lastSeen).toLocaleString()}</p>
              )}
            </div>

            {/* History */}
            {trustRecord?.history && trustRecord.history.length > 0 && (
              <details className="text-xs">
                <summary className="text-gray-500 cursor-pointer hover:text-gray-400 flex items-center gap-1">
                  <AlertTriangle size={10} />
                  <span>{trustRecord.history.length} previous {trustRecord.history.length === 1 ? 'identity' : 'identities'}</span>
                </summary>
                <div className="mt-2 space-y-2">
                  {trustRecord.history.map((prev, i) => (
                    <div key={i} className="bg-gray-900/50 rounded p-2 border border-gray-700/50">
                      <p className="font-mono text-gray-400 break-all">
                        {formatFingerprint(prev.fingerprint)}
                      </p>
                      <p className="text-gray-500 mt-1">
                        Seen: {new Date(prev.firstSeen).toLocaleDateString()} — {new Date(prev.lastSeen).toLocaleDateString()}
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
  );
};

/** Helper: a single info row */
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-500 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-gray-500 flex-shrink-0 w-16">{label}</span>
      <span className="text-gray-300 break-all">{value}</span>
    </div>
  );
}
