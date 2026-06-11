import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToastContext } from '../../contexts/ToastContext';

/**
 * Detail payload dispatched by `SettingsManager` on the `settings-write-failed`
 * window CustomEvent. Mirrors the event contract agreed with the settings
 * writer (`{ error, attempt, maxAttempts, willRetry }`).
 */
interface SettingsWriteFailedDetail {
  error?: string;
  attempt?: number;
  maxAttempts?: number;
  willRetry?: boolean;
}

/**
 * Bridges the non-React settings writer to the user-facing toast system.
 *
 * `SettingsManager` is a plain class and cannot call `useToastContext()`, so
 * when a disk write of the settings file fails it dispatches a
 * `settings-write-failed` window CustomEvent (and a `settings-write-recovered`
 * event once a later attempt succeeds). This hook — mounted once at the app
 * root, inside the `ToastProvider` — listens for those events and surfaces them
 * as toasts, mirroring how `useStartupFailureAlerts` turns a Rust event into a
 * toast.
 *
 * While the writer is still going to retry (`willRetry === true`) we show a
 * softer warning; on the final hard failure (`willRetry === false`) we show an
 * error, because the change may not have persisted. On recovery we show a
 * success toast so the user knows their settings made it to disk.
 */
export function useSettingsWriteFailureAlerts(): void {
  const { toast } = useToastContext();
  const { t } = useTranslation();

  useEffect(() => {
    const handleFailed = (event: Event) => {
      const detail =
        (event as CustomEvent<SettingsWriteFailedDetail>).detail ?? {};
      const willRetry = detail.willRetry === true;

      if (willRetry) {
        // A retry is still pending — keep it soft so we don't alarm the
        // user before the writer has actually given up.
        toast.warning(
          t(
            'settings.writeFailedRetrying',
            "Couldn't save your settings to disk — retrying…",
          ),
          6_000,
        );
      } else {
        toast.error(
          t(
            'settings.writeFailed',
            "Couldn't save your settings to disk. Your latest change may not persist.",
          ),
          10_000,
        );
      }
    };

    const handleRecovered = () => {
      toast.success(
        t('settings.writeRecovered', 'Your settings were saved to disk.'),
        4_000,
      );
    };

    window.addEventListener('settings-write-failed', handleFailed);
    window.addEventListener('settings-write-recovered', handleRecovered);

    return () => {
      window.removeEventListener('settings-write-failed', handleFailed);
      window.removeEventListener('settings-write-recovered', handleRecovered);
    };
  }, [toast, t]);
}
