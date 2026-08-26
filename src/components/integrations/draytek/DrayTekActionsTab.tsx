// DrayTek — "Actions" sub-tab (t68 D3): reboot (always behind a confirm —
// plan §6 risk 2) and "Open Web UI" (opens the DrayOS admin in the browser;
// optional best-effort pre-auth via the `wlogin.cgi?aa=&ab=` URL — plan §6
// risk 5: DrayOS login is a GET, not a fillable form, so the in-app
// form-fill auto-login heuristic cannot be promised here).

import React, { useCallback, useState } from "react";
import { ExternalLink, Loader2, Power } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

import type { DraytekActionResult } from "../../../types/draytek";
import {
  buildDraytekAutoLoginUrl,
  buildDraytekWebUiUrl,
  useDraytek,
} from "../../../hooks/integration/draytek/useDraytek";
import type { DraytekTabProps } from "./registry";

/** Open a URL in the user's real browser (Tauri), falling back to window.open. */
function openExternal(url: string): Promise<void> {
  return invoke("open_url_external", { url })
    .then(() => undefined)
    .catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
}

const DrayTekActionsTab: React.FC<DraytekTabProps> = ({
  connectionId,
  device,
}) => {
  const { t } = useTranslation();
  const { api, loading, error, run } = useDraytek();
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [lastResult, setLastResult] = useState<DraytekActionResult | null>(
    null,
  );
  const [preAuth, setPreAuth] = useState(false);

  const webUiUrl = buildDraytekWebUiUrl(device);

  const doReboot = useCallback(async () => {
    setConfirmReboot(false);
    const result = await run(() => api.reboot(connectionId));
    if (result) setLastResult(result);
  }, [api, connectionId, run]);

  const openWebUi = useCallback(() => {
    const url = preAuth
      ? buildDraytekAutoLoginUrl(webUiUrl, device.username, device.password)
      : webUiUrl;
    void openExternal(url);
  }, [device.password, device.username, preAuth, webUiUrl]);

  return (
    <div className="flex flex-col gap-6 p-4">
      {error && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-dangerBg,#3a1a1a)] px-3 py-2 text-xs text-[var(--color-danger,#f87171)]">
          {error}
        </div>
      )}

      {/* ── Open Web UI ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("integrations.draytek.actions.webUi.title", "Web admin")}
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.draytek.actions.webUi.hint",
            "Opens the DrayOS web admin in your browser. This panel's HTTP session is the reliable logged-in path; browser pre-authentication is best-effort and newer firmware (4.4+) may still show the login page.",
          )}
        </p>
        <code className="text-xs text-[var(--color-textSecondary)]">
          {webUiUrl}
        </code>
        <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input
            type="checkbox"
            checked={preAuth}
            onChange={(e) => setPreAuth(e.target.checked)}
          />
          {t(
            "integrations.draytek.actions.webUi.preAuth",
            "Pre-authenticate the browser session (best-effort, classic firmware)",
          )}
        </label>
        <button
          onClick={openWebUi}
          className="flex w-fit items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-medium text-white"
        >
          <ExternalLink size={16} />
          {t("integrations.draytek.actions.webUi.open", "Open Web UI")}
        </button>
      </section>

      {/* ── Reboot ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t("integrations.draytek.actions.reboot.title", "Reboot")}
        </h3>
        <p className="text-xs text-[var(--color-textSecondary)]">
          {t(
            "integrations.draytek.actions.reboot.hint",
            "Restarts the router. Every connection through it drops until it is back up.",
          )}
        </p>
        {!confirmReboot ? (
          <button
            onClick={() => setConfirmReboot(true)}
            disabled={loading}
            className="flex w-fit items-center gap-2 rounded border border-[var(--color-danger,#f87171)] px-3 py-2 text-sm font-medium text-[var(--color-danger,#f87171)] disabled:opacity-50"
          >
            <Power size={16} />
            {t("integrations.draytek.actions.reboot.button", "Reboot router")}
          </button>
        ) : (
          <div
            role="alertdialog"
            aria-label={t(
              "integrations.draytek.actions.reboot.confirmTitle",
              "Confirm reboot",
            )}
            className="flex flex-col gap-2 rounded border border-[var(--color-danger,#f87171)] p-3"
          >
            <p className="text-sm text-[var(--color-text)]">
              {t(
                "integrations.draytek.actions.reboot.confirmBody",
                "Reboot {{host}} now?",
                { host: device.host },
              )}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void doReboot()}
                disabled={loading}
                className="flex items-center gap-2 rounded bg-[var(--color-danger,#f87171)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Power size={14} />
                )}
                {t(
                  "integrations.draytek.actions.reboot.confirm",
                  "Yes, reboot",
                )}
              </button>
              <button
                onClick={() => setConfirmReboot(false)}
                className="app-bar-button px-3 py-1.5 text-sm"
              >
                {t("integrations.draytek.actions.reboot.cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}
        {lastResult && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            {lastResult.accepted
              ? t(
                  "integrations.draytek.actions.reboot.accepted",
                  "Reboot accepted by the device.",
                )
              : t(
                  "integrations.draytek.actions.reboot.rejected",
                  "The device did not accept the reboot request.",
                )}
            {lastResult.message ? ` ${lastResult.message}` : ""}
          </p>
        )}
      </section>
    </div>
  );
};

export default DrayTekActionsTab;
