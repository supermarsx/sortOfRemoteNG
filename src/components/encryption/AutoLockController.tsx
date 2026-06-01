/**
 * `AutoLockController` — invisible component that wires the live
 * `settings.autoLock` policy into the `useAutoLock` hook.
 *
 * Mounted at the root next to `UnlockScreen`. Returns nothing — its
 * job is purely to keep the auto-lock side-effects subscribed to the
 * latest settings without polluting `AppContent` with hook details.
 *
 * Lives in the encryption folder because the side effect it owns
 * (calling `enc.lock()`) is owned by the encryption subsystem. The
 * settings binding is what makes it user-configurable.
 */
import React from "react";
import { useSettings } from "../../contexts/SettingsContext";
import { useAutoLock } from "../../hooks/settings/useAutoLock";

export const AutoLockController: React.FC = () => {
  const { settings } = useSettings();
  useAutoLock(settings.autoLock);
  return null;
};

export default AutoLockController;
