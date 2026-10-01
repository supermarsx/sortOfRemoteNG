import React, { useEffect, useState } from "react";
import type { GlobalSettings } from "../../../types/settings/settings";
import type { ProxyRequestLogSyncState } from "../../../hooks/settings/useProxyRequestLogSync";
import {
  normalizeProxyRequestLogLimit,
  validateProxyRequestLogLimit,
} from "../../../utils/settings/proxyRequestLog";
import { Card } from "../../ui/settings/SettingsPrimitives";

export default function InternalProxyRequestLog({
  settings,
  updateSettings,
  requestLogSync,
  settingsReady,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
  requestLogSync?: ProxyRequestLogSyncState;
  settingsReady?: boolean;
}) {
  const savedLimit = normalizeProxyRequestLogLimit(
    settings.proxyRequestLogLimit,
  );
  const [limitDraft, setLimitDraft] = useState(String(savedLimit));
  const [limitError, setLimitError] = useState<string | null>(null);
  useEffect(() => {
    setLimitDraft(String(savedLimit));
    setLimitError(null);
  }, [savedLimit]);
  const applyLimit = () => {
    try {
      if (!/^\d+$/.test(limitDraft.trim()))
        throw new Error("Enter a whole number from 0 to 100000.");
      const limit = validateProxyRequestLogLimit(Number(limitDraft));
      updateSettings({ proxyRequestLogLimit: limit });
      setLimitError(null);
    } catch {
      setLimitError("Enter a whole number from 0 to 100000.");
    }
  };

  return (
    <Card>
      <div data-setting-key="proxyRequestLogLimit" className="space-y-3">
        <label
          htmlFor="proxy-request-log-limit"
          className="sor-settings-row-label"
        >
          Proxy request log limit
        </label>
        <p className="text-sm text-[var(--color-textSecondary)]">
          Keep the newest diagnostic requests first. Default: 10000; maximum:
          100000. This in-memory log is separate from HAR recordings and
          recorded sessions.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="proxy-request-log-limit"
            type="number"
            min={0}
            max={100000}
            step={1}
            className="sor-settings-input w-36"
            value={limitDraft}
            disabled={settingsReady === false}
            onChange={(event) => {
              setLimitDraft(event.target.value);
              setLimitError(null);
            }}
          />
          <button
            type="button"
            className="sor-modal-primary"
            disabled={
              settingsReady === false || limitDraft === String(savedLimit)
            }
            onClick={applyLimit}
          >
            Apply log limit
          </button>
        </div>
        <p className="text-sm text-warning">
          Applying 0 clears and disables this diagnostic log. Reducing the limit
          discards its oldest entries after the setting is saved and applied.
        </p>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Apply updates this settings draft; the running proxy changes only
          after settings are saved.
        </p>
        {limitError && <p role="alert">{limitError}</p>}
        {requestLogSync?.pending && (
          <p role="status">Applying saved log limit to the proxy…</p>
        )}
        {requestLogSync?.managedByMainWindow && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            The main application window applies the saved log limit.
          </p>
        )}
        {requestLogSync?.error && (
          <div role="alert">
            <p>{requestLogSync.error}</p>
            <button
              type="button"
              className="sor-modal-cancel"
              disabled={settingsReady === false}
              onClick={requestLogSync.retry}
            >
              Retry applying log limit
            </button>
          </div>
        )}
        {!requestLogSync?.pending &&
          !requestLogSync?.error &&
          requestLogSync?.appliedLimit != null && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              Running proxy limit: {requestLogSync.appliedLimit} entries.
            </p>
          )}
      </div>
    </Card>
  );
}
