import type {
  WebsiteDarkModeConfig,
  WebsiteDarkModeSettings,
  WebsiteDarkPreset,
  WebsiteDarkTheme,
} from "../../types/connection/websiteDarkMode";

export const MAX_WEBSITE_DARK_CSS_BYTES = 16_384;
export const MAX_WEBSITE_DARK_PRESETS = 32;
export const DEFAULT_WEBSITE_DARK_THEME: Readonly<WebsiteDarkTheme> =
  Object.freeze({
    mode: "dynamic",
    brightness: 100,
    contrast: 100,
    sepia: 0,
    grayscale: 0,
    backgroundColor: "#181a1b",
    textColor: "#e8e6e3",
    preserveMedia: true,
    customCss: "",
  });
export const BUILTIN_WEBSITE_DARK_PRESETS: readonly WebsiteDarkPreset[] =
  Object.freeze([
    {
      id: "builtin-comfortable",
      name: "Comfortable",
      theme: { ...DEFAULT_WEBSITE_DARK_THEME },
    },
    {
      id: "builtin-dim",
      name: "Dim",
      theme: { ...DEFAULT_WEBSITE_DARK_THEME, brightness: 85 },
    },
    {
      id: "builtin-amoled",
      name: "AMOLED",
      theme: {
        ...DEFAULT_WEBSITE_DARK_THEME,
        backgroundColor: "#000000",
        textColor: "#eeeeee",
      },
    },
    {
      id: "builtin-sepia",
      name: "Sepia",
      theme: {
        ...DEFAULT_WEBSITE_DARK_THEME,
        sepia: 30,
        backgroundColor: "#211c15",
        textColor: "#e8ddc8",
      },
    },
  ]);

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid dark-mode extension settings.");
  return value as Record<string, unknown>;
}

const SAFE_CSS_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "calc",
  "min",
  "max",
  "clamp",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
  "is",
  "where",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-of-type",
  "nth-last-of-type",
]);

/** Deliberately restricted local CSS, not a general stylesheet interpreter.
 * No escapes/comments/at-rules or resource-producing/indirect functions. The
 * native page bridge mirrors this boundary before creating any style node. */
export function validateWebsiteDarkCss(value: unknown): string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > MAX_WEBSITE_DARK_CSS_BYTES
  )
    throw new Error("Custom CSS must be text of at most 16 KiB.");
  if (
    /@|\\|\/\*|\*\/|</.test(value) ||
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    }) ||
    /(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(value)
  )
    throw new Error(
      "Use local CSS only: no at-rules, imports, escapes, comments, or executable properties.",
    );
  for (const match of value.matchAll(/([a-zA-Z_-][a-zA-Z0-9_-]*)\s*\(/g)) {
    if (!SAFE_CSS_FUNCTIONS.has(match[1].toLowerCase()))
      throw new Error(
        "Custom CSS permits only local colors, calculations, gradients, and selector functions; URL, var, and attr functions are unavailable.",
      );
  }
  return value;
}

export function normalizeWebsiteDarkTheme(value: unknown): WebsiteDarkTheme {
  if (value === undefined) return { ...DEFAULT_WEBSITE_DARK_THEME };
  const theme = record(value, Object.keys(DEFAULT_WEBSITE_DARK_THEME));
  if (
    !["dynamic", "filter", "dynamicFilter", "customCss"].includes(
      theme.mode as string,
    )
  )
    throw new Error("Select a supported dark-mode extension mode.");
  for (const [key, maximum] of [
    ["brightness", 200],
    ["contrast", 200],
    ["sepia", 100],
    ["grayscale", 100],
  ] as const)
    if (
      typeof theme[key] !== "number" ||
      !Number.isFinite(theme[key]) ||
      theme[key] < 0 ||
      theme[key] > maximum
    )
      throw new Error(`${key} must be between 0 and ${maximum}.`);
  for (const key of ["backgroundColor", "textColor"] as const)
    if (typeof theme[key] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(theme[key]))
      throw new Error("Use a six-digit hexadecimal background and text color.");
  if (typeof theme.preserveMedia !== "boolean")
    throw new Error("Choose whether to preserve media.");
  return {
    mode: theme.mode as WebsiteDarkTheme["mode"],
    brightness: theme.brightness as number,
    contrast: theme.contrast as number,
    sepia: theme.sepia as number,
    grayscale: theme.grayscale as number,
    backgroundColor: (theme.backgroundColor as string).toLowerCase(),
    textColor: (theme.textColor as string).toLowerCase(),
    preserveMedia: theme.preserveMedia,
    customCss: validateWebsiteDarkCss(theme.customCss),
  };
}

export function normalizeWebsiteDarkModeConfig(
  value: unknown,
): WebsiteDarkModeConfig {
  if (value === undefined)
    return {
      version: 1,
      useGlobalDefaults: true,
      theme: normalizeWebsiteDarkTheme(undefined),
    };
  const config = record(value, ["version", "useGlobalDefaults", "theme"]);
  if (
    config.version !== 1 ||
    typeof config.useGlobalDefaults !== "boolean" ||
    config.theme === undefined
  )
    throw new Error("Invalid connection dark-mode extension settings.");
  return {
    version: 1,
    useGlobalDefaults: config.useGlobalDefaults,
    theme: normalizeWebsiteDarkTheme(config.theme),
  };
}

export function normalizeWebsiteDarkModeSettings(
  value: unknown,
): WebsiteDarkModeSettings {
  if (value === undefined)
    return {
      version: 1,
      defaults: normalizeWebsiteDarkTheme(undefined),
      presets: [],
    };
  const config = record(value, ["version", "defaults", "presets"]);
  if (
    config.version !== 1 ||
    config.defaults === undefined ||
    !Array.isArray(config.presets) ||
    config.presets.length > MAX_WEBSITE_DARK_PRESETS
  )
    throw new Error(
      "Use version 1 website appearance settings with at most 32 custom presets.",
    );
  const ids = new Set(BUILTIN_WEBSITE_DARK_PRESETS.map((preset) => preset.id));
  const presets = config.presets.map((value): WebsiteDarkPreset => {
    const preset = record(value, ["id", "name", "theme"]);
    if (
      typeof preset.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(preset.id) ||
      ids.has(preset.id) ||
      typeof preset.name !== "string" ||
      !preset.name.trim() ||
      preset.name.length > 80 ||
      Array.from(preset.name).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ) ||
      preset.theme === undefined
    )
      throw new Error(
        "Custom presets need unique IDs and names of 1–80 characters.",
      );
    ids.add(preset.id);
    return {
      id: preset.id,
      name: preset.name.trim(),
      theme: normalizeWebsiteDarkTheme(preset.theme),
    };
  });
  return {
    version: 1,
    defaults: normalizeWebsiteDarkTheme(config.defaults),
    presets,
  };
}
