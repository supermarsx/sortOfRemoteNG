"use client";

import React, { useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { useOriginCertificateReview } from "../../hooks/protocol/useOriginCertificateReview";
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
      panelClassName="max-w-xl mx-auto"
    >
      <ModalHeader
        showCloseButton={false}
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert className="text-warning" size={22} />
            Review website certificate
          </span>
        }
      />
      <ModalBody className="space-y-4 p-5 text-sm text-[var(--color-text)]">
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          The website certificate needs your review. Verify its fingerprint with
          the server administrator through a trusted channel before continuing.
          An unexpected certificate can indicate an intercepted connection.
        </p>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Website origin
            </dt>
            <dd className="break-all font-mono select-text">{prompt.origin}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Reason for review
            </dt>
            <dd className="break-words">{prompt.reason}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Certificate fingerprint
            </dt>
            <dd className="mt-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 break-all font-mono text-xs select-text">
              {prompt.fingerprint}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-textSecondary)]">
              Connection
            </dt>
            <dd className="break-all font-mono text-xs">
              {prompt.identity.connectionId}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-[var(--color-textSecondary)]">
          {prompt.temporary
            ? "Temporary connection: trust can be kept only for this browser attempt. Nothing is remembered in a database."
            : "Remember saves trust for this exact certificate in the connection's owning database."}{" "}
          Allow once does not save a trust decision.
        </p>
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
      <ModalFooter className="flex-wrap">
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
            : "Remember and continue"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
