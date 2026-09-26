import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/dpi";
import { GlobalSettings } from "../../types/settings/settings";
import { SettingsManager } from "../../utils/settings/settingsManager";
import { validateSavedPosition } from "../../utils/window/windowRepatriation";

async function hasNormalBounds(window: ReturnType<typeof getCurrentWindow>) {
  const states = await Promise.all([
    window.isMaximized(),
    window.isFullscreen(),
    window.isMinimized(),
  ]);
  return states.every((state) => !state);
}

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
  const permissionErrorRef = useRef(isWindowPermissionError);
  permissionErrorRef.current = isWindowPermissionError;
  const restoringRef = useRef<object | null>(null);
  const geometryRevision = useRef(0);

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

  // Saved geometry is persistence output, not a live resize command. Restore
  // on initialization / preference changes only, never on save broadcasts.
  useEffect(() => {
    if (!isInitialized || typeof isTauri !== "function" || !isTauri()) return;

    const window = getCurrentWindow();
    const settings = latestSettingsRef.current;
    const restore = {};
    restoringRef.current = restore;
    geometryRevision.current += 1;
    let cancelled = false;
    const canRestore = async () => {
      const normal = await hasNormalBounds(window);
      return !cancelled && normal;
    };
    const reportError = (error: unknown) => {
      if (!permissionErrorRef.current(error)) console.error(error);
    };

    const restoreWindow = async () => {
      if (!(await canRestore())) return;
      const validDimension = (value: number | undefined, minimum: number) =>
        Number.isFinite(value) ? Math.max(value!, minimum) : minimum;
      const size = new LogicalSize(
        validDimension(settings.windowSize?.width, 800),
        validDimension(settings.windowSize?.height, 600),
      );

      // Move first so a logical inner size is applied at the destination DPI.
      if (settings.persistWindowPosition && settings.windowPosition) {
        const { x, y } = settings.windowPosition;
        let position: LogicalPosition | PhysicalPosition | null =
          new LogicalPosition(
            Number.isFinite(x) ? x : 0,
            Number.isFinite(y) ? y : 0,
          );
        try {
          if (settings.autoRepatriateWindow) {
            const scale = await window.scaleFactor();
            if (!Number.isFinite(scale) || scale <= 0) return;
            // Monitor work areas and validation results are physical pixels.
            const result = await validateSavedPosition(
              position.toPhysical(scale),
              size.toPhysical(scale),
            );
            position = result
              ? new PhysicalPosition(result.position.x, result.position.y)
              : null;
          }
        } catch (error) {
          reportError(error);
        }
        if (!(await canRestore())) return;
        try {
          if (position) await window.setPosition(position);
          else await window.center();
        } catch (error) {
          reportError(error);
        }
      }
      if (settings.persistWindowSize && settings.windowSize) {
        if (!(await canRestore())) return;
        await window.setSize(size);
      }
    };
    void restoreWindow()
      .catch(reportError)
      .finally(() => {
        if (restoringRef.current === restore) restoringRef.current = null;
      });

    return () => {
      cancelled = true;
      // Invalidate outstanding reads using the live shared counter.
      geometryRevision.current += 1;
      if (restoringRef.current === restore) restoringRef.current = null;
    };
  }, [
    appSettings.persistWindowSize,
    appSettings.persistWindowPosition,
    appSettings.autoRepatriateWindow,
    isInitialized,
  ]);

  // Listen for window resize/move events and persist
  useEffect(() => {
    if (!isInitialized || typeof isTauri !== "function" || !isTauri()) return;

    const window = getCurrentWindow();
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let disposed = false;

    const saveWindowState = async () => {
      const revision = geometryRevision.current;
      const isStale = () =>
        disposed ||
        restoringRef.current !== null ||
        revision !== geometryRevision.current;
      try {
        if (isStale() || !(await hasNormalBounds(window))) return;
        const [size, position, scaleFactor] = await Promise.all([
          window.innerSize(),
          window.outerPosition(),
          window.scaleFactor(),
        ]);

        // IPC reads can straddle a state change, monitor change, or teardown.
        const [normal, currentScale] = await Promise.all([
          hasNormalBounds(window),
          window.scaleFactor(),
        ]);
        if (
          isStale() ||
          !normal ||
          currentScale !== scaleFactor ||
          !Number.isFinite(scaleFactor) ||
          scaleFactor <= 0 ||
          !Number.isFinite(size.width) ||
          !Number.isFinite(size.height) ||
          size.width <= 0 ||
          size.height <= 0 ||
          !Number.isFinite(position.x) ||
          !Number.isFinite(position.y)
        )
          return;

        const updates: Partial<GlobalSettings> = {};
        const current = latestSettingsRef.current;
        if (appSettings.persistWindowSize) {
          const logicalSize = size.toLogical(scaleFactor);
          if (
            current.windowSize?.width !== logicalSize.width ||
            current.windowSize?.height !== logicalSize.height
          ) {
            updates.windowSize = {
              width: logicalSize.width,
              height: logicalSize.height,
            };
          }
        }
        if (appSettings.persistWindowPosition) {
          const logicalPosition = position.toLogical(scaleFactor);
          if (
            current.windowPosition?.x !== logicalPosition.x ||
            current.windowPosition?.y !== logicalPosition.y
          ) {
            updates.windowPosition = {
              x: logicalPosition.x,
              y: logicalPosition.y,
            };
          }
        }

        if (Object.keys(updates).length > 0) {
          await settingsManager.saveSettings(updates, { silent: true });
        }
      } catch (error) {
        console.error("Failed to persist window state:", error);
      }
    };

    const queueSave = () => {
      if (disposed) return;
      geometryRevision.current += 1;
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
        windowSaveTimeout.current = null;
      }
      if (restoringRef.current) return;
      windowSaveTimeout.current = setTimeout(() => {
        windowSaveTimeout.current = null;
        saveWindowState().catch(console.error);
      }, 500);
    };

    if (appSettings.persistWindowSize && (window as any).onResized) {
      window
        .onResized(() => {
          queueSave();
        })
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenResize = unlisten;
        })
        .catch(console.error);
    }

    if (appSettings.persistWindowPosition && (window as any).onMoved) {
      window
        .onMoved(() => {
          queueSave();
        })
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenMove = unlisten;
        })
        .catch(console.error);
    }

    return () => {
      disposed = true;
      geometryRevision.current += 1;
      if (windowSaveTimeout.current) {
        clearTimeout(windowSaveTimeout.current);
        windowSaveTimeout.current = null;
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
