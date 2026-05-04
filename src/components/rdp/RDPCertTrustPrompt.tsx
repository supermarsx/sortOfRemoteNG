import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ShieldAlert, ShieldCheck, ShieldX, AlertTriangle } from "lucide-react";
import { Modal } from "../ui/overlays/Modal";

interface CertTrustPrompt {
  sessionId?: string;
  kind: "Unknown" | "Changed";
  host: string;
  port: number;
  fingerprint: string;
  previousFingerprint?: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serial: string;
  signatureAlgorithm: string;
  san: string[];
  pem: string;
  chainValid: boolean;
  validationError?: string;
  timeoutSecs: number;
}

const formatFingerprint = (fp: string): string => {
  const clean = fp.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return clean.match(/.{1,2}/g)?.join(":") ?? clean;
};

export const RDPCertTrustPrompt: React.FC = () => {
  const [prompt, setPrompt] = useState<CertTrustPrompt | null>(null);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let mounted = true;

    const setup = async () => {
      const handle = (event: { payload: CertTrustPrompt }) => {
        if (!mounted) return;
        setPrompt(event.payload);
        setRemember(event.payload.kind === "Unknown");
        setSecondsLeft(event.payload.timeoutSecs);
      };

      const u1 = await listen<CertTrustPrompt>("rdp://cert-trust-prompt", handle);
      const u2 = await listen<CertTrustPrompt>("rdp://cert-trust-change", handle);
      unlisteners.push(u1, u2);
    };

    void setup();
    return () => {
      mounted = false;
      for (const u of unlisteners) u();
    };
  }, []);

  // Countdown so the user knows the backend will time out.
  useEffect(() => {
    if (!prompt || secondsLeft === null) return;
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(id);
  }, [prompt, secondsLeft]);

  const respond = async (decision: "approve" | "reject") => {
    if (!prompt || submitting) return;
    setSubmitting(true);
    try {
      await invoke("rdp_cert_trust_respond", {
        payload: {
          sessionId: prompt.sessionId,
          host: prompt.host,
          port: prompt.port,
          fingerprint: prompt.fingerprint,
          decision,
          remember: decision === "approve" ? remember : false,
        },
      });
    } catch (error) {
      console.error("Failed to submit cert trust decision:", error);
    } finally {
      setSubmitting(false);
      setPrompt(null);
      setSecondsLeft(null);
    }
  };

  if (!prompt) return null;

  const isChanged = prompt.kind === "Changed";
  const headerIcon = isChanged ? (
    <ShieldX className="w-6 h-6 text-error" />
  ) : (
    <ShieldAlert className="w-6 h-6 text-warning" />
  );
  const headerColor = isChanged ? "bg-error/20" : "bg-warning/20";
  const title = isChanged
    ? "Server certificate has changed"
    : "Untrusted server certificate";

  return (
    <Modal
      isOpen
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="z-[200] bg-black/70 p-4"
      panelClassName="max-w-2xl mx-4"
    >
      <div className="bg-[var(--color-surface)] rounded-xl p-6 w-full border border-[var(--color-border)] shadow-2xl">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-full ${headerColor} flex-shrink-0`}>
            {headerIcon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
              {title}
            </h3>
            <p className="text-sm text-[var(--color-textSecondary)] mb-4">
              {isChanged ? (
                <>
                  The certificate for <strong>{prompt.host}:{prompt.port}</strong>{" "}
                  doesn&apos;t match the one previously trusted. This can be a
                  legitimate cert rotation — or an active man-in-the-middle. Verify
                  the new fingerprint with the server admin before approving.
                </>
              ) : (
                <>
                  The certificate presented by <strong>{prompt.host}:{prompt.port}</strong>{" "}
                  isn&apos;t trusted by your system. This is normal for self-signed
                  or internal-CA hosts. Verify the fingerprint with the server admin
                  before approving.
                </>
              )}
            </p>

            {prompt.validationError && (
              <div className="mb-4 px-3 py-2 rounded bg-warning/10 border border-warning/30 text-xs text-[var(--color-text)]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                  <span>{prompt.validationError}</span>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs mb-4">
              <dt className="text-[var(--color-textMuted)]">Subject</dt>
              <dd className="text-[var(--color-text)] break-all font-mono">{prompt.subject}</dd>
              <dt className="text-[var(--color-textMuted)]">Issuer</dt>
              <dd className="text-[var(--color-text)] break-all font-mono">{prompt.issuer}</dd>
              <dt className="text-[var(--color-textMuted)]">Valid</dt>
              <dd className="text-[var(--color-text)] font-mono">
                {prompt.validFrom} — {prompt.validTo}
              </dd>
              <dt className="text-[var(--color-textMuted)]">Serial</dt>
              <dd className="text-[var(--color-text)] break-all font-mono">{prompt.serial}</dd>
              <dt className="text-[var(--color-textMuted)]">Algorithm</dt>
              <dd className="text-[var(--color-text)] font-mono">{prompt.signatureAlgorithm}</dd>
              {prompt.san.length > 0 && (
                <>
                  <dt className="text-[var(--color-textMuted)]">SAN</dt>
                  <dd className="text-[var(--color-text)] break-all font-mono">
                    {prompt.san.join(", ")}
                  </dd>
                </>
              )}
              <dt className="text-[var(--color-textMuted)]">Fingerprint</dt>
              <dd className="text-[var(--color-text)] break-all font-mono select-all">
                {formatFingerprint(prompt.fingerprint)}
              </dd>
              {prompt.previousFingerprint && (
                <>
                  <dt className="text-[var(--color-textMuted)]">Previous</dt>
                  <dd className="text-error break-all font-mono select-all">
                    {formatFingerprint(prompt.previousFingerprint)}
                  </dd>
                </>
              )}
              <dt className="text-[var(--color-textMuted)]">Chain</dt>
              <dd>
                {prompt.chainValid ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <ShieldCheck className="w-3 h-3" /> Valid
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <ShieldAlert className="w-3 h-3" /> Not validated
                  </span>
                )}
              </dd>
            </dl>

            <label className="flex items-center gap-2 text-sm text-[var(--color-text)] mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded"
              />
              Remember this certificate for {prompt.host}:{prompt.port}
            </label>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--color-textMuted)]">
                {secondsLeft !== null && secondsLeft > 0
                  ? `Auto-rejects in ${secondsLeft}s`
                  : ""}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => respond("reject")}
                  disabled={submitting}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => respond("approve")}
                  disabled={submitting}
                  className={`px-4 py-2 text-sm rounded-lg text-white transition-colors disabled:opacity-50 ${
                    isChanged
                      ? "bg-error hover:bg-error/90"
                      : "bg-warning hover:bg-warning/90"
                  }`}
                >
                  {isChanged ? "Approve change" : "Approve"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default RDPCertTrustPrompt;
