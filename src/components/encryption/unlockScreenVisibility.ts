import type { EncryptionStatus } from "../../types/encryption/encryption";

/**
 * Returns whether a locked encryption state needs the blocking unlock overlay.
 *
 * A password prompt is only useful when a master key exists on disk. New or
 * unconfigured installations should continue to the encryption setup flow.
 */
export function shouldShowUnlockScreen(
  status: EncryptionStatus | null,
): boolean {
  if (!status) return false;
  if (status.criticalKeyFailure === true) return true;
  if (status.unlocked) return false;

  return (
    status.vaultHasMasterDek ||
    status.passwordWrapPresent ||
    status.settingsEncryptedOnDisk ||
    !!status.recoveryRequired
  );
}
