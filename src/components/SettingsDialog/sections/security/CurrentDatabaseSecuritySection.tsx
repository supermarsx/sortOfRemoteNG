import { useEffect, useRef, useState } from "react";
import { DatabaseManager } from "../../../../utils/connection/databaseManager";
import { useConnections } from "../../../../contexts/useConnections";
import type { ConnectionDatabase } from "../../../../types/connection/connection";
import { performDatabaseAction } from "../../../../utils/connection/databaseActions";
import { performDatabaseSecurityAction } from "../../../../utils/connection/databaseSecurityActions";
import { Card } from "../../../ui/settings/SettingsPrimitives";
import { ConfirmDialog } from "../../../ui/dialogs/ConfirmDialog";

export interface DatabaseSecurityCallbacks {
  onDatabaseSelect?: (id: string, password?: string) => Promise<void> | void;
  onDatabaseClose?: () => Promise<void> | void;
  onBeforeCurrentLock?: () => Promise<void>;
}

export default function CurrentDatabaseSecuritySection(
  callbacks: DatabaseSecurityCallbacks,
) {
  const manager = DatabaseManager.getInstance();
  const { flushPendingSave } = useConnections();
  const [target, setTarget] = useState<ConnectionDatabase | null>(() =>
    manager.getCurrentDatabase(),
  );
  const [current, setCurrent] = useState(
    () => manager.getCurrentDatabase()?.id,
  );
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const targetRef = useRef(target?.id);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const clearSecrets = () => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };
  useEffect(
    () =>
      manager.onCurrentDatabaseChange((change) => {
        const next = change.database;
        setCurrent(next?.id);
        if (next && next.id !== targetRef.current) {
          targetRef.current = next.id;
          setTarget(next);
          clearSecrets();
          setMessage(null);
          setError(null);
          setConfirmRemove(false);
        } else if (next && change.reason === "security-change") {
          setTarget(next);
          clearSecrets();
        } else if (!next) {
          clearSecrets();
          setConfirmRemove(false);
        }
      }),
    [manager],
  );
  const context = {
    manager,
    flushCurrent: flushPendingSave,
    onCurrentClosed: callbacks.onDatabaseClose,
    beforeCurrentLock: callbacks.onBeforeCurrentLock,
  };
  const run = async (
    action: "lock" | "open" | "set-password" | "remove-password",
  ) => {
    if (!target || busyRef.current) return;
    const id = target.id;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    let cleanupWarning = "";
    let committedSecurity = false;
    try {
      if (action === "lock") {
        if (!callbacks.onBeforeCurrentLock || !callbacks.onDatabaseClose)
          throw new Error(
            "Lock this database from its primary application window.",
          );
        await performDatabaseAction(id, { type: "lock" }, context);
      } else if (action === "open") {
        if (!callbacks.onDatabaseSelect)
          throw new Error(
            "Open this database from Database Center in the primary window.",
          );
        await callbacks.onDatabaseSelect(id, password || undefined);
        if (manager.getCurrentDatabase()?.id !== id)
          throw new Error(
            "The database was not opened. Check its password and retry.",
          );
      } else {
        if (action === "set-password" && newPassword !== confirmPassword)
          throw new Error("The new database passwords do not match.");
        const outcome = await performDatabaseSecurityAction(
          id,
          action === "set-password"
            ? {
                type: action,
                currentPassword: password || undefined,
                newPassword,
              }
            : { type: action, currentPassword: password },
          context,
        );
        if (!outcome.committed)
          throw new Error("The database password change was not committed.");
        committedSecurity = true;
        if (outcome.cleanupPending || outcome.warnings.length)
          cleanupWarning = ` The password change committed, but recovery cleanup needs attention. ${outcome.warnings.join(" ")}`;
      }
      let fresh: ConnectionDatabase | null | undefined;
      try {
        fresh = await manager.getDatabase(id);
      } catch (refreshError) {
        if (!committedSecurity) throw refreshError;
        const active = manager.getCurrentDatabase();
        fresh =
          active?.id === id
            ? active
            : {
                ...target,
                isEncrypted: action === "set-password",
              };
        cleanupWarning +=
          " The change committed; metadata refresh is unavailable while recovery cleanup may still be pending. Retry the status check before further changes.";
      }
      if (targetRef.current === id) {
        setTarget(fresh ?? null);
        setCurrent(manager.getCurrentDatabase()?.id);
        clearSecrets();
        setMessage(
          (action === "lock"
            ? target.isEncrypted
              ? "Database locked and closed. Its password is no longer cached."
              : "Database closed. It has no separate password layer; global master-key protection is unchanged."
            : action === "open"
              ? "Database opened."
              : action === "remove-password"
                ? "Separate database password removed. Global master-key protection is unchanged."
                : "Database password updated. Global security settings are unchanged.") +
            cleanupWarning,
        );
      }
    } catch (e) {
      if (targetRef.current === id)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Current database security"
      data-setting-key="currentDatabaseSecurity"
      className="space-y-3"
    >
      <h3 className="text-sm font-medium">
        Current database — separate password protection
      </h3>
      <Card>
        <p className="text-xs text-[var(--color-textMuted)]">
          This password protects only this database's connection payload. It
          does not protect database names, the index, trust records, application
          settings, or other databases. The global master key and export
          passwords are separate.
        </p>
        <p className="text-xs text-[var(--color-textMuted)]">
          Closing or locking the current database closes sensitive session and
          editor views in this window, including sessions not attributed to this
          database. Other database passwords and the global master key are
          unchanged.
        </p>
        {!target ? (
          <p className="text-xs">
            No database selected. Open a database in Database Center to manage
            its password.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {current === target.id
                ? "Current database"
                : "Last active database (closed)"}
              : <strong>{target.name}</strong>
            </p>
            <p className="text-xs">
              Separate password:{" "}
              {target.isEncrypted ? "enabled" : "not enabled"}.{" "}
              {current === target.id
                ? "Open in this window."
                : "Not open in this window."}
            </p>
            {target.isEncrypted && (
              <label className="block text-xs">
                Database password
                <input
                  aria-label="Database password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="sor-form-input block w-full"
                />
              </label>
            )}
            {current === target.id ? (
              <>
                <label className="block text-xs">
                  New database password
                  <input
                    aria-label="New database password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={busy}
                    className="sor-form-input block w-full"
                  />
                </label>
                <label className="block text-xs">
                  Confirm database password
                  <input
                    aria-label="Confirm database password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={busy}
                    className="sor-form-input block w-full"
                  />
                </label>
                <div className="flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      newPassword.length < 4 ||
                      newPassword !== confirmPassword ||
                      (target.isEncrypted && !password)
                    }
                    onClick={() => void run("set-password")}
                  >
                    {target.isEncrypted
                      ? "Change database password"
                      : "Enable database password"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !callbacks.onBeforeCurrentLock}
                    onClick={() => void run("lock")}
                  >
                    {target.isEncrypted
                      ? "Lock current database"
                      : "Close current database"}
                  </button>
                  {target.isEncrypted && (
                    <button
                      type="button"
                      disabled={busy || !password}
                      onClick={() => setConfirmRemove(true)}
                    >
                      Remove database password
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                disabled={
                  busy ||
                  !callbacks.onDatabaseSelect ||
                  (target.isEncrypted && !password)
                }
                onClick={() => void run("open")}
              >
                {target.isEncrypted
                  ? "Unlock and open this database"
                  : "Open this database"}
              </button>
            )}
          </>
        )}
        {busy && (
          <p role="status" className="text-xs">
            Saving database security change…
          </p>
        )}
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
      </Card>
      <ConfirmDialog
        isOpen={confirmRemove}
        title="Remove this database's password?"
        message={`Remove the separate password layer from ${target?.name ?? "this database"}? Global master-key protection is unchanged; without that layer, the payload may be plaintext on disk.`}
        variant="danger"
        confirmOnEnter={false}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void run("remove-password");
        }}
      />
    </section>
  );
}
