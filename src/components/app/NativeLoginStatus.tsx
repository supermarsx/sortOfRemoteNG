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
} from "../../hooks/protocol/useNativeLoginActivity";
import { Modal } from "../ui/overlays/Modal";

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
          <button
            type="button"
            className="sor-button"
            onClick={() => setDetails(false)}
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </Modal>
    </>
  );
}
