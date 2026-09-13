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
import progressStyles from "./NavigationProgress.module.css";

type ReviewManager = Pick<
  ReturnType<typeof useHttpRedirectReview>,
  "review" | "busy" | "error" | "accept" | "cancel" | "offer"
> &
  Partial<
    Pick<
      ReturnType<typeof useHttpRedirectReview>,
      "authentication" | "redirectStep" | "maxRedirectHops"
    >
  > & {
    trustedDestination?: boolean;
    defaultDestination?: boolean;
    canRememberDestination?: boolean;
    rememberUnavailableReason?: string;
    rememberingDestination?: boolean;
    rememberDestination?: () => Promise<void>;
    trustNotice?: string;
    continuingAutomatically?: boolean;
  };

/** Redirect review belongs to the browser viewport, never a global modal. */
export default function RedirectReviewPanel({
  manager,
  onReload,
}: {
  manager: ReviewManager;
  onReload?: () => void;
}) {
  const { review, busy, error, authentication } = manager;
  const acting = busy || manager.rememberingDestination === true;
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
  if (review && !error && manager.continuingAutomatically) {
    return (
      <section
        role="region"
        aria-label="Redirect continuation"
        aria-busy="true"
        className="relative h-full bg-[var(--color-background)] text-[var(--color-text)]"
      >
        <div className={progressStyles.track} aria-hidden="true">
          <span className={progressStyles.segment} />
        </div>
        <p
          role="status"
          className="p-5 text-sm text-[var(--color-textSecondary)]"
        >
          Continuing to approved destination…
        </p>
      </section>
    );
  }
  const insecure = review?.destinationUrl.startsWith("http:") === true;
  const downgrade = insecure && review?.sourceOrigin.startsWith("https:");
  let destinationOrigin: string | null = null;
  try {
    if (review) {
      const destination = new URL(review.destinationUrl);
      if (
        ["http:", "https:"].includes(destination.protocol) &&
        !destination.username &&
        !destination.password
      )
        destinationOrigin = destination.origin;
    }
  } catch {
    // The hook validates receipts. A malformed presentation fixture must never
    // display a plausible trusted origin or enable the persistence action.
  }
  const canRemember =
    !!destinationOrigin &&
    manager.canRememberDestination === true &&
    typeof manager.rememberDestination === "function";
  const trusted = manager.trustedDestination === true;
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
                ? trusted
                  ? authentication?.configured
                    ? "Review sign-in options"
                    : "Destination trusted"
                  : "Review redirect destination"
                : "Redirect review unavailable"}
            </h1>
            <p className="text-sm leading-relaxed text-[var(--color-textSecondary)]">
              {review
                ? trusted
                  ? authentication?.configured
                    ? "This destination is already trusted. Choose whether to use your saved login; destination trust does not grant permission to send credentials."
                    : "This destination is saved. Choose how to continue this handoff; future redirects to this exact origin will not need another destination review."
                  : "This website wants to send you to a different address. Check the destination before continuing."
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
                  addresses; only untrusted destinations need another address
                  review. Sign-in permissions are checked separately.
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
            {destinationOrigin && (
              <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-[var(--color-textSecondary)]">
                      Destination origin
                    </p>
                    <p dir="ltr" className="break-all font-mono text-xs">
                      {destinationOrigin}
                    </p>
                  </div>
                  {manager.defaultDestination === true ? (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]">
                      <ShieldCheck size={15} aria-hidden="true" />
                      Built-in Synology destination
                    </span>
                  ) : manager.trustedDestination === true ? (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--color-textSecondary)]">
                      <ShieldCheck size={15} aria-hidden="true" />
                      Trusted for this saved connection
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary"
                      disabled={acting || !canRemember}
                      onClick={() => void manager.rememberDestination?.()}
                    >
                      {manager.rememberingDestination
                        ? "Saving destination…"
                        : "Trust destination"}
                    </button>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
                  {manager.defaultDestination ? (
                    <>
                      This is a built-in exact Synology destination, not a saved
                      user trust entry. Disable built-in defaults in this
                      connection's Internal proxy controls. Certificate checks
                      and separate saved-login approval still apply.
                    </>
                  ) : (
                    <>
                      Trust is saved for the original connection in its owning
                      database. This action does not continue the redirect,
                      approve its certificate, or send saved login details.
                      Future redirects to this exact origin skip the destination
                      review. Manage saved destinations in Trust Center →
                      Redirect destinations.
                    </>
                  )}
                </p>
                {!manager.defaultDestination &&
                  !manager.trustedDestination &&
                  !canRemember && (
                    <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
                      {manager.rememberUnavailableReason ||
                        "Save the original connection and open its owning database to remember a destination."}
                    </p>
                  )}
              </div>
            )}
            {manager.trustNotice && (
              <p
                role="status"
                className="rounded-lg border border-[var(--color-border)] p-3 text-xs leading-relaxed text-[var(--color-textSecondary)]"
              >
                {manager.trustNotice}
              </p>
            )}
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
                  disabled={acting || !authentication.available}
                  onChange={(value) =>
                    change({ carry: value, insecureApproved: false })
                  }
                  description="Only the configured username/password or application form login is carried forward. Sending credentials still needs approval, even for a trusted destination; this stops after five handoffs."
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
                    disabled={acting}
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
            disabled={acting}
            onClick={manager.cancel}
          >
            {review ? "Stay here" : "Back to page"}
          </button>
          {error && onReload && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={acting}
              onClick={() => {
                manager.cancel();
                onReload();
              }}
            >
              Reload source page
            </button>
          )}
          {review && (
            <>
              <button
                className="sor-btn sor-btn-secondary"
                disabled={acting}
                onClick={() => void manager.accept("anonymous")}
              >
                Open anonymous tab
              </button>
              <button
                className="sor-btn sor-btn-primary"
                disabled={acting || (carry && insecure && !insecureApproved)}
                onClick={() =>
                  void manager.accept("current", carry, insecureApproved)
                }
              >
                {busy && !manager.rememberingDestination
                  ? "Opening…"
                  : "Continue in this tab"}
              </button>
            </>
          )}
        </footer>
      </div>
    </section>
  );
}
