import { useSettings } from "../../contexts/SettingsContext";
import { useEffect, useState } from "react";

/** Never expose a defaults-based settings UI after a locked/failed persisted load. */
export function SettingsStorageNotice() {
  const { settingsReady, settingsLoadError, reloadSettings } = useSettings();
  const [lockError, setLockError] = useState<string | null>(null);
  useEffect(() => {
    const failed = (event: Event) =>
      setLockError(String((event as CustomEvent<unknown>).detail));
    window.addEventListener("global-lock-failed", failed);
    return () => window.removeEventListener("global-lock-failed", failed);
  }, []);
  if (settingsReady !== false)
    return lockError ? (
      <div
        role="alert"
        className="fixed bottom-6 left-6 right-6 z-[2000] rounded border border-error bg-background p-4 text-sm text-[var(--color-text)]"
      >
        Storage lock was not confirmed: {lockError}{" "}
        <button
          type="button"
          onClick={() => setLockError(null)}
          className="underline"
        >
          Dismiss
        </button>
      </div>
    ) : null;
  return (
    <div
      role="status"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-background text-[var(--color-text)]"
    >
      <div className="max-w-md space-y-3 p-6">
        <h2 className="text-base font-semibold">
          Global settings are not ready
        </h2>
        <p className="text-sm">
          {settingsLoadError
            ? "Unlock encrypted storage first, then retry loading your saved settings. Changes are blocked to avoid overwriting them with defaults."
            : "Loading saved global settings…"}
        </p>
        {settingsLoadError && (
          <button
            type="button"
            className="text-sm underline"
            onClick={() => void reloadSettings().catch(() => {})}
          >
            Retry loading global settings
          </button>
        )}
      </div>
    </div>
  );
}
