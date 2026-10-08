"use client";

import { useEffect, useState } from "react";
import type { WebsiteDarkTheme } from "../../types/connection/websiteDarkMode";

export interface WebsiteAppPalette {
  backgroundColor: string;
  textColor: string;
}

function hexColor(value: string): string | null {
  const color = value.trim();
  if (/^#[\da-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(color))
    return `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`;
  const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/i.exec(color);
  if (!rgb || rgb.slice(1).some((part) => Number(part) > 255)) return null;
  return `#${rgb
    .slice(1)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Read only the trusted shell's palette, never the website DOM. */
export function readWebsiteAppPalette(): WebsiteAppPalette | null {
  if (typeof document === "undefined" || !document.body) return null;
  const styles = getComputedStyle(document.body);
  const backgroundColor = hexColor(
    styles.getPropertyValue("--color-background"),
  );
  const textColor = hexColor(styles.getPropertyValue("--color-text"));
  return backgroundColor && textColor ? { backgroundColor, textColor } : null;
}

export function useWebsiteAppPalette(): WebsiteAppPalette | null {
  const [palette, setPalette] = useState<WebsiteAppPalette | null>(null);
  useEffect(() => {
    const update = () => {
      const next = readWebsiteAppPalette();
      setPalette((previous) =>
        previous?.backgroundColor === next?.backgroundColor &&
        previous?.textColor === next?.textColor
          ? previous
          : next,
      );
    };
    update();
    // ThemeManager batches inline variables on body. Observe attributes only,
    // not page/child mutations or a timer scanning the app on every frame.
    const observer = new MutationObserver(update);
    for (const element of [document.body, document.documentElement])
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["style", "class", "data-theme"],
      });
    return () => observer.disconnect();
  }, []);
  return palette;
}

/** Keep the legacy page bridge's closed theme schema unchanged. */
export function websiteDarkThemeForPage(
  theme: WebsiteDarkTheme,
  palette: WebsiteAppPalette | null,
): Omit<WebsiteDarkTheme, "followAppTheme"> {
  const { followAppTheme, ...appearance } = theme;
  return followAppTheme !== false && palette
    ? { ...appearance, ...palette }
    : appearance;
}
