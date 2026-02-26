import { useState, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { GlobalSettings } from "../types/settings";
import { SettingsManager } from "../utils/settingsManager";
import {
  repatriateWindow,
} from "../utils/windowRepatriation";

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

export function useWindowControls(
  appSettings: GlobalSettings,
  settingsManager: SettingsManager,
): WindowControlsReturn {
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);

  useEffect(() => {
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
    const window = getCurrentWindow();
    await window.minimize();
  };

  const handleToggleTransparency = async () => {
    const nextValue = !appSettings.windowTransparencyEnabled;
    await settingsManager.saveSettings({
      windowTransparencyEnabled: nextValue,
    }, { silent: true });
  };

  const handleToggleAlwaysOnTop = async () => {
    const window = getCurrentWindow();
    const nextValue = !isAlwaysOnTop;
    await window.setAlwaysOnTop(nextValue);
    setIsAlwaysOnTop(nextValue);
  };

  const handleRepatriateWindow = async () => {
    try {
      const result = await repatriateWindow(true);
      if (result.wasOffScreen) {
        console.log(
          `Window repatriated from (${result.previousPosition.x}, ${result.previousPosition.y}) ` +
            `to (${result.newPosition.x}, ${result.newPosition.y})` +
            (result.targetMonitor ? ` on ${result.targetMonitor}` : "")
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
    const window = getCurrentWindow();
    const isMaximized = await window.isMaximized();
    if (isMaximized) {
      await window.unmaximize();
      if (appSettings.persistWindowSize && appSettings.windowSize) {
        const { width, height } = appSettings.windowSize;
        await window.setSize(new LogicalSize(width, height));
      }
      return;
    }
    await window.maximize();
  };

  const handleOpenDevtools = async () => {
    await invoke("open_devtools");
  };

  const handleClose = async () => {
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
