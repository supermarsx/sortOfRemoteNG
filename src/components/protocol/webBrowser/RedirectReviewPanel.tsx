import React, { useState } from "react";
import {
  ArrowDown,
  ArrowRightLeft,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { useHttpRedirectReview } from "../../../hooks/protocol/useHttpRedirectReview";
import { CheckboxField } from "../../ui/forms";

type ReviewManager = Pick<
  ReturnType<typeof useHttpRedirectReview>,
  "review" | "busy" | "error" | "accept" | "cancel" | "offer"
> &
  Partial<
    Pick<
      ReturnType<typeof useHttpRedirectReview>,
      "authentication" | "redirectStep" | "maxRedirectHops"
    >
  >;

/** Redirect review belongs to the browser viewport, never a global modal. */
export default function RedirectReviewPanel({
  manager,
}: {
  manager: ReviewManager;
}) {
  const { review, busy, error, authentication } = manager;
  const [choice, setChoice] = useState<{
    receiptId: string;
    carry: boolean;
    insecureApproved: boolean;
  } | null>(null);
  const current = choice?.receiptId === review?.receiptId ? choice : null;
  const carry = authentication?.available === true && (current?.carry ?? true);
  const insecureApproved = current?.insecureApproved === true;
  const change = (
    values: Partial<{ carry: boolean; insecureApproved: boolean }>,
  ) => {
    if (review)
      setChoice({
        receiptId: review.receiptId,
        carry,
        insecureApproved,
        ...values,
      });
  };
  if (!review && !error) return null;
  const insecure = review?.destinationUrl.startsWith("http:") === true;
  const downgrade = insecure && review?.sourceOrigin.startsWith("https:");
  return (
    <section
      role="region"
      aria-label="Redirect review"
      className="h-full min-h-0 overflow-y-auto bg-[var(--color-background)] text-[var(--color-text)]"
    >
      <div className="mx-auto w-full max-w-2xl space-y-5 p-5 sm:p-8">
        <header className="flex items-start gap-3">
          <ArrowRightLeft
            size={24}
            aria-hidden="true"
            className="mt-1 shrink-0 text-[var(--color-textSecondary)]"
          />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">
              {review
                ? "Review redirect destination"
                : "Redirect review unavailable"}
            </h1>
            <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
              {review
                ? "This website wants to send you to a different address. Check the destination before continuing."
                : "No destination was opened. Return to the page and retry the navigation."}
            </p>
          </div>
        </header>
        {review && (
          <>
            {manager.redirectStep !== undefined &&
              manager.maxRedirectHops !== undefined && (
                <p
                  role="status"
                  className="text-xs text-[var(--color-textSecondary)]"
                >
                  Redirect {manager.redirectStep} of {manager.maxRedirectHops}{" "}
                  maximum. Reverse proxies can redirect through several
                  addresses; review each destination before continuing.
                </p>
              )}
            <dl className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
              <div className="min-w-0 px-4 pt-4 pb-3">
                <dt className="mb-1.5 text-xs font-medium text-[var(--color-textSecondary)]">
                  From
                </dt>
                <dd
                  dir="ltr"
                  className="max-h-20 overflow-auto break-all font-mono text-xs leading-relaxed"
                >
                  {review.sourceOrigin}
                </dd>
              </div>
              <div className="min-w-0 border-t border-[var(--color-border)] px-4 py-4">
                <dt className="mb-1.5 flex items-center gap-2 text-xs font-medium text-[var(--color-textSecondary)]">
                  <ArrowDown size={14} aria-hidden="true" />
                  To
                </dt>
                <dd
                  dir="ltr"
                  className="max-h-32 overflow-auto break-all font-mono text-sm leading-relaxed"
                >
                  {review.destinationUrl}
                </dd>
              </div>
            </dl>
            {insecure && (
              <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                <TriangleAlert
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-warning"
                />
                <div className="min-w-0 space-y-1.5 leading-relaxed">
                  <p className="font-medium text-warning">
                    {downgrade
                      ? "HTTPS to unencrypted HTTP"
                      : "Unencrypted HTTP"}
                  </p>
                  <p>
                    {downgrade
                      ? "This redirect reduces connection security. "
                      : "Both addresses use HTTP. "}
                    Information you enter at the destination is not protected by
                    TLS. Continue only if you understand and trust this
                    destination.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-3 text-sm leading-relaxed">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={18}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]"
                />
                <div className="space-y-1">
                  <p className="font-medium">Choose where to continue</p>
                  <p className="text-[var(--color-textSecondary)]">
                    Continue in this tab or open a separate anonymous tab.
                    Either choice closes the source proxy. Cookies, form bodies,
                    custom headers, MFA secrets and automation scripts are not
                    transferred. The anonymous option always starts signed out.
                  </p>
                </div>
              </div>
              {!insecure && (
                <p className="flex items-start gap-3 text-[var(--color-textSecondary)]">
                  <LockKeyhole
                    size={18}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    The destination gets a fresh HTTPS certificate trust check.
                  </span>
                </p>
              )}
            </div>
            {authentication?.configured && (
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <CheckboxField
                  variant="form"
                  label="Use saved login when continuing in this tab"
                  checked={carry}
                  disabled={busy || !authentication.available}
                  onChange={(value) =>
                    change({ carry: value, insecureApproved: false })
                  }
                  description="Only the configured username/password or application form login is carried forward. Each additional redirect still needs review; this stops after five handoffs."
                />
                {!authentication.available && (
                  <p className="text-xs text-[var(--color-textSecondary)]">
                    {authentication.reason}
                  </p>
                )}
                {carry && insecure && (
                  <CheckboxField
                    variant="form"
                    checked={insecureApproved}
                    disabled={busy}
                    onChange={(value) => change({ insecureApproved: value })}
                    label="I approve sending this saved login over unencrypted HTTP"
                    aria-label="I approve sending this saved login over unencrypted HTTP"
                    description="The destination and anyone monitoring this network could receive the password. This approval applies only to the address shown above."
                  />
                )}
              </div>
            )}
            {review.removedQuery && (
              <p className="rounded-lg border border-[var(--color-border)] p-3 text-xs leading-relaxed text-[var(--color-textSecondary)]">
                Query parameters and the URL fragment were removed. Some SSO or
                portal handoffs may require manual sign-in.
              </p>
            )}
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-error/30 bg-error/5 p-3 text-sm leading-relaxed text-error break-words"
          >
            {error}
          </p>
        )}
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border)] pt-5">
          <button
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={manager.cancel}
          >
            {review ? "Stay here" : "Back to page"}
          </button>
          {review && (
            <>
              <button
                className="sor-btn sor-btn-secondary"
                disabled={busy}
                onClick={() => void manager.accept("anonymous")}
              >
                Open anonymous tab
              </button>
              <button
                className="sor-btn sor-btn-primary"
                disabled={busy || (carry && insecure && !insecureApproved)}
                onClick={() =>
                  void manager.accept("current", carry, insecureApproved)
                }
              >
                {busy ? "Opening…" : "Continue in this tab"}
              </button>
            </>
          )}
        </footer>
      </div>
    </section>
  );
}
