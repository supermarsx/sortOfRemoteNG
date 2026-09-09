import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { LockKeyhole } from "lucide-react";
import { DatabaseManager } from "../../utils/connection/databaseManager";
import type { DatabaseProtectionStatus } from "../../types/encryption/databaseProtection";

export function ManagedDatabaseUnlockForm({
  databaseId,
  status,
  disabled = false,
  onUnlockComplete,
  onBusyChange,
}: {
  databaseId: string;
  status: DatabaseProtectionStatus;
  disabled?: boolean;
  onUnlockComplete?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const manager = DatabaseManager.getInstance();
  const [slotId, setSlotId] = useState(
    () =>
      status.slots.find((slot) => slot.type === "password")?.id ??
      status.slots[0]?.id ??
      "",
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const scope = `${databaseId}\u0000${status.securityRevision}`;
  const current = useRef({ scope, disabled, onUnlockComplete });
  current.current = { scope, disabled, onUnlockComplete };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    setPassword("");
    setError(null);
    setSlotId(
      status.slots.find((slot) => slot.type === "password")?.id ??
        status.slots[0]?.id ??
        "",
    );
  }, [scope, status.slots]);
  useLayoutEffect(() => {
    if (disabled) setPassword("");
  }, [disabled]);
  const selected = status.slots.find((slot) => slot.id === slotId);
  const supported =
    selected?.type === "password" || selected?.type === "os-vault";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      inFlight.current ||
      current.current.disabled ||
      !selected ||
      !supported ||
      (selected.type === "password" && !password)
    )
      return;
    const expected = scope;
    const suppliedPassword =
      selected.type === "password" ? password : undefined;
    inFlight.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    setPassword("");
    try {
      await manager.unlockManagedDatabase(
        databaseId,
        selected.id,
        suppliedPassword,
        {
          isCurrent: () =>
            mounted.current &&
            current.current.scope === expected &&
            !current.current.disabled,
        },
      );
      if (
        mounted.current &&
        current.current.scope === expected &&
        !current.current.disabled
      )
        await current.current.onUnlockComplete?.();
    } catch (failure) {
      if (mounted.current && current.current.scope === expected)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
  };
  const inputClass =
    "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm disabled:opacity-50";
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <label className="block text-sm">
        Database unlock method
        <select
          value={slotId}
          onChange={(event) => {
            setSlotId(event.target.value);
            setPassword("");
            setError(null);
          }}
          disabled={disabled || busy}
          className={inputClass}
        >
          {status.slots.map((slot) => (
            <option
              key={slot.id}
              value={slot.id}
              disabled={slot.type !== "password" && slot.type !== "os-vault"}
            >
              {slot.label || slot.id} (
              {slot.type === "os-vault" ? "OS vault · this device" : slot.type})
            </option>
          ))}
        </select>
      </label>
      {selected?.type === "password" && (
        <label className="block text-sm">
          Database password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            maxLength={1024}
            disabled={disabled || busy}
            className={inputClass}
          />
        </label>
      )}
      {selected?.type === "os-vault" && (
        <p className="text-xs text-[var(--color-textMuted)]">
          Uses this device's current OS-account vault access. This is not a
          master-key unlock or a fresh biometric challenge.
        </p>
      )}
      {!supported && (
        <p role="alert" className="text-warning">
          No supported unlock method is available. Keep the database and
          recovery credentials; access remains blocked.
        </p>
      )}
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={
          disabled ||
          busy ||
          !supported ||
          (selected?.type === "password" && !password)
        }
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
        {busy ? "Authenticating database…" : "Unlock database"}
      </button>
    </form>
  );
}
