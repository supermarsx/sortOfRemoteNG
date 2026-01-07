import { ThemeConfig, Theme, ColorScheme } from "../types/settings";
import { IndexedDbService } from "./indexedDbService";

export class ThemeManager {
  private static instance: ThemeManager | null = null;
  private currentTheme: Theme = "dark";
  private currentColorScheme: ColorScheme = "blue";
  private systemThemeStop?: () => void;

  static getInstance(): ThemeManager {
    if (ThemeManager.instance === null) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  static resetInstance(): void {
    ThemeManager.instance = null;
  }

  private themes: Record<string, ThemeConfig> = {
    dark: {
      name: "Dark",
      colors: {
        primary: "#3b82f6",
        secondary: "#6b7280",
        accent: "#10b981",
        background: "#111827",
        surface: "#1f2937",
        text: "#f9fafb",
        textSecondary: "#d1d5db",
        border: "#374151",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    },
    light: {
      name: "Light",
      colors: {
        primary: "#3b82f6",
        secondary: "#1d4ed8",
        accent: "#10b981",
        background: "#fdfdfd",
        surface: "#f7f8fb",
        text: "#0b0f19",
        textSecondary: "#1f2937",
        border: "#1f2937",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    },
    darkest: {
      name: "Darkest",
      colors: {
        primary: "#3b82f6",
        secondary: "#4b5563",
        accent: "#10b981",
        background: "#000000",
        surface: "#0f0f0f",
        text: "#ffffff",
        textSecondary: "#9ca3af",
        border: "#1f1f1f",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    },
    oled: {
      name: "OLED Black",
      colors: {
        primary: "#3b82f6",
        secondary: "#374151",
        accent: "#10b981",
        background: "#000000",
        surface: "#000000",
        text: "#ffffff",
        textSecondary: "#6b7280",
        border: "#111111",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    },
    semilight: {
      name: "Semi Light",
      colors: {
        primary: "#3b82f6",
        secondary: "#6b7280",
        accent: "#10b981",
        background: "#f3f4f6",
        surface: "#e5e7eb",
        text: "#000000",
        textSecondary: "#374151",
        border: "#d1d5db",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
      },
    },
  };

  private colorSchemes: Record<string, Record<string, string>> = {
    // Reds - warm, passionate colors
    red: {
      primary: "#ef4444",
      secondary: "#dc2626",
      accent: "#b91c1c",
    },
    rose: {
      primary: "#f43f5e",
      secondary: "#e11d48",
      accent: "#be123c",
    },
    pink: {
      primary: "#ec4899",
      secondary: "#db2777",
      accent: "#be185d",
    },
    // Oranges - energetic, warm colors
    orange: {
      primary: "#f97316",
      secondary: "#ea580c",
      accent: "#c2410c",
    },
    amber: {
      primary: "#f59e0b",
      secondary: "#d97706",
      accent: "#b45309",
    },
    // Yellows - bright, optimistic colors
    yellow: {
      primary: "#eab308",
      secondary: "#ca8a04",
      accent: "#a16207",
    },
    lime: {
      primary: "#84cc16",
      secondary: "#65a30d",
      accent: "#4d7c0f",
    },
    // Greens - natural, calming colors
    green: {
      primary: "#22c55e",
      secondary: "#16a34a",
      accent: "#15803d",
    },
    emerald: {
      primary: "#10b981",
      secondary: "#059669",
      accent: "#047857",
    },
    teal: {
      primary: "#14b8a6",
      secondary: "#0d9488",
      accent: "#0f766e",
    },
    // Blues - professional, trustworthy colors
    cyan: {
      primary: "#06b6d4",
      secondary: "#0891b2",
      accent: "#0e7490",
    },
    sky: {
      primary: "#0ea5e9",
      secondary: "#0284c7",
      accent: "#0369a1",
    },
    blue: {
      primary: "#3b82f6",
      secondary: "#2563eb",
      accent: "#1d4ed8",
    },
    indigo: {
      primary: "#6366f1",
      secondary: "#4f46e5",
      accent: "#4338ca",
    },
    // Purples - creative, luxurious colors
    violet: {
      primary: "#8b5cf6",
      secondary: "#7c3aed",
      accent: "#6d28d9",
    },
    purple: {
      primary: "#a855f7",
      secondary: "#9333ea",
      accent: "#7e22ce",
    },
    fuchsia: {
      primary: "#d946ef",
      secondary: "#c026d3",
      accent: "#a21caf",
    },
    // Neutrals - subtle, professional colors
    slate: {
      primary: "#64748b",
      secondary: "#475569",
      accent: "#334155",
    },
    grey: {
      primary: "#9ca3af",
      secondary: "#6b7280",
      accent: "#4b5563",
    },
  };

  // Containers for user-defined themes and color schemes
  private customThemes: Record<string, ThemeConfig> = {};
  private customColorSchemes: Record<string, Record<string, string>> = {};

  private readonly customThemesKey = "mremote-custom-themes";
  private readonly customSchemesKey = "mremote-custom-color-schemes";

  private getAllThemes(): Record<string, ThemeConfig> {
    return { ...this.themes, ...this.customThemes };
  }

  private getAllColorSchemes(): Record<string, Record<string, string>> {
    return { ...this.colorSchemes, ...this.customColorSchemes };
  }

  getThemeConfig(name: string): ThemeConfig | undefined {
    return this.getAllThemes()[name];
  }

  getColorSchemeConfig(name: string): Record<string, string> | undefined {
    return this.getAllColorSchemes()[name];
  }

  private applyResolvedTheme(
    themeName: string,
    colorScheme: string,
    customAccent?: string,
  ): void {
    const theme = this.getAllThemes()[themeName];
    const colors = this.getAllColorSchemes()[colorScheme];

    if (!theme || !colors) {
      console.error("Invalid theme or color scheme:", themeName, colorScheme);
      // Fallback to defaults
      const fallbackTheme = this.getAllThemes()["dark"];
      const fallbackColors = this.getAllColorSchemes()["blue"];
      if (fallbackTheme && fallbackColors) {
        this.currentTheme = "dark" as Theme;
        this.currentColorScheme = "blue" as ColorScheme;
        this.applyResolvedTheme("dark", "blue", customAccent);
      }
      return;
    }

    const root = document.documentElement;

    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });

    // Derive additional colors from the base theme
    const isLightTheme = ['light', 'semilight'].includes(themeName) || 
      (themeName === 'auto' && this.detectSystemTheme() === 'light');
    
    // surfaceHover - more contrast for hover states on light themes
    const surfaceHover = isLightTheme 
      ? ThemeManager.shadeColor(theme.colors.surface, -20)  // Darker hover for light themes
      : ThemeManager.shadeColor(theme.colors.surface, 15);
    root.style.setProperty('--color-surfaceHover', surfaceHover);
    
    // surfaceActive - even more contrast for active/pressed states
    const surfaceActive = isLightTheme
      ? ThemeManager.shadeColor(theme.colors.surface, -30)
      : ThemeManager.shadeColor(theme.colors.surface, 25);
    root.style.setProperty('--color-surfaceActive', surfaceActive);
    
    // input - input field background
    const input = isLightTheme
      ? '#ffffff'
      : ThemeManager.shadeColor(theme.colors.surface, -15);
    root.style.setProperty('--color-input', input);
    
    // inputHover - input field hover state
    const inputHover = isLightTheme
      ? ThemeManager.shadeColor('#ffffff', -8)
      : ThemeManager.shadeColor(theme.colors.surface, -10);
    root.style.setProperty('--color-inputHover', inputHover);
    
    // textMuted - more subtle text color
    const textMuted = isLightTheme
      ? ThemeManager.shadeColor(theme.colors.textSecondary, 20)
      : ThemeManager.shadeColor(theme.colors.textSecondary, -25);
    root.style.setProperty('--color-textMuted', textMuted);
    
    // buttonHover - explicit button hover color with better contrast
    const buttonHover = isLightTheme
      ? 'rgba(0, 0, 0, 0.08)'
      : 'rgba(255, 255, 255, 0.08)';
    root.style.setProperty('--color-buttonHover', buttonHover);

    if (customAccent) {
      // Custom accent: derive full color scheme from the custom accent color
      root.style.setProperty("--color-primary", customAccent);
      root.style.setProperty(
        "--color-secondary",
        ThemeManager.shadeColor(customAccent, -12),
      );
      root.style.setProperty(
        "--color-accent",
        ThemeManager.shadeColor(customAccent, -24),
      );
    } else {
      root.style.setProperty("--color-primary", colors.primary);
      root.style.setProperty("--color-secondary", colors.secondary);
      root.style.setProperty("--color-accent", colors.accent);
    }

    document.body.className = document.body.className
      .replace(/theme-\w+/g, "")
      .replace(/scheme-\w+/g, "");

    document.body.classList.add(`theme-${themeName}`, `scheme-${colorScheme}`);
  }

  applyTheme(
    themeName: Theme,
    colorScheme: ColorScheme,
    customAccent?: string,
  ): void {
    this.currentTheme = themeName;
    this.currentColorScheme = colorScheme;

    if (this.systemThemeStop) {
      this.systemThemeStop();
      this.systemThemeStop = undefined;
    }

    if (themeName === "auto") {
      const systemTheme = this.detectSystemTheme();
      this.applyResolvedTheme(systemTheme, colorScheme, customAccent);
      this.systemThemeStop = this.watchSystemTheme((theme) => {
        this.applyResolvedTheme(theme, colorScheme, customAccent);
      });
    } else {
      this.applyResolvedTheme(themeName, colorScheme, customAccent);
    }

    // Persist to IndexedDB
    void IndexedDbService.setItem("mremote-theme", themeName);
    void IndexedDbService.setItem("mremote-color-scheme", colorScheme);

    // Emit theme change event for detached windows
    this.emitThemeChange(themeName, colorScheme, customAccent);
  }

  /**
   * Emit theme change event to all windows (including detached ones)
   */
  private async emitThemeChange(
    theme: Theme,
    colorScheme: ColorScheme,
    customAccent?: string,
  ): Promise<void> {
    try {
      // Try using @tauri-apps/api/event for proper cross-window communication
      const { emit } = await import("@tauri-apps/api/event");
      await emit("theme-changed", {
        theme,
        colorScheme,
        primaryAccentColor: customAccent,
      });
    } catch {
      // Fallback to direct tauri access if import fails
      try {
        const tauri = (globalThis as any).__TAURI__;
        if (tauri?.event?.emit) {
          await tauri.event.emit("theme-changed", {
            theme,
            colorScheme,
            primaryAccentColor: customAccent,
          });
        }
      } catch {
        // Ignore - might not be in Tauri context
      }
    }
  }

  getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  getCurrentColorScheme(): ColorScheme {
    return this.currentColorScheme;
  }

  getAvailableThemes(): Theme[] {
    return [...Object.keys(this.getAllThemes()), "auto"] as Theme[];
  }

  getAvailableColorSchemes(): ColorScheme[] {
    return Object.keys(this.getAllColorSchemes()) as ColorScheme[];
  }

  private static shadeColor(hex: string, amount: number): string {
    const normalized = hex.replace("#", "");
    if (normalized.length !== 6) return hex;
    const num = parseInt(normalized, 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    const adjust = (channel: number) =>
      Math.max(0, Math.min(255, channel + Math.round((amount / 100) * 255)));
    const toHex = (channel: number) => adjust(channel).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  async loadSavedTheme(): Promise<void> {
    // Load persisted custom themes and color schemes
    this.customThemes =
      (await IndexedDbService.getItem<Record<string, ThemeConfig>>(
        this.customThemesKey,
      )) ?? {};
    this.customColorSchemes =
      (await IndexedDbService.getItem<Record<string, Record<string, string>>>(
        this.customSchemesKey,
      )) ?? {};

    this.injectThemeCSS();

    const savedTheme =
      (await IndexedDbService.getItem<Theme>("mremote-theme")) ?? "dark";
    const savedColorScheme =
      (await IndexedDbService.getItem<ColorScheme>("mremote-color-scheme")) ??
      "blue";

    // Validate saved values - migrate invalid values to defaults
    const validTheme = this.getAllThemes()[savedTheme] ? savedTheme : "dark";
    const validColorScheme = this.getAllColorSchemes()[savedColorScheme] ? savedColorScheme : "blue";

    // If values were invalid, persist the corrected values
    if (validTheme !== savedTheme) {
      console.warn(`Invalid theme "${savedTheme}" found, resetting to "${validTheme}"`);
      await IndexedDbService.setItem("mremote-theme", validTheme);
    }
    if (validColorScheme !== savedColorScheme) {
      console.warn(`Invalid color scheme "${savedColorScheme}" found, resetting to "${validColorScheme}"`);
      await IndexedDbService.setItem("mremote-color-scheme", validColorScheme);
    }

    this.applyTheme(validTheme as Theme, validColorScheme as ColorScheme);
  }

  private async saveCustomThemes(): Promise<void> {
    await IndexedDbService.setItem(this.customThemesKey, this.customThemes);
    this.injectThemeCSS();
  }

  private async saveCustomColorSchemes(): Promise<void> {
    await IndexedDbService.setItem(
      this.customSchemesKey,
      this.customColorSchemes,
    );
    this.injectThemeCSS();
  }

  async addCustomTheme(name: string, config: ThemeConfig): Promise<void> {
    this.customThemes[name] = config;
    await this.saveCustomThemes();
  }

  async editCustomTheme(name: string, config: ThemeConfig): Promise<void> {
    await this.addCustomTheme(name, config);
  }

  async removeCustomTheme(name: string): Promise<void> {
    delete this.customThemes[name];
    await this.saveCustomThemes();
  }

  async addCustomColorScheme(
    name: string,
    colors: Record<string, string>,
  ): Promise<void> {
    this.customColorSchemes[name] = colors;
    await this.saveCustomColorSchemes();
  }

  async editCustomColorScheme(
    name: string,
    colors: Record<string, string>,
  ): Promise<void> {
    await this.addCustomColorScheme(name, colors);
  }

  async removeCustomColorScheme(name: string): Promise<void> {
    delete this.customColorSchemes[name];
    await this.saveCustomColorSchemes();
  }

  // Export all custom themes and color schemes
  exportThemeData(): {
    themes: Record<string, ThemeConfig>;
    colorSchemes: Record<string, Record<string, string>>;
    version: number;
    exportDate: string;
  } {
    return {
      themes: { ...this.customThemes },
      colorSchemes: { ...this.customColorSchemes },
      version: 1,
      exportDate: new Date().toISOString(),
    };
  }

  // Export a single theme
  exportTheme(name: string): ThemeConfig | null {
    return this.customThemes[name] || null;
  }

  // Export a single color scheme
  exportColorScheme(name: string): Record<string, string> | null {
    return this.customColorSchemes[name] || null;
  }

  // Import themes and color schemes
  async importThemeData(data: {
    themes?: Record<string, ThemeConfig>;
    colorSchemes?: Record<string, Record<string, string>>;
  }, options?: { overwrite?: boolean }): Promise<{ 
    importedThemes: string[]; 
    importedSchemes: string[]; 
    skippedThemes: string[];
    skippedSchemes: string[];
  }> {
    const result = {
      importedThemes: [] as string[],
      importedSchemes: [] as string[],
      skippedThemes: [] as string[],
      skippedSchemes: [] as string[],
    };

    // Import themes
    if (data.themes) {
      for (const [name, config] of Object.entries(data.themes)) {
        // Skip built-in themes
        if (this.themes[name]) {
          result.skippedThemes.push(name);
          continue;
        }
        // Skip existing custom themes unless overwrite is true
        if (this.customThemes[name] && !options?.overwrite) {
          result.skippedThemes.push(name);
          continue;
        }
        this.customThemes[name] = config;
        result.importedThemes.push(name);
      }
      if (result.importedThemes.length > 0) {
        await this.saveCustomThemes();
      }
    }

    // Import color schemes
    if (data.colorSchemes) {
      for (const [name, colors] of Object.entries(data.colorSchemes)) {
        // Skip built-in color schemes
        if (this.colorSchemes[name]) {
          result.skippedSchemes.push(name);
          continue;
        }
        // Skip existing custom schemes unless overwrite is true
        if (this.customColorSchemes[name] && !options?.overwrite) {
          result.skippedSchemes.push(name);
          continue;
        }
        this.customColorSchemes[name] = colors;
        result.importedSchemes.push(name);
      }
      if (result.importedSchemes.length > 0) {
        await this.saveCustomColorSchemes();
      }
    }

    return result;
  }

  // Get custom themes count for display
  getCustomThemesCount(): number {
    return Object.keys(this.customThemes).length;
  }

  // Get custom color schemes count for display
  getCustomColorSchemesCount(): number {
    return Object.keys(this.customColorSchemes).length;
  }

  // Auto theme detection
  detectSystemTheme(): string {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }

  // Listen for system theme changes
  watchSystemTheme(
    callback: (theme: "dark" | "light") => void,
  ): (() => void) | undefined {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

      const handleChange = (e: MediaQueryListEvent) => {
        callback(e.matches ? "dark" : "light");
      };

      mediaQuery.addEventListener("change", handleChange);

      // Return cleanup function
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }
  }

  // Generate CSS for themes
  generateThemeCSS(): string {
    let css = "";

    Object.entries(this.getAllThemes()).forEach(([themeName, theme]) => {
      css += `.theme-${themeName} {\n`;
      Object.entries(theme.colors).forEach(([key, value]) => {
        css += `  --color-${key}: ${value};\n`;
      });
      css += "}\n\n";
    });

    Object.entries(this.getAllColorSchemes()).forEach(
      ([schemeName, colors]) => {
        css += `.scheme-${schemeName} {\n`;
        Object.entries(colors).forEach(([key, value]) => {
          css += `  --color-${key}: ${value};\n`;
        });
        css += "}\n\n";
      },
    );

    // Drop indicators for drag and drop
    css += `
.drop-before {
  border-top: 2px solid var(--color-primary) !important;
}

.drop-after {
  border-bottom: 2px solid var(--color-primary) !important;
}

.drop-inside {
  background-color: rgba(59, 130, 246, 0.1) !important;
  border: 2px dashed var(--color-primary) !important;
}

/* Resizable handles */
.react-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  background-repeat: no-repeat;
  background-origin: content-box;
  box-sizing: border-box;
  background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNiIgaGVpZ2h0PSI2IiB2aWV3Qm94PSIwIDAgNiA2IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxnIGZpbGw9IiM0YjU1NjMiIGZpbGwtcnVsZT0iZXZlbm9kZCI+PHBhdGggZD0ibTUgNWgtNHYtNGg0eiIvPjwvZz48L3N2Zz4=');
  background-position: bottom right;
  padding: 0 3px 3px 0;
}

.react-resizable-handle-se {
  bottom: 0;
  right: 0;
  cursor: se-resize;
}

.react-resizable-handle-s {
  bottom: 0;
  left: 50%;
  margin-left: -10px;
  cursor: s-resize;
}

.react-resizable-handle-e {
  right: 0;
  top: 50%;
  margin-top: -10px;
  cursor: e-resize;
}
`;

    return css;
  }

  // Inject theme CSS into document
  injectThemeCSS(): void {
    const existingStyle = document.getElementById("theme-styles");
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement("style");
    style.id = "theme-styles";
    style.textContent = this.generateThemeCSS();
    document.head.appendChild(style);
  }
}
