import type { GlobalSettings } from "../../types/settings/settings";
import { shouldHideOnClose, type StartupWindowAction } from "./trayPolicy";

interface CloseToTrayOptions {
  settings: Pick<GlobalSettings, "showTrayIcon" | "closeToTray">;
  explicitQuit: boolean;
  preventDefault(): void;
  ensureTray(): Promise<void>;
  hide(): Promise<void>;
  onError(error: unknown): void;
}

/**
 * Attempt a close-to-tray transition. `true` means the window was hidden;
 * `false` means the caller must continue through its normal close policy.
 */
export const handleCloseToTrayRequest = async ({
  settings,
  explicitQuit,
  preventDefault,
  ensureTray,
  hide,
  onError,
}: CloseToTrayOptions): Promise<boolean> => {
  if (!shouldHideOnClose(settings, explicitQuit)) return false;

  // Tauri destroys the window after an unprevented close callback returns, so
  // this must happen synchronously before either native operation is awaited.
  preventDefault();
  try {
    await ensureTray();
    await hide();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
};

export interface StartupWindow {
  show(): Promise<void>;
  hide(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  setFocus(): Promise<void>;
}

/** Apply one startup action, closing the native splash only after the window
 * has reached its requested state to avoid a visible launch flash. */
export const applyStartupWindowAction = async (
  action: StartupWindowAction,
  trayAvailable: boolean,
  window: StartupWindow,
  closeSplash: () => Promise<void>,
): Promise<void> => {
  if (action === "hide-to-tray" && trayAvailable) {
    await window.hide();
    await closeSplash();
    return;
  }

  await window.show();
  if (action === "hide-to-tray" || action === "minimize") {
    // A requested tray launch falls back to the taskbar when native tray
    // creation failed, keeping the app reachable.
    await window.minimize();
    await closeSplash();
    return;
  }
  if (action === "maximize") await window.maximize();
  await closeSplash();
  await window.setFocus();
};
