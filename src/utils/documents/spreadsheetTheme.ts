import { ColorKit } from "@univerjs/core";
import { defaultTheme, type Theme } from "@univerjs/themes";

export interface SpreadsheetAppearance {
  darkMode: boolean;
  theme: Theme;
  colors: {
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    primary: string;
  };
}

const fallback = {
  background: "#111827",
  surface: "#1f2937",
  text: "#f9fafb",
  textSecondary: "#d1d5db",
  border: "#374151",
  primary: "#3b82f6",
};

const mix = (from: string, to: string, amount: number) =>
  ColorKit.mix(from, to, amount / 100).toHexString();

/** Read resolved colors, not theme names: custom, auto and detached themes work alike. */
export function readSpreadsheetAppearance(
  container: HTMLElement,
): SpreadsheetAppearance {
  const doc = container.ownerDocument;
  const view = doc.defaultView!;
  const styles = [container, doc.body, doc.documentElement].map((node) =>
    view.getComputedStyle(node),
  );
  const token = (name: string, otherwise: string): string => {
    for (const style of styles) {
      const value = style.getPropertyValue(`--color-${name}`).trim();
      if (value && new ColorKit(value).isValid) return value;
    }
    return otherwise;
  };
  const colors = {
    background: token("background", fallback.background),
    surface: token("surface", fallback.surface),
    text: token("text", fallback.text),
    textSecondary: token("textSecondary", fallback.textSecondary),
    border: token("border", fallback.border),
    primary: token("primary", fallback.primary),
  };
  const scheme = styles
    .map((style) => style.getPropertyValue("--native-color-scheme").trim())
    .find((value) => value === "light" || value === "dark");
  const darkMode = scheme
    ? scheme === "dark"
    : new ColorKit(colors.surface).getLuminance() <= 0.179;
  const hover = token("surfaceHover", mix(colors.surface, colors.text, 8));
  const active = token("surfaceActive", mix(colors.surface, colors.text, 15));
  const muted = token(
    "textMuted",
    mix(colors.textSecondary, colors.surface, 30),
  );
  const primary = {
    50: mix(colors.primary, colors.background, 94),
    100: mix(colors.primary, colors.background, 86),
    200: mix(colors.primary, colors.background, 70),
    300: mix(colors.primary, colors.background, 50),
    400: mix(colors.primary, colors.background, 25),
    500: colors.primary,
    600: colors.primary,
    700: mix(colors.primary, colors.text, 12),
    800: mix(colors.primary, colors.text, 22),
    900: mix(colors.primary, colors.text, 32),
  };
  return {
    darkMode,
    colors,
    theme: {
      ...defaultTheme,
      white: darkMode ? colors.text : colors.background,
      black: darkMode ? colors.background : colors.text,
      primary,
      // Some built-in sheet controls use blue rather than the primary token.
      blue: primary,
      gray: darkMode
        ? {
            50: colors.text,
            100: colors.text,
            200: colors.textSecondary,
            300: muted,
            400: muted,
            500: muted,
            600: colors.border,
            700: active,
            800: hover,
            900: colors.surface,
          }
        : {
            50: colors.surface,
            100: hover,
            200: colors.border,
            300: colors.border,
            400: muted,
            500: colors.textSecondary,
            600: colors.textSecondary,
            700: colors.text,
            800: colors.text,
            900: colors.text,
          },
    },
  };
}

/** Canvas colors are presentation only; never add theme styles to workbook data. */
export function createSpreadsheetCanvasColors(
  getAppearance: () => SpreadsheetAppearance,
) {
  let previous: SpreadsheetAppearance | undefined;
  const cache = new Map<string, string>();
  return {
    getRenderColor(color: string): string {
      const appearance = getAppearance();
      if (appearance !== previous) {
        previous = appearance;
        cache.clear();
      }
      const cached = cache.get(color);
      if (cached !== undefined) return cached;
      const [name, shade] = color.split(".");
      const value = Object.prototype.hasOwnProperty.call(appearance.theme, name)
        ? appearance.theme[name as keyof Theme]
        : undefined;
      const themed =
        typeof value === "string"
          ? value
          : value && shade && Object.prototype.hasOwnProperty.call(value, shade)
            ? (value as Record<string, string>)[shade]
            : undefined;
      let result = themed ?? color;
      // ColorKit 0.25.1 parses the CSS transparent keyword as opaque white.
      if (!themed && color.trim().toLowerCase() !== "transparent") {
        const parsed = new ColorKit(color);
        if (parsed.isValid && parsed.getAlpha() === 1) {
          // Pinned Univer defaults for paper, ink, headers and grid lines.
          // Other authored colors (including transparent fills) stay intact.
          switch (parsed.toHexString().toLowerCase()) {
            case "#ffffff":
              result = appearance.colors.background;
              break;
            case "#000000":
              result = appearance.colors.text;
              break;
            case "#f8f9fa":
              result = appearance.colors.surface;
              break;
            case "#d9d9d9":
            case "#d6d8db":
            case "#cdd0d8":
              result = appearance.colors.border;
              break;
          }
        }
      }
      // Bound retained color data even for large imported workbooks.
      if (cache.size >= 2048) cache.clear();
      cache.set(color, result);
      return result;
    },
  };
}

/** Observe only theme attributes, never editor DOM mutations or canvas rendering. */
export function watchSpreadsheetAppearance(
  container: HTMLElement,
  initial: SpreadsheetAppearance,
  update: (appearance: SpreadsheetAppearance) => void,
): () => void {
  const doc = container.ownerDocument;
  let signature = JSON.stringify(initial);
  const observer = new doc.defaultView!.MutationObserver(() => {
    const next = readSpreadsheetAppearance(container);
    const nextSignature = JSON.stringify(next);
    if (signature === nextSignature) return;
    signature = nextSignature;
    update(next);
  });
  for (const node of [doc.documentElement, doc.body])
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
  return () => observer.disconnect();
}
