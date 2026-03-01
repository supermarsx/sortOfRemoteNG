import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GlobalSettings } from "../../types/settings";

/**
 * Applies transparency/theme CSS variables and window background effects.
 */
export function useWindowTheme(
  appSettings: GlobalSettings,
  isWindowPermissionError: (error: unknown) => boolean,
): void {
  useEffect(() => {
    if (!appSettings) return;
    const window = getCurrentWindow();
    const targetOpacity = appSettings.windowTransparencyEnabled
      ? Math.min(1, Math.max(0, appSettings.windowTransparencyOpacity || 1))
      : 1;
    const root = document.documentElement;

    // Get the current theme colors from CSS variables (set by ThemeManager)
    const computedStyle = getComputedStyle(root);
    const background = computedStyle.getPropertyValue('--color-background').trim() || '#111827';
    const surface = computedStyle.getPropertyValue('--color-surface').trim() || '#1f2937';
    const border = computedStyle.getPropertyValue('--color-border').trim() || '#374151';

    // Helper to extract RGB values from color
    const extractRgb = (color: string): { r: number; g: number; b: number } => {
      const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
      if (hex) {
        return {
          r: parseInt(hex[1], 16),
          g: parseInt(hex[2], 16),
          b: parseInt(hex[3], 16),
        };
      }
      const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (rgb) {
        return {
          r: parseInt(rgb[1]),
          g: parseInt(rgb[2]),
          b: parseInt(rgb[3]),
        };
      }
      return { r: 17, g: 24, b: 39 };
    };

    const alpha = appSettings.windowTransparencyEnabled ? targetOpacity : 1;

    // Apply transparency to theme-derived colors
    const bgRgb = extractRgb(background);
    const surfaceRgb = extractRgb(surface);
    const borderRgb = extractRgb(border);

    // Create shades based on theme background color
    root.style.setProperty("--app-surface-900", `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`);
    root.style.setProperty("--app-surface-800", `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, ${alpha})`);
    root.style.setProperty("--app-surface-700", `rgba(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b}, ${alpha})`);

    // Lighter shades (derived from surface color)
    root.style.setProperty("--app-surface-600", `rgba(${Math.min(255, surfaceRgb.r + 20)}, ${Math.min(255, surfaceRgb.g + 20)}, ${Math.min(255, surfaceRgb.b + 20)}, ${alpha})`);
    root.style.setProperty("--app-surface-500", `rgba(${Math.min(255, surfaceRgb.r + 40)}, ${Math.min(255, surfaceRgb.g + 40)}, ${Math.min(255, surfaceRgb.b + 40)}, ${alpha})`);

    // Darker shades (derived from background color)
    root.style.setProperty("--app-slate-950", `rgba(${Math.max(0, bgRgb.r - 15)}, ${Math.max(0, bgRgb.g - 18)}, ${Math.max(0, bgRgb.b - 16)}, ${alpha})`);
    root.style.setProperty("--app-slate-900", `rgba(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b}, ${alpha})`);
    root.style.setProperty("--app-slate-800", `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, ${alpha})`);
    root.style.setProperty("--app-slate-700", `rgba(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b}, ${alpha})`);

    document.documentElement.style.backgroundColor =
      appSettings.windowTransparencyEnabled ? "transparent" : "";
    document.body.style.backgroundColor = appSettings.windowTransparencyEnabled
      ? "transparent"
      : "";
    const setBackgroundColor = window.setBackgroundColor;
    if (typeof setBackgroundColor === "function") {
      const windowAlpha = Math.round(255 * targetOpacity);
      setBackgroundColor([bgRgb.r, bgRgb.g, bgRgb.b, windowAlpha]).catch((error) => {
        if (!isWindowPermissionError(error)) {
          console.error("Failed to set window background color:", error);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appSettings?.windowTransparencyEnabled,
    appSettings?.windowTransparencyOpacity,
    appSettings?.theme,
    appSettings?.colorScheme,
    isWindowPermissionError,
  ]);
}
