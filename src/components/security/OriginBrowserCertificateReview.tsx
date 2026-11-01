"use client";

import React, { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { useOriginCertificateReview } from "../../hooks/protocol/useOriginCertificateReview";
import { beginOriginBrowserConfirmation } from "../../hooks/protocol/originBrowserConfirmations";
import type { OriginCertificateReviewTransport } from "../../types/protocols/originBrowserCertificateReview";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";

/** Shell-owned themed review. Never mounted in, or delegated to, website content. */
export function OriginBrowserCertificateReview({
  transport,
}: {
  transport?: OriginCertificateReviewTransport;
}) {
  const review = useOriginCertificateReview({ transport });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const prompt = review.prompt;
  const waitingSession = prompt?.identity.sessionId;
  const certificate = prompt?.certificate;
  // The tab that asked stops presenting its native view and says why while
  // this review is open; the release runs on answer, expiry and unmount alike.
  useEffect(
    () =>
      waitingSession
        ? beginOriginBrowserConfirmation(waitingSession, "certificate")
        : undefined,
    [waitingSession, prompt?.requestId],
  );
  if (!prompt) return null;
  const cancel = () => {
    void review.respond(prompt, "cancel");
  };
  return (
    <Modal
      key={JSON.stringify([prompt.requestId, prompt.identity])}
      isOpen
      onClose={cancel}
      closeOnBackdrop={false}
      closeOnEscape={!review.submitting}
      initialFocusRef={cancelRef}
      ariaLabel="Review website certificate"
      dataTestId="origin-certificate-review"
      backdropClassName="p-4"
      panelClassName="flex max-h-[90dvh] w-full max-w-2xl mx-auto flex-col overflow-hidden"
    >
      <ModalHeader
        className="shrink-0"
        showCloseButton={false}
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert
              className="text-warning"
              size={22}
              aria-hidden="true"
            />
            Review website certificate
          </span>
        }
      />
      <ModalBody className="min-h-0 space-y-4 overflow-y-auto p-5 text-sm text-[var(--color-text)]">
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          The website certificate needs your review. Verify its fingerprint with
          the server administrator through a trusted channel before continuing.
          An unexpected certificate can indicate an intercepted connection.
        </p>
        <dl className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Requested website
            </dt>
            <dd className="mt-1 break-all font-mono font-medium select-text">
              {prompt.origin}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Reason for review
            </dt>
            <dd className="break-words">{prompt.reason}</dd>
          </div>
        </dl>
        {certificate ? (
          <section aria-label="Certificate details" className="space-y-3">
            <h3 className="font-medium">Certificate identity</h3>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[var(--color-textSecondary)]">Issued to</dt>
                <dd className="mt-1 break-words font-mono select-text">
                  {certificate.subject || "Not supplied"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-textSecondary)]">Issued by</dt>
                <dd className="mt-1 break-words font-mono select-text">
                  {certificate.issuer || "Not supplied"}
                </dd>
              </div>
              {(
                [
                  ["Valid from", certificate.validFrom],
                  ["Valid until", certificate.validTo],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[var(--color-textSecondary)]">{label}</dt>
                  <dd className="mt-1">
                    {value ? (
                      <time dateTime={value}>
                        {new Date(value).toLocaleString()}
                      </time>
                    ) : (
                      "Not reported"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <h4 className="text-xs font-medium">Certificate covers</h4>
              {certificate.dnsNames.length || certificate.ipAddresses.length ? (
                <ul
                  aria-label="Certificate names and addresses"
                  className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs"
                >
                  {certificate.dnsNames.map((name, index) => (
                    <li key={`dns:${index}`} className="flex items-start gap-2">
                      <span className="shrink-0 text-[var(--color-textMuted)]">
                        DNS
                      </span>
                      <span className="break-all font-mono select-text">
                        {name}
                      </span>
                    </li>
                  ))}
                  {certificate.ipAddresses.map((address, index) => (
                    <li key={`ip:${index}`} className="flex items-start gap-2">
                      <span className="shrink-0 text-[var(--color-textMuted)]">
                        IP
                      </span>
                      <span className="break-all font-mono select-text">
                        {address}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-textSecondary)]">
                  No DNS names or IP addresses were reported.
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--color-textMuted)]">
                Compare these names with the requested website. The reason for
                review above describes the reported verification issue.
              </p>
            </div>
          </section>
        ) : (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Certificate name and validity details were not reported by this
            runtime. Verify the fingerprint before continuing.
          </p>
        )}
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              SHA-256 fingerprint
            </dt>
            <dd className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 break-all font-mono text-xs select-text">
              {prompt.fingerprint}
            </dd>
          </div>
        </dl>
        <div className="space-y-2 rounded-lg bg-[var(--color-surface)] p-3 text-xs text-[var(--color-textSecondary)]">
          <p>
            <strong className="text-[var(--color-text)]">Allow once:</strong>{" "}
            continue for this request without saving a trust decision. A later
            request may ask again.
          </p>
          <p>
            {prompt.temporary ? (
              "Temporary connection: trust can be kept only for this browser attempt. Nothing is remembered in a database."
            ) : (
              <>
                <strong className="text-[var(--color-text)]">
                  Remember in Trust Center:
                </strong>{" "}
                save this exact certificate for this connection in its owning
                database and continue. Manage or remove the saved approval in
                Trust Center.
              </>
            )}
          </p>
          <p>
            These choices do not turn off certificate verification for other
            certificates or websites.
          </p>
        </div>
        <details className="text-xs text-[var(--color-textMuted)]">
          <summary className="cursor-pointer">Connection reference</summary>
          <p className="mt-1 break-all font-mono select-text">
            {prompt.identity.connectionId}
          </p>
        </details>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Review closes no later than{" "}
          {new Date(prompt.expiresAtUnixMs).toLocaleTimeString()}. The
          connection can time out sooner. No response cancels the request.
        </p>
        {review.error && (
          <p role="alert" className="text-sm text-error">
            {review.error}
          </p>
        )}
        {review.submitting && (
          <p role="status" className="text-xs">
            Sending certificate decision…
          </p>
        )}
      </ModalBody>
      <ModalFooter className="shrink-0 flex-wrap">
        <button
          type="button"
          ref={cancelRef}
          className="sor-btn sor-btn-secondary"
          disabled={review.submitting}
          onClick={cancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={review.submitting}
          onClick={() => void review.respond(prompt, "allow-once")}
        >
          Allow once
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={review.submitting}
          onClick={() => void review.respond(prompt, "remember")}
        >
          {prompt.temporary
            ? "Trust for this attempt"
            : "Remember in Trust Center"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
