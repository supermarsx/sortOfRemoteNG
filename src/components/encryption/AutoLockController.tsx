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
import { useLockShortcut } from "../../hooks/settings/useLockShortcut";

export const AutoLockController: React.FC = () => {
  const { settings } = useSettings();
  useAutoLock(settings.autoLock);
  // Global Ctrl+L / ⌘L lock-now shortcut. Lives here (rather than in
  // `useAutoLock`) because it shouldn't be gated by the auto-lock
  // policy — the manual lock-on-demand keystroke is independent of
  // whether the user has configured idle/blur/minimise triggers.
  useLockShortcut();
  return null;
};

export default AutoLockController;
