import { useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { repatriateWindow } from "../../utils/window/windowRepatriation";
import { shouldHideOnMinimize } from "../../utils/window/trayPolicy";

export interface WindowControlsReturn {
  isAlwaysOnTop: boolean;
  isWindowPermissionError: (error: unknown) => boolean;
  handleMinimize: () => Promise<void>;
  handleToggleTransparency: () => Promise<void>;
  handleToggleAlwaysOnTop: () => Promise<void>;
  handleRepatriateWindow: () => Promise<void>;
  handleMaximize: () => Promise<void>;
  handleOpenDevtools: () => Promise<void>;
  handleClose: () => Promise<void>;
}

const hasTauriRuntime = () => typeof isTauri === "function" && isTauri();

export function useWindowControls(
  appSettings: GlobalSettings,
  settingsManager: SettingsManager,
): WindowControlsReturn {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const maximizePending = useRef(false);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const window = getCurrentWindow();
    window.isAlwaysOnTop().then(setIsAlwaysOnTop).catch(console.error);
  }, []);

  const isWindowPermissionError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("not allowed") ||
      message.includes("allow-set-size") ||
      message.includes("allow-set-position")
    );
  }, []);

  const handleMinimize = async () => {
    if (!hasTauriRuntime()) return;
    const window = getCurrentWindow();
    if (shouldHideOnMinimize(appSettings)) {
      try {
        // Reconcile the native icon before hiding. If tray creation fails,
        // preserve reachability by falling back to a normal taskbar minimize.
        await invoke("set_tray_icon_visible", { visible: true });
        await window.hide();
        return;
      } catch (error) {
        console.error("Failed to minimize to the system tray:", error);
      }
    }
    await window.minimize();
  };

  const handleToggleTransparency = async () => {
    const nextValue = !appSettings.windowTransparencyEnabled;
    await settingsManager.saveSettings(
      {
        windowTransparencyEnabled: nextValue,
      },
      { silent: true },
    );
  };

  const handleToggleAlwaysOnTop = async () => {
    if (!hasTauriRuntime()) return;
    const window = getCurrentWindow();
    const nextValue = !isAlwaysOnTop;
    await window.setAlwaysOnTop(nextValue);
    setIsAlwaysOnTop(nextValue);
  };

  const handleRepatriateWindow = async () => {
    if (!hasTauriRuntime()) return;
    try {
      const result = await repatriateWindow(true);
      if (result.wasOffScreen) {
        console.log(
          `Window repatriated from (${result.previousPosition.x}, ${result.previousPosition.y}) ` +
            `to (${result.newPosition.x}, ${result.newPosition.y})` +
            (result.targetMonitor ? ` on ${result.targetMonitor}` : ""),
        );
      } else {
        // Window is already on screen, just center it
        const window = getCurrentWindow();
        await window.center();
      }
    } catch (error) {
      console.error("Failed to repatriate window:", error);
      // Fallback: center the window
      try {
        const window = getCurrentWindow();
        await window.center();
      } catch {
        // Ignore
      }
    }
  };

  const handleMaximize = async () => {
    if (!hasTauriRuntime() || maximizePending.current) return;
    maximizePending.current = true;
    try {
      const window = getCurrentWindow();
      if (await window.isMinimized()) return;
      if (await window.isFullscreen()) {
        await window.setFullscreen(false);
      } else if (await window.isMaximized()) {
        // The native window owns its restore bounds, including monitor DPI.
        // Persisted startup geometry can lag behind the last manual resize.
        await window.unmaximize();
      } else {
        await window.maximize();
      }
    } finally {
      maximizePending.current = false;
    }
  };

  const handleOpenDevtools = async () => {
    if (!hasTauriRuntime()) return;
    await invoke("open_devtools");
  };

  const handleClose = async () => {
    if (!hasTauriRuntime()) return;
    const window = getCurrentWindow();
    await window.close();
  };

  return {
    isAlwaysOnTop,
    isWindowPermissionError,
    handleMinimize,
    handleToggleTransparency,
    handleToggleAlwaysOnTop,
    handleRepatriateWindow,
    handleMaximize,
    handleOpenDevtools,
    handleClose,
  };
}
