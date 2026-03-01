import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { GlobalSettings } from "../../types/settings";
import { SettingsManager } from "../../utils/settingsManager";
import { validateSavedPosition } from "../../utils/windowRepatriation";

/**
 * Persists and restores window size, position, and sidebar layout settings.
 */
export function useWindowPersistence(
  appSettings: GlobalSettings,
  settingsManager: SettingsManager,
  isInitialized: boolean,
  isWindowPermissionError: (error: unknown) => boolean,
  sidebarWidth: number,
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>,
  sidebarPosition: "left" | "right",
  setSidebarPosition: React.Dispatch<React.SetStateAction<"left" | "right">>,
  sidebarCollapsed: boolean,
  dispatch: React.Dispatch<{ type: "SET_SIDEBAR_COLLAPSED"; payload: boolean } | any>,
): void {
  const windowSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const sidebarSaveTimeout = useRef<NodeJS.Timeout | null>(null);

  // Restore sidebar width/position/collapsed state from settings
  useEffect(() => {
    if (!appSettings) return;

    if (appSettings.persistSidebarWidth && appSettings.sidebarWidth) {
      setSidebarWidth(appSettings.sidebarWidth);
    }

    if (appSettings.persistSidebarPosition && appSettings.sidebarPosition) {
      setSidebarPosition(appSettings.sidebarPosition);
    }

    if (
      appSettings.persistSidebarCollapsed &&
      typeof appSettings.sidebarCollapsed === "boolean"
    ) {
      dispatch({
        type: "SET_SIDEBAR_COLLAPSED",
        payload: appSettings.sidebarCollapsed,
      });
    }
  }, [appSettings, dispatch, setSidebarWidth, setSidebarPosition]);

  // Restore window size and position
  useEffect(() => {
    if (!isInitialized) return;

    const window = getCurrentWindow();

    // Minimum window size constraints
    const MIN_WIDTH = 800;
    const MIN_HEIGHT = 600;

    const savedWidth = appSettings.windowSize?.width || MIN_WIDTH;
    const savedHeight = appSettings.windowSize?.height || MIN_HEIGHT;

    if (appSettings.persistWindowSize && appSettings.windowSize) {
      const { width, height } = appSettings.windowSize;
      // Validate and enforce minimum size
      const validWidth = Math.max(width || MIN_WIDTH, MIN_WIDTH);
      const validHeight = Math.max(height || MIN_HEIGHT, MIN_HEIGHT);
      window.setSize(new LogicalSize(validWidth, validHeight)).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error(error);
        }
      });
    }

    if (appSettings.persistWindowPosition && appSettings.windowPosition) {
      const { x, y } = appSettings.windowPosition;
      // Validate position is on a visible screen if auto-repatriate is enabled
      if (appSettings.autoRepatriateWindow) {
        validateSavedPosition(
          { x: x ?? 0, y: y ?? 0 },
          { width: savedWidth, height: savedHeight }
        )
          .then((result) => {
            if (result) {
              window.setPosition(new LogicalPosition(result.position.x, result.position.y)).catch((error) => {
                if (!isWindowPermissionError(error)) {
                  console.error(error);
                }
              });
              if (result.adjusted) {
                console.log("Window position adjusted: saved position was off-screen");
              }
            } else {
              // Fallback: center the window
              window.center().catch(console.error);
            }
          })
          .catch((error) => {
            console.error("Failed to validate window position:", error);
            // Fallback to saved position
            window.setPosition(new LogicalPosition(x ?? 0, y ?? 0)).catch(console.error);
          });
      } else {
        // Allow negative coordinates for multi-monitor setups without validation
        const validX = x ?? 0;
        const validY = y ?? 0;
        window.setPosition(new LogicalPosition(validX, validY)).catch((error) => {
          if (!isWindowPermissionError(error)) {
            console.error(error);
          }
        });
      }
    }
  }, [
    appSettings.persistWindowSize,
    appSettings.persistWindowPosition,
    appSettings.autoRepatriateWindow,
    appSettings.windowSize,
    appSettings.windowPosition,
    isInitialized,
    isWindowPermissionError,
  ]);

  // Listen for window resize/move events and persist
  useEffect(() => {
    if (!isInitialized) return;

    const window = getCurrentWindow();
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    const saveWindowState = async () => {
      try {
        const [size, position, scaleFactor] = await Promise.all([
          window.innerSize(),
          window.outerPosition(),
          window.scaleFactor(),
        ]);

        const updates: Partial<GlobalSettings> = {};
        const isMaximized = await window.isMaximized();
        if (isMaximized) {
          return;
        }
        if (appSettings.persistWindowSize) {
          const logicalSize = size.toLogical(scaleFactor);
          updates.windowSize = {
            width: logicalSize.width,
            height: logicalSize.height,
          };
        }
        if (appSettings.persistWindowPosition) {
          const logicalPosition = position.toLogical(scaleFactor);
          updates.windowPosition = {
            x: logicalPosition.x,
            y: logicalPosition.y,
          };
        }

        if (Object.keys(updates).length > 0) {
          await settingsManager.saveSettings(updates, { silent: true });
        }
      } catch (error) {
        console.error("Failed to persist window state:", error);
      }
    };

    const queueSave = () => {
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
      }
      windowSaveTimeout.current = setTimeout(() => {
        saveWindowState().catch(console.error);
      }, 500);
    };

    if (appSettings.persistWindowSize && (window as any).onResized) {
      window
        .onResized(() => {
          queueSave();
        })
        .then((unlisten) => {
          unlistenResize = unlisten;
        })
        .catch(console.error);
    }

    if (appSettings.persistWindowPosition && (window as any).onMoved) {
      window
        .onMoved(() => {
          queueSave();
        })
        .then((unlisten) => {
          unlistenMove = unlisten;
        })
        .catch(console.error);
    }

    return () => {
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
      }
      if (unlistenResize) {
        unlistenResize();
      }
      if (unlistenMove) {
        unlistenMove();
      }
    };
  }, [
    appSettings.persistWindowSize,
    appSettings.persistWindowPosition,
    isInitialized,
    settingsManager,
  ]);

  // Persist sidebar state changes
  useEffect(() => {
    if (!appSettings) return;

    if (
      !appSettings.persistSidebarWidth &&
      !appSettings.persistSidebarPosition &&
      !appSettings.persistSidebarCollapsed
    ) {
      return;
    }

    if (sidebarSaveTimeout.current) {
      clearTimeout(sidebarSaveTimeout.current);
    }

    sidebarSaveTimeout.current = setTimeout(() => {
      const updates: Partial<GlobalSettings> = {};
      if (appSettings.persistSidebarWidth) {
        updates.sidebarWidth = sidebarWidth;
      }
      if (appSettings.persistSidebarPosition) {
        updates.sidebarPosition = sidebarPosition;
      }
      if (appSettings.persistSidebarCollapsed) {
        updates.sidebarCollapsed = sidebarCollapsed;
      }

      if (Object.keys(updates).length > 0) {
        settingsManager.saveSettings(updates, { silent: true }).catch(console.error);
      }
    }, 300);

    return () => {
      if (sidebarSaveTimeout.current) {
        clearTimeout(sidebarSaveTimeout.current);
      }
    };
  }, [
    appSettings,
    sidebarWidth,
    sidebarPosition,
    sidebarCollapsed,
    settingsManager,
  ]);
}
