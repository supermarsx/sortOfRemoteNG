import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Minimal "Check for updates" button that drives the Tauri updater plugin
 * (`@tauri-apps/plugin-updater`). This is the low-level entry point wired
 * against the signed update feed pinned in `src-tauri/tauri.conf.json`
 * (`plugins.updater.pubkey` / `plugins.updater.endpoints`).
 *
 * The richer in-app updater UI with channels / history / rollback lives in
 * `src/components/updater/UpdaterPanel.tsx` and talks to the app's own
 * updater backend commands (`updater_check`, etc.). This button is
 * intentionally a thin shim that exercises the plugin directly so a
 * user-visible "Check for updates" surface exists even when the richer
 * panel is not mounted.
 *
 * Runtime guard: the plugin is only available when the app is running
 * inside a Tauri shell, so we dynamic-import it and surface a friendly
 * message in pure-web / test environments.
 */
export interface CheckForUpdatesButtonProps {
  className?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

export const CheckForUpdatesButton: React.FC<CheckForUpdatesButtonProps> = ({
  className,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const handleClick = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const mod = (await import("@tauri-apps/plugin-updater")) as {
        check: () => Promise<{ available: boolean; version?: string } | null>;
      };
      const update = await mod.check();
      if (update && update.available) {
        setStatus({ kind: "available", version: update.version ?? "?" });
      } else {
        setStatus({ kind: "up-to-date" });
      }
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, []);

  const label =
    status.kind === "checking"
      ? t("updater.checking", "Checking…")
      : t("updater.checkForUpdates", "Check for Updates");

  return (
    <div className={className} data-testid="check-for-updates-button">
      <button
        type="button"
        onClick={handleClick}
        disabled={status.kind === "checking"}
      >
        {label}
      </button>
      {status.kind === "available" && (
        <p role="status">
          {t("updater.newVersion", "New version available:")}{" "}
          <strong>{status.version}</strong>
        </p>
      )}
      {status.kind === "up-to-date" && (
        <p role="status">{t("updater.upToDate", "You're up to date!")}</p>
      )}
      {status.kind === "error" && (
        <p role="alert">
          {t("updater.errorPrefix", "Updater error:")} {status.message}
        </p>
      )}
    </div>
  );
};

export default CheckForUpdatesButton;
