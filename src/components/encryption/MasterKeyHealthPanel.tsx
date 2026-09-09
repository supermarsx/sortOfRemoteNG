import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getInvoke } from "../../utils/tauri/invoke";

interface KeyHealth {
  proven: boolean;
  criticalFailure: boolean;
  verified: string[];
  issues: string[];
}

/** Explicit inspection only: routine status polling never decrypts artifacts. */
export function MasterKeyHealthPanel({
  onInspected,
}: {
  onInspected: () => Promise<void>;
}) {
  const [health, setHealth] = useState<KeyHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const inspect = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const invoke = await getInvoke();
      if (!invoke)
        throw new Error("Native key health inspection is unavailable.");
      setHealth(await invoke<KeyHealth>("encryption_master_key_health"));
      await onInspected();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[var(--color-textMuted)]">
        Inspect current canonical key evidence on demand. This is not a complete
        integrity scan of every recording, backup or database.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void inspect()}
        className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-border)] disabled:opacity-50"
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
        />
        {busy ? "Inspecting master-key health…" : "Inspect master-key health"}
      </button>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {health && (
        <div
          role={health.criticalFailure ? "alert" : "status"}
          className={health.criticalFailure ? "text-error" : ""}
        >
          <p>
            {health.criticalFailure
              ? "Critical key failure: native storage is locked."
              : health.proven
                ? "The loaded key authenticated current profile evidence."
                : "Current key membership has not been proven."}
          </p>
          {health.verified.length > 0 && (
            <p>Verified: {health.verified.join(", ")}.</p>
          )}
          {health.issues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
        </div>
      )}
    </div>
  );
}
