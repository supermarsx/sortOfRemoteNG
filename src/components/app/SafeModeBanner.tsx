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

/**
 * Compact safe-mode bar that lives in the bottom bar stack (above the status
 * bar). Reserves its own height in flow; Details and the restore confirmation
 * open in a popover anchored upward. Once dismissed it shrinks to a persistent
 * shield chip that re-opens the details.
 */
export const SafeModeBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, bannerDismissed, restoreAllowed } = useSafeMode();
  const [showDetails, setShowDetails] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!status?.active) return null;

  const message =
    status.reason === "forced"
      ? t("safeMode.bannerForced")
      : status.reason === "next-start"
        ? t("safeMode.bannerNextStart")
        : t("safeMode.banner", { count: status.consecutiveUnclean });
  const marker = status.previousMarker;
  const button = "sor-btn sor-btn-secondary sor-btn-xs shrink-0";

  const popover = (showDetails || (confirmRestore && !restoreAllowed)) && (
    <div
      className="absolute bottom-full left-2 z-40 mb-1 w-[min(28rem,calc(100%-1rem))] space-y-1.5 rounded-md border border-warning bg-[var(--color-surface)] p-2 text-xs text-[var(--color-text)] shadow-lg"
      data-testid="safe-mode-popover"
    >
      {confirmRestore && !restoreAllowed && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="safe-mode-restore-confirm"
        >
          <span className="flex-1 min-w-[12rem]">
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
          className="space-y-0.5 text-[var(--color-textMuted)]"
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

  if (bannerDismissed) {
    return (
      <div
        className="relative flex min-w-0 shrink-0 items-center border-t border-warning bg-warning/15 px-3 py-0.5 text-[0.6875rem] text-[var(--color-text)]"
        data-testid="safe-mode-chip-row"
      >
        {popover}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-warning bg-warning/20 px-2 py-0.5 text-warning"
          title={message}
          aria-expanded={showDetails}
          data-testid="safe-mode-chip"
          onClick={() => setShowDetails((v) => !v)}
        >
          <ShieldAlert size={12} aria-hidden="true" />
          <span>{t("safeMode.details")}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="safe-mode-banner"
      className="relative flex min-w-0 shrink-0 items-center gap-2 border-t border-warning bg-warning/15 px-3 py-0.5 text-[0.6875rem] text-[var(--color-text)]"
    >
      {popover}
      <ShieldAlert
        size={12}
        className="shrink-0 text-warning"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
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
        aria-expanded={showDetails}
        data-testid="safe-mode-details"
        onClick={() => setShowDetails((v) => !v)}
      >
        {t("safeMode.details")}
      </button>
      <button
        type="button"
        className={button}
        data-testid="safe-mode-stay"
        onClick={dismissSafeModeBanner}
      >
        {t("safeMode.stay")}
      </button>
    </div>
  );
};

export default SafeModeBanner;
