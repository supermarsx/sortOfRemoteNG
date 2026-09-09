import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useMasterRecovery } from "../../hooks/settings/useMasterRecovery";

export function MasterKeyRecoveryPanel({
  onRestored,
  onBusyChange,
  disabled = false,
}: {
  onRestored: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const recovery = useMasterRecovery(onRestored);
  const [path, setPath] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const busy = recovery.busy || disabled;
  useEffect(() => {
    onBusyChange?.(recovery.busy);
    return () => onBusyChange?.(false);
  }, [onBusyChange, recovery.busy]);
  const choose = async () => {
    if (busy) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Choose password-protected master-key backup",
        multiple: false,
        directory: false,
        filters: [{ name: "Portable master key", extensions: ["dek"] }],
      });
      if (typeof selected === "string") {
        await recovery.cancel();
        setPath(selected);
        setPickerError(null);
      }
    } catch (failure) {
      setPickerError(
        failure instanceof Error ? failure.message : String(failure),
      );
    }
  };
  const prepare = async () => {
    if (busy || newPassword !== confirmPassword) return;
    const password = backupPassword,
      replacement = newPassword;
    setBackupPassword("");
    setNewPassword("");
    setConfirmPassword("");
    await recovery.prepare(path, password, replacement);
  };
  const inputClass =
    "w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-text)] disabled:opacity-50";
  return (
    <section
      aria-label="Verified master-key recovery"
      className="space-y-3 text-xs"
    >
      <p>
        Restore the original key from a password-protected <code>.dek</code>{" "}
        backup. Native validation must prove it belongs to this profile. This
        does not reset encryption, replace encrypted data, or repair damaged
        artifacts.
      </p>
      {!recovery.challenge && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void choose()}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Choose portable master key file
          </button>
          {path && (
            <p className="break-all" aria-label="Selected recovery file">
              {path}
            </p>
          )}
          <label className="block">
            Backup password
            <input
              type="password"
              autoComplete="off"
              value={backupPassword}
              maxLength={1024}
              onChange={(event) => setBackupPassword(event.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </label>
          <label className="block">
            New local master password
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              maxLength={1024}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </label>
          <label className="block">
            Confirm new local master password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              maxLength={1024}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </label>
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-warning">The new passwords must match.</p>
          )}
          <button
            type="button"
            disabled={
              busy ||
              !path ||
              !backupPassword ||
              !newPassword ||
              newPassword !== confirmPassword
            }
            onClick={() => void prepare()}
            className="rounded bg-primary px-3 py-2 text-[var(--color-text)] disabled:opacity-50"
          >
            {busy ? "Authenticating backup…" : "Verify recovery key"}
          </button>
        </>
      )}
      {recovery.challenge && (
        <>
          <p>
            Current profile verified using:{" "}
            {recovery.challenge.verified.join(", ")}.
          </p>
          <p role="status">
            {recovery.remainingMs > 0
              ? `Native safety delay: ${Math.ceil(recovery.remainingMs / 1000)} seconds.`
              : "Ready for explicit recovery confirmation."}{" "}
            The native challenge expires after two minutes.
          </p>
          {recovery.challenge.warnings.map((warning) => (
            <p key={warning} className="text-warning">
              {warning}
            </p>
          ))}
          <p>
            Only the local password receipt will change. Its previous bytes are
            kept in a recovery backup. The OS vault and existing artifact
            policies stay unchanged.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || recovery.remainingMs > 0}
              onClick={() => void recovery.commit()}
              className="rounded bg-primary px-3 py-2 text-[var(--color-text)] disabled:opacity-50"
            >
              Restore verified key
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void recovery.cancel().catch(() => undefined)}
            >
              Cancel recovery
            </button>
          </div>
        </>
      )}
      {(pickerError || recovery.error) && (
        <p role="alert" className="text-error">
          {pickerError || recovery.error}
        </p>
      )}
      {recovery.report && (
        <div role="status">
          <p>Original key receipt restored.</p>
          {recovery.report.oldWrapperBackup && (
            <p>Previous receipt retained: {recovery.report.oldWrapperBackup}</p>
          )}
          {recovery.report.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
      <p className="text-[var(--color-textMuted)]">
        The 10-second delay is a confirmation safeguard, not a password-strength
        or brute-force guarantee.
      </p>
    </section>
  );
}
