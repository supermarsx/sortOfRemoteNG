import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Fingerprint,
  ArrowRight,
} from 'lucide-react';
import type { CertIdentity, SshHostKeyIdentity } from '../utils/trustStore';
import { formatFingerprint } from '../utils/trustStore';

interface TrustWarningDialogProps {
  type: 'tls' | 'ssh';
  host: string;
  port: number;
  /**
   * 'first-use': identity has never been seen — ask user to trust it.
   * 'mismatch': identity differs from what was stored — potential MITM.
   */
  reason: 'first-use' | 'mismatch';
  /** The identity presented by the remote server right now */
  receivedIdentity: CertIdentity | SshHostKeyIdentity;
  /** The previously stored identity (only for 'mismatch') */
  storedIdentity?: CertIdentity | SshHostKeyIdentity;
  /** Called when user chooses to trust & continue */
  onAccept: () => void;
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
  const isMismatch = reason === 'mismatch';
  const isTls = type === 'tls';
  const identityLabel = isTls ? 'certificate' : 'host key';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
      <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className={`flex items-center gap-3 px-6 py-4 border-b ${
          isMismatch ? 'border-red-700/50 bg-red-900/20' : 'border-yellow-700/50 bg-yellow-900/20'
        } rounded-t-xl`}>
          {isMismatch ? (
            <ShieldAlert size={28} className="text-red-400 flex-shrink-0" />
          ) : (
            <ShieldCheck size={28} className="text-yellow-400 flex-shrink-0" />
          )}
          <div>
            <h2 className={`text-lg font-semibold ${isMismatch ? 'text-red-300' : 'text-yellow-300'}`}>
              {isMismatch
                ? `${isTls ? 'Certificate' : 'Host Key'} Has Changed!`
                : `Unknown ${isTls ? 'Certificate' : 'Host Key'}`
              }
            </h2>
            <p className="text-sm text-gray-400">{host}:{port}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {isMismatch ? (
            <>
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-700/40 rounded-lg">
                <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-red-300">
                  <p className="font-medium">
                    The {identityLabel} presented by this server has changed since the last connection.
                  </p>
                  <p className="mt-1 text-red-300/80">
                    This could indicate a man-in-the-middle attack, or the server&apos;s {identityLabel} was
                    legitimately rotated. Proceed only if you trust this change.
                  </p>
                </div>
              </div>

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-2 gap-3">
                {/* Previously stored */}
                <div className="bg-gray-900 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium mb-2">Previously Stored</p>
                  <div className="flex items-center gap-1 mb-1">
                    <Fingerprint size={10} className="text-gray-500" />
                    <span className="text-[10px] text-gray-500">Fingerprint</span>
                  </div>
                  <p className="text-[11px] font-mono text-gray-400 break-all">
                    {storedIdentity ? formatFingerprint(storedIdentity.fingerprint) : '—'}
                  </p>
                  {storedIdentity?.lastSeen && (
                    <p className="text-[10px] text-gray-500 mt-2">
                      Last seen: {new Date(storedIdentity.lastSeen).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Received now */}
                <div className="bg-gray-900 rounded-lg p-3 border border-red-700/30">
                  <p className="text-xs text-red-400 font-medium mb-2">Received Now</p>
                  <div className="flex items-center gap-1 mb-1">
                    <Fingerprint size={10} className="text-gray-500" />
                    <span className="text-[10px] text-gray-500">Fingerprint</span>
                  </div>
                  <p className="text-[11px] font-mono text-red-300 break-all">
                    {formatFingerprint(receivedIdentity.fingerprint)}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-300">
                The server at <span className="text-yellow-400 font-medium">{host}:{port}</span> presented
                a {identityLabel} that has not been seen before.
              </p>
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                  <Fingerprint size={12} />
                  <span>Fingerprint (SHA-256)</span>
                </div>
                <p className="text-xs font-mono text-gray-300 break-all">
                  {formatFingerprint(receivedIdentity.fingerprint)}
                </p>
              </div>
              <p className="text-xs text-gray-400">
                If you trust this server, accept the {identityLabel} to remember it for future
                connections. Any change to this {identityLabel} will trigger a warning.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onReject}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Disconnect
          </button>
          <button
            onClick={onAccept}
            className={`flex items-center gap-2 px-4 py-2 text-sm text-white rounded-lg transition-colors ${
              isMismatch
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {isMismatch ? (
              <>
                <AlertTriangle size={14} />
                <span>Trust New {isTls ? 'Certificate' : 'Key'} &amp; Continue</span>
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
    </div>
  );
};
