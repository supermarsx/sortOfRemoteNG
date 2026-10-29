import type { TFunction } from "i18next";
import type {
  OriginAutoLoginRetryOutcome,
  OriginAutoLoginRetryStep,
} from "../../hooks/protocol/useOriginAutoLoginRetry";

/** One toast line for an answered retry. Fixed wording per code only. */
export function autoLoginRetryMessage(
  t: TFunction,
  step: OriginAutoLoginRetryStep,
  outcome: OriginAutoLoginRetryOutcome,
): { type: "info" | "warning" | "error"; message: string } {
  if (outcome.status === "started")
    return {
      type: "info",
      message:
        step === "mfa"
          ? t(
              "originBrowser.autoLoginRetry.startedMfa",
              "Entering a new 2FA code on this page.",
            )
          : t(
              "originBrowser.autoLoginRetry.startedCredentials",
              "Retrying automatic login on this page.",
            ),
    };
  if (outcome.status === "unavailable")
    return {
      type: "error",
      message: t(
        "originBrowser.autoLoginRetry.unavailable",
        "Automatic login could not be retried on this page. This version of the browser may not support it yet.",
      ),
    };
  const refused: Record<typeof outcome.reason, string> = {
    "not-current": t(
      "originBrowser.autoLoginRetry.refused.notCurrent",
      "The page changed before automatic login could be retried. Try again.",
    ),
    "no-login": t(
      "originBrowser.autoLoginRetry.refused.noLogin",
      "This tab has no automatic login to retry.",
    ),
    busy: t(
      "originBrowser.autoLoginRetry.refused.busy",
      "Automatic login is still running on this page.",
    ),
    "no-mfa": t(
      "originBrowser.autoLoginRetry.refused.noMfa",
      "This tab has no automatic 2FA to retry.",
    ),
    "code-used": t(
      "originBrowser.autoLoginRetry.refused.codeUsed",
      "The current 2FA code was already used. Retry when a new code is available.",
    ),
    "rate-limited": t(
      "originBrowser.autoLoginRetry.refused.rateLimited",
      "Automatic login was retried too often. Wait a moment, then try again.",
    ),
    "no-form": t(
      "originBrowser.autoLoginRetry.refused.noForm",
      "This page shows no sign-in form to fill. Open the sign-in page, then retry.",
    ),
  };
  return { type: "warning", message: refused[outcome.reason] };
}
