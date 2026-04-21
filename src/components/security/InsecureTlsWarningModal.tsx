import React, { useState } from "react";
import { ShieldAlert, AlertTriangle, ArrowRight } from "lucide-react";
import { Modal } from "../ui/overlays/Modal";

/** Kind of connection the insecure-TLS warning is being raised for. */
export type InsecureTlsConnectionKind = "bmc" | "cicd" | "k8s";

export interface InsecureTlsWarningModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Which connection category is insecure. */
  kind: InsecureTlsConnectionKind;
  /** Human-readable endpoint (e.g. `https://idrac.lab:443`). */
  endpoint: string;
  /** Optional name of the connection profile. */
  connectionName?: string;
  /** Called when the user explicitly acknowledges & wants to proceed. */
  onAcknowledge: () => void;
  /** Called when the user cancels / closes. */
  onCancel: () => void;
}

const kindLabels: Record<InsecureTlsConnectionKind, string> = {
  bmc: "BMC / Redfish",
  cicd: "CI/CD",
  k8s: "Kubernetes",
};

/**
 * Modal warning shown when a connection configuration has TLS certificate
 * verification disabled (`tls_skip_verify` / `insecure_skip_verify` /
 * `danger_accept_invalid_certs`).
 *
 * The user must check the "I understand" box and click "Continue insecurely"
 * to acknowledge.  The parent is responsible for persisting the ack via the
 * `useInsecureTlsAck` hook so the warning isn't shown again for the same
 * config id.
 */
export const InsecureTlsWarningModal: React.FC<InsecureTlsWarningModalProps> = ({
  isOpen,
  kind,
  endpoint,
  connectionName,
  onAcknowledge,
  onCancel,
}) => {
  const [understood, setUnderstood] = useState(false);

  if (!isOpen) {
    return null;
  }

  const label = kindLabels[kind];

  return (
    <Modal
      isOpen
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/60 p-4"
      panelClassName="max-w-lg mx-4"
      dataTestId="insecure-tls-warning-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="insecure-tls-title"
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-full"
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-error/50 bg-error/20 rounded-t-xl">
          <ShieldAlert size={28} className="text-error flex-shrink-0" />
          <div>
            <h2
              id="insecure-tls-title"
              className="text-lg font-semibold text-error"
            >
              Insecure TLS connection
            </h2>
            <p className="text-sm text-[var(--color-textSecondary)]">
              {connectionName ? `${connectionName} — ` : ""}
              {endpoint}
            </p>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-start gap-2 p-3 bg-error/20 border border-error/40 rounded-lg">
            <AlertTriangle
              size={16}
              className="text-error flex-shrink-0 mt-0.5"
            />
            <div className="text-sm text-error">
              <p className="font-medium">
                TLS certificate verification is disabled for this {label}{" "}
                connection.
              </p>
              <p className="mt-1 text-error/80">
                Traffic may be intercepted or tampered with by a
                man-in-the-middle.  Only continue if you trust the network
                path between this machine and{" "}
                <span className="font-mono">{endpoint}</span>.
              </p>
            </div>
          </div>

          <p className="text-xs text-[var(--color-textSecondary)]">
            You only need to acknowledge this once per connection
            configuration. The decision is stored locally and a warning
            breadcrumb is logged server-side on every insecure request.
          </p>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="rounded border-[var(--color-border)]"
              aria-label="I understand the risks"
            />
            <span className="text-sm text-[var(--color-textSecondary)]">
              I understand the risks and still want to connect.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] bg-[var(--color-border)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!understood}
            onClick={onAcknowledge}
            className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--color-text)] rounded-lg transition-colors bg-error hover:bg-error/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowRight size={14} />
            <span>Continue insecurely</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default InsecureTlsWarningModal;
