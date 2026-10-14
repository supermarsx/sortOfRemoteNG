import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { getHttpApplicationProfile } from "../../utils/connection/httpApplicationProfiles";
import {
  useNativeLoginActivity,
  type NativeLoginStage,
  type NativeLoginReasonCode,
} from "../../hooks/protocol/useNativeLoginActivity";
import { Modal, ModalFooter } from "../ui/overlays/Modal";

const nativeLoginStageLabels: Record<NativeLoginStage, string> = {
  "waiting-page": "Waiting for page",
  "security-check": "Waiting for security check",
  "filling-username": "Typing username",
  "filling-password": "Typing password",
  submitting: "Submitting login",
  "waiting-2fa": "Waiting for two-factor authentication",
  "typing-code": "Typing one-time code",
  completed: "Login submitted",
  held: "Held for manual entry",
  cancelled: "Login cancelled",
  stopped: "Automatic login stopped",
};

const reasonLabels: Record<NativeLoginReasonCode, string> = {
  "current-context-rejected":
    "The page, login step or browser context no longer matched the active login attempt. Automatic typing was cancelled to avoid entering credentials in the wrong context.",
  "navigation-scope-rejected":
    "The current page was outside the approved saved-login navigation scope. Automatic typing was cancelled; return to the application's sign-in page before retrying.",
  "adapter-rejected":
    "The login adapter stopped before completing and did not report a more specific cause. Check the page for manual-entry or verification prompts before retrying.",
  "challenge-timeout":
    "The page security-check wait reached its time limit. Complete any verification shown on the page, then retry the login.",
  "grant-rejected":
    "The native browser did not authorize credential delivery for this login step. Review the selected saved login and its permissions before retrying.",
  "attempt-stopped":
    "This tab's automatic-login attempt was stopped or replaced. Reopen the connection when you are ready to retry.",
};

export function NativeLoginStatus({
  connections,
  sessions,
  activeSessionId,
}: {
  connections: Connection[];
  sessions: ConnectionSession[];
  activeSessionId?: string | null;
}) {
  const { t } = useTranslation();
  const activities = useNativeLoginActivity(
    sessions.map((session) => session.id),
  );
  const [details, setDetails] = useState(false);
  const session = sessions.find((item) => item.id === activeSessionId);
  const connection = connections.find(
    (item) => item.id === session?.connectionId,
  );
  const activity = session && activities[session.id];
  const running =
    activity && !["completed", "cancelled", "stopped"].includes(activity.stage);
  const [clock, setClock] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setClock(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [running, activeSessionId]);
  if (!activity || !connection || activity.connectionId !== connection.id)
    return null;
  if (
    connection.httpApplication &&
    (!connection.httpApplication.loginMode ||
      connection.httpApplication.loginMode === "manual")
  )
    return null;
  const elapsedMs =
    activity.elapsedMs +
    (running ? Math.max(0, clock - (activity.observedAtMs ?? clock)) : 0);
  const profile =
    connection.httpApplication &&
    getHttpApplicationProfile(connection.httpApplication.id);
  const label = profile?.label ?? t("statusBar.autoLogin", "Automatic login");
  const stage = t(
    `statusBar.loginStages.${activity.stage}`,
    nativeLoginStageLabels[activity.stage],
  );
  const busy = Object.values(activities).filter(
    (item) => !["completed", "cancelled", "stopped"].includes(item.stage),
  ).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setDetails(true)}
        className="flex items-center gap-2 text-[var(--color-textSecondary)]"
        aria-label={`${label}: ${stage}`}
      >
        <span role="status" aria-live="polite" aria-atomic="true">
          {label}: {stage}
        </span>
        {running && (
          <span aria-hidden="true">{Math.floor(elapsedMs / 1000)}s</span>
        )}
        {busy > 1 && (
          <span
            aria-label={t(
              "statusBar.concurrentLogins",
              "{{count}} active logins",
              { count: busy },
            )}
          >
            ×{busy}
          </span>
        )}
      </button>
      <Modal
        isOpen={details}
        onClose={() => setDetails(false)}
        ariaLabel={t("statusBar.loginDetails", "Automatic login details")}
        size="sm"
      >
        <div className="p-4 space-y-3">
          <h2>{t("statusBar.loginDetails", "Automatic login details")}</h2>
          <p>
            {label}: {stage}
          </p>
          {["cancelled", "stopped", "held"].includes(activity.stage) && (
            <div
              className="rounded border border-[var(--color-border)] p-3 space-y-2"
              role="status"
            >
              <p className="text-sm">
                {activity.reasonCode
                  ? t(
                      `statusBar.loginReasons.${activity.reasonCode}`,
                      reasonLabels[activity.reasonCode],
                    )
                  : t(
                      "statusBar.loginReasons.unknown",
                      "No specific cancellation reason was reported by the native browser. Check the page for verification or manual-entry prompts, then retry when the page is ready.",
                    )}
              </p>
              {activity.lastActiveStage && (
                <p className="text-xs text-[var(--color-textMuted)]">
                  {t("statusBar.loginLastStep", "Last reported step")}:{" "}
                  {t(
                    `statusBar.loginStages.${activity.lastActiveStage}`,
                    nativeLoginStageLabels[activity.lastActiveStage],
                  )}
                </p>
              )}
            </div>
          )}
          <p>
            {t("statusBar.loginElapsed", "Elapsed: {{seconds}} s", {
              seconds: Math.floor(elapsedMs / 1000),
            })}
          </p>
          <p className="text-xs text-[var(--color-textMuted)]">
            {t(
              "statusBar.loginCompletionNote",
              "Submitting a login does not confirm that the website accepted it. Check the website for verification or approval prompts.",
            )}
          </p>
        </div>
        <ModalFooter>
          <button
            type="button"
            className="sor-btn sor-btn-primary min-w-24"
            onClick={() => setDetails(false)}
          >
            {t("common.close", "Close")}
          </button>
        </ModalFooter>
      </Modal>
    </>
  );
}
