import { useSettings } from "../../contexts/SettingsContext";
import { useEffect, useRef, useState } from "react";
import { getInvoke } from "../../utils/tauri/invoke";
import type { EncryptionStatus } from "../../types/encryption/encryption";

function InterruptedStorageRecovery({
  onRecovered,
}: {
  onRecovered: () => Promise<void>;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    const inspect = async () => {
      const invoke = await getInvoke();
      if (!invoke) return;
      const status = await invoke<EncryptionStatus>("encryption_status");
      if (active)
        setAvailable(
          status.unlocked && status.artifactRecoveryRequired === true,
        );
    };
    void inspect().catch(() => undefined);
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const stop = await listen("encryption:unlocked", () => {
          void inspect().catch(() => undefined);
        });
        if (!active) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  if (!available) return null;
  const recover = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const invoke = await getInvoke();
      if (!invoke) throw new Error("Native storage recovery is unavailable.");
      await invoke("encryption_recover_artifact_transition");
      await onRecovered();
      setAvailable(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <p>
        The original key is loaded, but an interrupted storage transaction must
        finish recovery before settings can load. Existing encrypted data has
        not been reset.
      </p>
      <button
        type="button"
        disabled={busy}
        className="rounded-md border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-border)] disabled:opacity-50"
        onClick={() => void recover()}
      >
        {busy
          ? "Recovering interrupted storage…"
          : "Recover interrupted storage operation"}
      </button>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
    </div>
  );
}

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
        {settingsLoadError && (
          <InterruptedStorageRecovery onRecovered={reloadSettings} />
        )}
      </div>
    </div>
  );
}
