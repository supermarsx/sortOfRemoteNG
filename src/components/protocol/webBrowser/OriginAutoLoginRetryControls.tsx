import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import type {
  OriginAutoLoginRetryController,
  OriginAutoLoginRetryStep,
  OriginAutoLoginRetryStepState,
} from "../../../hooks/protocol/useOriginAutoLoginRetry";

/** Retry row of the Credentials & 2FA panel. Each retry re-runs automatic
 * login on the current page in place; native applies its own checks. */
export default function OriginAutoLoginRetryControls({
  controller,
  onRetry,
}: {
  controller: OriginAutoLoginRetryController;
  /** Called before the retry starts, e.g. to close the panel. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  if (!controller.enabled) return null;
  const why = (state: OriginAutoLoginRetryStepState) => {
    switch (state.reason) {
      case "no-credentials":
        return t(
          "originBrowser.autoLoginRetry.noCredentials",
          "This connection has no saved credentials for automatic login.",
        );
      case "no-mfa":
        return t(
          "originBrowser.autoLoginRetry.noMfa",
          "No authenticator is selected for automatic 2FA on this connection.",
        );
      case "busy":
        return t(
          "originBrowser.autoLoginRetry.busy",
          "Automatic login is in progress.",
        );
      case "wait":
        return t(
          "originBrowser.autoLoginRetry.wait",
          "A new 2FA code is available in {{seconds}} s.",
          { seconds: controller.waitSeconds },
        );
      default:
        return null;
    }
  };
  const button = (
    step: OriginAutoLoginRetryStep,
    state: OriginAutoLoginRetryStepState,
    text: string,
    label: string,
  ) => {
    const reason = why(state);
    return (
      <button
        type="button"
        className="sor-btn sor-btn-secondary sor-btn-sm inline-flex items-center gap-1.5"
        aria-label={reason ? `${label}. ${reason}` : label}
        data-tooltip={reason ?? label}
        aria-busy={controller.pending}
        disabled={!state.available}
        onClick={() => {
          if (!state.available) return;
          onRetry?.();
          void controller.retry(step);
        }}
      >
        <RotateCcw size={14} aria-hidden="true" />
        <span>{text}</span>
      </button>
    );
  };
  return (
    <div
      className="border-b border-[var(--color-border)] p-3"
      data-testid="origin-auto-login-retry"
    >
      <div className="flex flex-wrap gap-2">
        {button(
          "credentials",
          controller.credentials,
          t("originBrowser.autoLoginRetry.credentials", "Retry sign-in"),
          t(
            "originBrowser.autoLoginRetry.credentialsLabel",
            "Retry automatic login with the saved credentials",
          ),
        )}
        {button(
          "mfa",
          controller.mfa,
          t("originBrowser.autoLoginRetry.mfa", "Retry 2FA"),
          t(
            "originBrowser.autoLoginRetry.mfaLabel",
            "Retry automatic login with a new 2FA code",
          ),
        )}
      </div>
    </div>
  );
}
