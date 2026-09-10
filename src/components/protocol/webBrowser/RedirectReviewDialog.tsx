import React from "react";
import type { useHttpRedirectReview } from "../../../hooks/protocol/useHttpRedirectReview";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../../ui/overlays/Modal";

export default function RedirectReviewDialog({
  manager,
}: {
  manager: ReturnType<typeof useHttpRedirectReview>;
}) {
  const { review, busy, error } = manager;
  const downgrade =
    review?.sourceOrigin.startsWith("https:") &&
    review.destinationUrl.startsWith("http:");
  if (!review && !error) return null;
  return (
    <Modal
      isOpen
      onClose={busy ? undefined : manager.cancel}
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      panelClassName="max-w-xl mx-4"
    >
      <ModalHeader
        title={
          review ? "Review redirect destination" : "Redirect review unavailable"
        }
        onClose={busy ? undefined : manager.cancel}
      />
      <ModalBody className="space-y-4">
        {review && (
          <>
            <dl className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm">
              <div>
                <dt className="mb-1 text-xs text-[var(--color-textMuted)]">
                  From
                </dt>
                <dd className="max-h-20 overflow-auto break-all font-mono">
                  {review.sourceOrigin}
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs text-[var(--color-textMuted)]">
                  To
                </dt>
                <dd className="max-h-32 overflow-auto break-all font-mono">
                  {review.destinationUrl}
                </dd>
              </div>
            </dl>
            <p className="text-sm">
              Open a new anonymous tab and close the source proxy. Saved website
              credentials, cookies, form bodies, custom headers and automation
              are not transferred.
            </p>
            {review.destinationUrl.startsWith("https:") ? (
              <p className="text-sm text-[var(--color-textMuted)]">
                The destination gets a fresh HTTPS certificate trust check.
              </p>
            ) : (
              <p className="rounded border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                {downgrade
                  ? "SECURITY DOWNGRADE: HTTPS to unencrypted HTTP. "
                  : "Unencrypted HTTP: the source and destination both use HTTP. "}
                Information you enter in the new tab is not protected by TLS.
              </p>
            )}
            {review.removedQuery && (
              <p className="text-sm text-warning">
                Query parameters and the URL fragment were removed. Some SSO or
                portal handoffs may require manual sign-in.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          className="sor-btn sor-btn-secondary"
          disabled={busy}
          onClick={manager.cancel}
        >
          {review ? "Stay here" : "Close"}
        </button>
        {review && (
          <button
            className="sor-btn sor-btn-primary"
            disabled={busy}
            onClick={() => void manager.accept()}
          >
            {busy ? "Opening…" : "Open anonymous tab"}
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
