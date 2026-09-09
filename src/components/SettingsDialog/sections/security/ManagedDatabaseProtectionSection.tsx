import { useEffect, useRef, useState } from "react";
import type { ConnectionDatabase } from "../../../../types/connection/connection";
import type {
  DatabaseCipher,
  DatabaseProtectionCapabilities,
  DatabaseProtectionStatus,
  DatabaseProtectionTarget,
} from "../../../../types/encryption/databaseProtection";
import { DatabaseManager } from "../../../../utils/connection/databaseManager";
import {
  withDatabaseMutation,
  flushDatabaseIfCurrent,
} from "../../../../utils/connection/databaseActions";
import { useConnections } from "../../../../contexts/useConnections";
import { ManagedDatabaseUnlockForm } from "../../../encryption/ManagedDatabaseUnlockForm";
import { ConfirmDialog } from "../../../ui/dialogs/ConfirmDialog";

export function ManagedDatabaseProtectionSection({
  database,
  onOpen,
}: {
  database: ConnectionDatabase;
  onOpen?: () => Promise<void>;
}) {
  const manager = DatabaseManager.getInstance();
  const { flushPendingSave } = useConnections();
  const [status, setStatus] = useState<DatabaseProtectionStatus | null>(null);
  const [capabilities, setCapabilities] =
    useState<DatabaseProtectionCapabilities | null>(null);
  const [cipher, setCipher] = useState<DatabaseCipher>("aes-256-gcm");
  const [replace, setReplace] = useState(false);
  const [passwordSlot, setPasswordSlot] = useState(true);
  const [vaultSlot, setVaultSlot] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const generation = useRef(0);
  const [review, setReview] = useState<"apply" | "remove" | null>(null);
  const refresh = async () => {
    const epoch = generation.current;
    const [next, caps] = await Promise.all([
      manager.getDatabaseProtectionStatus(database.id),
      manager.getDatabaseProtectionCapabilities(),
    ]);
    if (epoch !== generation.current) return;
    setStatus(next);
    setCapabilities(caps);
    setCipher(next.dataCipher ?? "aes-256-gcm");
  };
  useEffect(() => {
    generation.current += 1;
    setStatus(null);
    setError("");
    setPassword("");
    setConfirmation("");
    setCurrentPassword("");
    setReview(null);
    void refresh().catch((error) =>
      setError(String(error instanceof Error ? error.message : error)),
    );
    return () => {
      generation.current += 1;
    };
    // One explicit inspection per database/revision; no status polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database.id, database.securityRevision]);
  const supported = (type: string) =>
    capabilities?.protectors.some(
      (item) => item.id === type && item.available,
    ) === true;
  const managed = status?.kind === "managed";
  const needsEnrollment = !managed || replace;
  const canApply =
    capabilities?.ciphers.some(
      (item) => item.id === cipher && item.available,
    ) &&
    (!managed || manager.isDatabaseUnlocked(database.id)) &&
    (!needsEnrollment ||
      (passwordSlot &&
        supported("password") &&
        password.length >= 4 &&
        password === confirmation) ||
      (vaultSlot && supported("os-vault") && !passwordSlot)) &&
    (!passwordSlot || !needsEnrollment || password === confirmation) &&
    (status?.kind !== "legacy-password" || Boolean(currentPassword));
  const apply = async (remove: boolean) => {
    if (guard.current || !status) return;
    guard.current = true;
    setBusy(true);
    setReview(null);
    setError("");
    setMessage("");
    const epoch = generation.current;
    const target: DatabaseProtectionTarget | null = remove
      ? null
      : {
          dataCipher: cipher,
          keepSlotIds:
            managed && !replace ? status.slots.map((slot) => slot.id) : [],
          newSlots: needsEnrollment
            ? [
                ...(passwordSlot
                  ? [
                      {
                        type: "password" as const,
                        label: "Database password",
                        password,
                      },
                    ]
                  : []),
                ...(vaultSlot
                  ? [
                      {
                        type: "os-vault" as const,
                        label: "This device's OS vault",
                      },
                    ]
                  : []),
              ]
            : [],
        };
    try {
      const result = await withDatabaseMutation(manager, async () => {
        await flushDatabaseIfCurrent(database.id, {
          manager,
          flushCurrent: flushPendingSave,
        });
        if (epoch !== generation.current)
          throw new Error("Database changed; review the operation again.");
        return manager.changeManagedDatabaseProtection(database.id, target, {
          expectedSecurityRevision: status.securityRevision,
          currentPassword: currentPassword || undefined,
          confirmRemoveProtection: remove,
          confirmDeviceBoundOnly:
            target?.newSlots.every((slot) => slot.type === "os-vault") &&
            target.keepSlotIds.length === 0,
        });
      });
      if (epoch !== generation.current) return;
      setPassword("");
      setConfirmation("");
      setCurrentPassword("");
      setMessage(
        `Database protection change committed.${result.cleanupPending ? " Recovery cleanup is pending." : ""} ${result.warnings.join(" ")}`,
      );
      try {
        await refresh();
      } catch {
        setError(
          "The change committed, but status refresh is unavailable. Refresh before making another change.",
        );
      }
    } catch (error) {
      if (epoch === generation.current)
        setError(String(error instanceof Error ? error.message : error));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--color-border)] p-3"
      aria-label="Managed database protection"
    >
      <h4 className="text-sm font-medium">Cipher and unlock methods</h4>
      <p className="text-xs text-[var(--color-textMuted)]">
        Native database protection is separate from the global master key and
        exported-file passwords. Browser storage cannot use this format. Unlock
        sessions expire after 15 minutes; unsaved edits require reauthentication
        before saving.
      </p>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      {!status ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void refresh().catch((error) => setError(String(error)))
          }
        >
          Retry protection status
        </button>
      ) : (
        <>
          <p className="text-xs">
            Format: {status.kind}.{" "}
            {status.sessionExpiresAt && (
              <>
                Session expires{" "}
                {new Date(status.sessionExpiresAt).toLocaleTimeString()}.
              </>
            )}
          </p>
          {managed && !manager.isDatabaseUnlocked(database.id) ? (
            <ManagedDatabaseUnlockForm
              databaseId={database.id}
              status={status}
              onUnlockComplete={async () => {
                await refresh();
                await onOpen?.();
              }}
            />
          ) : (
            <>
              {managed && (
                <ul className="space-y-1 text-xs">
                  {status.slots.map((slot) => (
                    <li key={slot.id}>
                      {slot.label} — {slot.type}
                      {slot.deviceBound ? " (device-bound)" : ""}
                    </li>
                  ))}
                </ul>
              )}
              <label className="block text-xs">
                Data cipher
                <select
                  aria-label="Database data cipher"
                  className="sor-form-input mt-1 block w-full"
                  value={cipher}
                  disabled={busy}
                  onChange={(event) =>
                    setCipher(event.target.value as DatabaseCipher)
                  }
                >
                  {capabilities?.ciphers.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.available}
                    >
                      {item.id}
                      {!item.available
                        ? ` — ${item.reason ?? "unavailable"}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              {managed && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={replace}
                    disabled={busy}
                    onChange={(event) => setReplace(event.target.checked)}
                  />
                  Replace all existing unlock methods (re-enroll every method
                  you want to keep)
                </label>
              )}
              {status.kind === "legacy-password" && (
                <label className="block text-xs">
                  Current legacy database password
                  <input
                    aria-label="Current legacy database password"
                    className="sor-form-input block w-full"
                    type="password"
                    autoComplete="off"
                    value={currentPassword}
                    disabled={busy}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                  />
                </label>
              )}
              {needsEnrollment && (
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="text-xs font-medium">
                    Enroll unlock methods
                  </legend>
                  <label className="flex gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={passwordSlot}
                      disabled={!supported("password")}
                      onChange={(event) =>
                        setPasswordSlot(event.target.checked)
                      }
                    />
                    Password
                  </label>
                  {passwordSlot && (
                    <>
                      <input
                        aria-label="Managed database password"
                        type="password"
                        autoComplete="new-password"
                        className="sor-form-input block w-full"
                        placeholder="New database password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                      <input
                        aria-label="Confirm managed database password"
                        type="password"
                        autoComplete="new-password"
                        className="sor-form-input block w-full"
                        placeholder="Confirm password"
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                      />
                    </>
                  )}
                  <label className="flex gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={vaultSlot}
                      disabled={!supported("os-vault")}
                      onChange={(event) => setVaultSlot(event.target.checked)}
                    />
                    This device's OS vault
                  </label>
                  <p className="text-xs">
                    Vault-only access is tied to this device/account. Keep a
                    password method for portable recovery. OS vault access is
                    not a promise of fresh biometric verification.
                  </p>
                  {capabilities?.protectors
                    .filter(
                      (item) =>
                        item.id !== "password" && item.id !== "os-vault",
                    )
                    .map((item) => (
                      <p
                        key={item.id}
                        className="text-xs text-[var(--color-textMuted)]"
                      >
                        {item.id}: unavailable in this UI. {item.reason}
                      </p>
                    ))}
                </fieldset>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
                  disabled={busy || !canApply}
                  onClick={() => setReview("apply")}
                >
                  Review protection change
                </button>
                {managed && (
                  <button
                    type="button"
                    className="rounded border border-error/50 px-3 py-1.5 text-xs text-error disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setReview("remove")}
                  >
                    Remove inner protection
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      <ConfirmDialog
        isOpen={review !== null}
        title={
          review === "remove"
            ? "Remove database inner protection?"
            : "Change database protection?"
        }
        message={
          review === "remove"
            ? `Remove the inner encryption layer from ${database.name}? Global artifact protection is unchanged. Without that outer protection the payload may be plaintext. Existing external backups remain unchanged.`
            : `Apply ${cipher} to ${database.name}? ${replace ? "All existing unlock methods will be revoked for new ciphertext; every wanted method must be re-enrolled. " : ""}${vaultSlot && !passwordSlot && needsEnrollment ? "This is device-bound-only access: losing this device/account can make the database unrecoverable. " : ""}Existing exported copies and backups are not securely erased.`
        }
        confirmOnEnter={false}
        variant={review === "remove" ? "danger" : "warning"}
        onCancel={() => setReview(null)}
        onConfirm={() => void apply(review === "remove")}
      />
    </section>
  );
}
