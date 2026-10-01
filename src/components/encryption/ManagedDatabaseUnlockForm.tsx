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
import type { DatabaseOpenObserver } from "../../types/connection/databaseOpening";
import { isDatabaseOpenCancellation } from "../../utils/connection/databaseOpening";
import { Select } from "../ui/forms/Select";
import { defaultDatabaseUnlockSlotId } from "../../utils/connection/databaseUnlockMethods";

export function ManagedDatabaseUnlockForm({
  databaseId,
  status,
  disabled = false,
  onUnlockComplete,
  onBusyChange,
  onUnlockProgress,
  initialError,
  preferPassword = false,
}: {
  databaseId: string;
  status: DatabaseProtectionStatus;
  disabled?: boolean;
  onUnlockComplete?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onUnlockProgress?: DatabaseOpenObserver;
  initialError?: string;
  preferPassword?: boolean;
}) {
  const manager = DatabaseManager.getInstance();
  const defaultSlotId = defaultDatabaseUnlockSlotId(status, preferPassword);
  const [menuContainer, setMenuContainer] = useState<HTMLFormElement | null>(
    null,
  );
  const [slotId, setSlotId] = useState(() =>
    defaultDatabaseUnlockSlotId(status, preferPassword),
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
    setError(initialError ?? null);
    setSlotId(defaultSlotId);
  }, [scope, status.slots, defaultSlotId, initialError]);
  useLayoutEffect(() => {
    if (disabled) setPassword("");
  }, [disabled]);
  const selected = status.slots.find((slot) => slot.id === slotId);
  const supported =
    selected?.type === "password" || selected?.type === "os-vault";
  const hasMethodChoice =
    status.slots.filter(
      (slot) => slot.type === "password" || slot.type === "os-vault",
    ).length > 1;
  const methodLabel = (slot: DatabaseProtectionStatus["slots"][number]) =>
    `${slot.label || slot.id} (${slot.type === "os-vault" ? "OS vault · this device" : slot.type})`;
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
    onUnlockProgress?.("unlocking");
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
      onUnlockProgress?.(
        isDatabaseOpenCancellation(failure) ? "cancelled" : "failed",
      );
      if (mounted.current && current.current.scope === expected)
        setError(
          isDatabaseOpenCancellation(failure)
            ? null
            : failure instanceof Error
              ? failure.message
              : String(failure),
        );
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
  };
  const inputClass =
    "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm disabled:opacity-50";
  return (
    <form
      ref={setMenuContainer}
      onSubmit={(event) => void submit(event)}
      className="space-y-3"
    >
      {hasMethodChoice && (
        <label className="block text-sm">
          Database unlock method
          <Select
            label="Database unlock method"
            variant="form"
            portalContainer={menuContainer}
            value={slotId}
            onChange={(value) => {
              setSlotId(value);
              setPassword("");
              setError(null);
            }}
            disabled={disabled || busy}
            className="w-full"
            options={status.slots.map((slot) => ({
              value: slot.id,
              label: methodLabel(slot),
              disabled: slot.type !== "password" && slot.type !== "os-vault",
            }))}
          />
        </label>
      )}
      {!hasMethodChoice && selected && (
        <p className="text-sm text-[var(--color-textMuted)]">
          {methodLabel(selected)}
        </p>
      )}
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
