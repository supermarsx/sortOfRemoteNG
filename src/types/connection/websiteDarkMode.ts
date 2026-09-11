export interface WebsiteDarkTheme {
  mode: "dynamic" | "filter" | "dynamicFilter" | "customCss";
  brightness: number;
  contrast: number;
  sepia: number;
  grayscale: number;
  backgroundColor: string;
  textColor: string;
  preserveMedia: boolean;
  customCss: string;
}

/** Appearance only. HttpAutomationConfig.forceDark remains the sole consent. */
export interface WebsiteDarkModeConfig {
  version: 1;
  useGlobalDefaults: boolean;
  theme: WebsiteDarkTheme;
}

export interface WebsiteDarkPreset {
  id: string;
  name: string;
  theme: WebsiteDarkTheme;
}

/** Defaults never enable the extension on a connection. */
export interface WebsiteDarkModeSettings {
  version: 1;
  defaults: WebsiteDarkTheme;
  presets: WebsiteDarkPreset[];
}
