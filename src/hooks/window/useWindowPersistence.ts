import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { validateSavedPosition } from "../../utils/window/windowRepatriation";

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
  dispatch: React.Dispatch<
    { type: "SET_SIDEBAR_COLLAPSED"; payload: boolean } | any
  >,
): void {
  const windowSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  const sidebarSaveTimeout = useRef<NodeJS.Timeout | null>(null);
  // Latest settings snapshot, readable from effects without being a
  // dependency. `appSettings` is replaced with a fresh object on every
  // `settings-updated` broadcast, so depending on the whole object would
  // re-run persistence effects after each save.
  const latestSettingsRef = useRef<GlobalSettings>(appSettings);
  latestSettingsRef.current = appSettings;

  const persistSidebarWidth = appSettings?.persistSidebarWidth ?? false;
  const persistSidebarPosition = appSettings?.persistSidebarPosition ?? false;
  const persistSidebarCollapsed = appSettings?.persistSidebarCollapsed ?? false;
  const savedSidebarWidth = appSettings?.sidebarWidth;
  const savedSidebarPosition = appSettings?.sidebarPosition;
  const savedSidebarCollapsed = appSettings?.sidebarCollapsed;

  // Restore sidebar width/position/collapsed state from settings
  useEffect(() => {
    if (persistSidebarWidth && savedSidebarWidth) {
      setSidebarWidth(savedSidebarWidth);
    }

    if (persistSidebarPosition && savedSidebarPosition) {
      setSidebarPosition(savedSidebarPosition);
    }

    if (persistSidebarCollapsed && typeof savedSidebarCollapsed === "boolean") {
      dispatch({
        type: "SET_SIDEBAR_COLLAPSED",
        payload: savedSidebarCollapsed,
      });
    }
  }, [
    persistSidebarWidth,
    persistSidebarPosition,
    persistSidebarCollapsed,
    savedSidebarWidth,
    savedSidebarPosition,
    savedSidebarCollapsed,
    dispatch,
    setSidebarWidth,
    setSidebarPosition,
  ]);

  // Restore window size and position
  useEffect(() => {
    if (!isInitialized || typeof isTauri !== "function" || !isTauri()) return;

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
      window
        .setSize(new LogicalSize(validWidth, validHeight))
        .catch((error) => {
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
          { width: savedWidth, height: savedHeight },
        )
          .then((result) => {
            if (result) {
              window
                .setPosition(
                  new LogicalPosition(result.position.x, result.position.y),
                )
                .catch((error) => {
                  if (!isWindowPermissionError(error)) {
                    console.error(error);
                  }
                });
              if (result.adjusted) {
                console.log(
                  "Window position adjusted: saved position was off-screen",
                );
              }
            } else {
              // Fallback: center the window
              window.center().catch(console.error);
            }
          })
          .catch((error) => {
            console.error("Failed to validate window position:", error);
            // Fallback to saved position
            window
              .setPosition(new LogicalPosition(x ?? 0, y ?? 0))
              .catch(console.error);
          });
      } else {
        // Allow negative coordinates for multi-monitor setups without validation
        const validX = x ?? 0;
        const validY = y ?? 0;
        window
          .setPosition(new LogicalPosition(validX, validY))
          .catch((error) => {
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
    if (!isInitialized || typeof isTauri !== "function" || !isTauri()) return;

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

  // Persist sidebar state changes.
  //
  // Only the live sidebar values and the persist flags are dependencies —
  // NOT `appSettings`. Every `saveSettings` broadcasts `settings-updated`,
  // which hands App a brand-new settings object; if that object were a
  // dependency this effect would re-run, re-save the unchanged sidebar
  // values, broadcast again, and loop forever (~3 saves/s), re-rendering the
  // whole app each time (measured: t61-e5). The values are also diffed
  // against the latest snapshot so an already-persisted state is never
  // re-saved.
  useEffect(() => {
    if (
      !persistSidebarWidth &&
      !persistSidebarPosition &&
      !persistSidebarCollapsed
    ) {
      return;
    }

    if (sidebarSaveTimeout.current) {
      clearTimeout(sidebarSaveTimeout.current);
    }

    sidebarSaveTimeout.current = setTimeout(() => {
      sidebarSaveTimeout.current = null;
      const current = latestSettingsRef.current;
      const updates: Partial<GlobalSettings> = {};
      if (persistSidebarWidth && current?.sidebarWidth !== sidebarWidth) {
        updates.sidebarWidth = sidebarWidth;
      }
      if (
        persistSidebarPosition &&
        current?.sidebarPosition !== sidebarPosition
      ) {
        updates.sidebarPosition = sidebarPosition;
      }
      if (
        persistSidebarCollapsed &&
        current?.sidebarCollapsed !== sidebarCollapsed
      ) {
        updates.sidebarCollapsed = sidebarCollapsed;
      }

      if (Object.keys(updates).length > 0) {
        settingsManager
          .saveSettings(updates, { silent: true })
          .catch(console.error);
      }
    }, 300);

    return () => {
      if (sidebarSaveTimeout.current) {
        clearTimeout(sidebarSaveTimeout.current);
        sidebarSaveTimeout.current = null;
      }
    };
  }, [
    persistSidebarWidth,
    persistSidebarPosition,
    persistSidebarCollapsed,
    sidebarWidth,
    sidebarPosition,
    sidebarCollapsed,
    settingsManager,
  ]);
}
