import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useUpdater } from "../../hooks/updater/useUpdater";

export interface CheckForUpdatesButtonProps {
  className?: string;
}

export const CheckForUpdatesButton: React.FC<CheckForUpdatesButtonProps> = ({
  className,
}) => {
  const { t } = useTranslation();
  const updater = useUpdater();

  const handleClick = useCallback(() => {
    void updater.check(true);
  }, [updater]);

  return (
    <div className={className} data-testid="check-for-updates-button">
      <button
        type="button"
        onClick={handleClick}
        disabled={!updater.canCheck}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={`w-4 h-4 ${updater.isChecking ? "animate-spin" : ""}`} />
        {updater.isChecking
          ? t("updater.checking", "Checking for updates...")
          : t("updater.checkForUpdates", "Check for updates")}
      </button>
      {updater.availableUpdate && (
        <p role="status" className="mt-2 text-sm text-[var(--color-textSecondary)]">
          {t("updater.newVersionAvailable", "New version available")}: {updater.availableUpdate.version}
        </p>
      )}
      {updater.isUpToDate && !updater.availableUpdate && (
        <p role="status" className="mt-2 inline-flex items-center gap-1 text-sm text-success">
          <CheckCircle2 className="w-4 h-4" />
          {t("updater.upToDate", "You're up to date!")}
        </p>
      )}
      {updater.lastError && (
        <p role="alert" className="mt-2 text-sm text-error">
          {updater.lastError}
        </p>
      )}
    </div>
  );
};

export default CheckForUpdatesButton;