import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import {
  allowWorkspaceRestoreOnce,
  dismissSafeModeBanner,
  restartNormally,
  useSafeMode,
} from "../../utils/safeMode/safeModeState";

const fmt = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
};

/** Compact top banner shown while the app runs in safe mode. */
export const SafeModeBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, bannerDismissed, restoreAllowed } = useSafeMode();
  const [showDetails, setShowDetails] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!status?.active || bannerDismissed) return null;

  const message =
    status.reason === "forced"
      ? t("safeMode.bannerForced")
      : status.reason === "next-start"
        ? t("safeMode.bannerNextStart")
        : t("safeMode.banner", { count: status.consecutiveUnclean });
  const marker = status.previousMarker;
  const button =
    "px-2 py-0.5 rounded border border-amber-500/50 hover:bg-amber-500/20 disabled:opacity-50";

  return (
    <div
      role="alert"
      data-testid="safe-mode-banner"
      className="flex-shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-[var(--color-text)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert size={14} className="text-amber-500" aria-hidden="true" />
        <span className="flex-1 min-w-[16rem]">{message}</span>
        <button
          type="button"
          className={button}
          disabled={busy}
          data-testid="safe-mode-restart-normally"
          onClick={() => {
            setBusy(true);
            void restartNormally().catch(() => setBusy(false));
          }}
        >
          {t("safeMode.restartNormally")}
        </button>
        {!restoreAllowed && (
          <button
            type="button"
            className={button}
            data-testid="safe-mode-restore"
            onClick={() => setConfirmRestore(true)}
          >
            {t("safeMode.restoreWorkspace")}
          </button>
        )}
        <button
          type="button"
          className={button}
          data-testid="safe-mode-stay"
          onClick={dismissSafeModeBanner}
        >
          {t("safeMode.stay")}
        </button>
        <button
          type="button"
          className={button}
          aria-expanded={showDetails}
          data-testid="safe-mode-details"
          onClick={() => setShowDetails((v) => !v)}
        >
          {t("safeMode.details")}
        </button>
      </div>
      {confirmRestore && !restoreAllowed && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-2"
          data-testid="safe-mode-restore-confirm"
        >
          <span className="flex-1 min-w-[16rem]">
            {t("safeMode.restoreConfirm")}
          </span>
          <button
            type="button"
            className={button}
            data-testid="safe-mode-restore-yes"
            onClick={() => {
              allowWorkspaceRestoreOnce();
              setConfirmRestore(false);
            }}
          >
            {t("safeMode.restoreWorkspace")}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setConfirmRestore(false)}
          >
            {t("safeMode.stay")}
          </button>
        </div>
      )}
      {showDetails && (
        <ul
          className="mt-1.5 space-y-0.5 text-[var(--color-textMuted)]"
          data-testid="safe-mode-details-panel"
        >
          <li>
            {t("safeMode.detailsCounter", { count: status.consecutiveUnclean })}
          </li>
          <li>{t("safeMode.detailsThreshold", { count: status.threshold })}</li>
          <li>
            {t("safeMode.detailsLast")}:{" "}
            {status.lastUncleanMs.length > 0
              ? status.lastUncleanMs.map(fmt).join("; ")
              : t("safeMode.detailsNone")}
          </li>
          {marker && (
            <li>
              {t("safeMode.detailsMarker", {
                pid: marker.pid,
                started: fmt(marker.startedAtMs),
                version: marker.version,
              })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default SafeModeBanner;
