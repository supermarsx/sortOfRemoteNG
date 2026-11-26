import type { OriginBrowserProxyTheme } from "../../types/protocols/originBrowser";

/** Only palette values cross into internal pages; no arbitrary shell CSS. */
export function readInternalProxyTheme(): OriginBrowserProxyTheme {
  const defaults = {
    background: "#111827",
    surface: "#1f2937",
    text: "#f9fafb",
    textSecondary: "#d1d5db",
    textMuted: "#9ca3af",
    border: "#374151",
    primary: "#3b82f6",
    error: "#ef4444",
    warning: "#f59e0b",
    success: "#10b981",
    info: "#06b6d4",
  };
  const styles =
    typeof document === "undefined"
      ? null
      : getComputedStyle(document.body ?? document.documentElement);
  const colors = Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => {
      const color = styles?.getPropertyValue(`--color-${name}`).trim();
      return [name, color && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback];
    }),
  ) as typeof defaults;
  const rgb = (hex: string) =>
    [1, 3, 5]
      .map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
      .join(", ");
  return {
    ...colors,
    primaryRgb: rgb(colors.primary),
    errorRgb: rgb(colors.error),
    warningRgb: rgb(colors.warning),
    successRgb: rgb(colors.success),
    infoRgb: rgb(colors.info),
  };
}
