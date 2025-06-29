import { ThemeConfig } from '../types/settings';

export class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: string = 'dark';
  private currentColorScheme: string = 'blue';
  private systemThemeStop?: () => void;

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  private themes: Record<string, ThemeConfig> = {
    dark: {
      name: 'Dark',
      colors: {
        primary: '#3b82f6',
        secondary: '#6b7280',
        accent: '#10b981',
        background: '#111827',
        surface: '#1f2937',
        text: '#f9fafb',
        textSecondary: '#d1d5db',
        border: '#374151',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
    },
    light: {
      name: 'Light',
      colors: {
        primary: '#3b82f6',
        secondary: '#6b7280',
        accent: '#10b981',
        background: '#ffffff',
        surface: '#f9fafb',
        text: '#000000',
        textSecondary: '#6b7280',
        border: '#e5e7eb',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
    },
    darkest: {
      name: 'Darkest',
      colors: {
        primary: '#3b82f6',
        secondary: '#4b5563',
        accent: '#10b981',
        background: '#000000',
        surface: '#0f0f0f',
        text: '#ffffff',
        textSecondary: '#9ca3af',
        border: '#1f1f1f',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
    },
    oled: {
      name: 'OLED Black',
      colors: {
        primary: '#3b82f6',
        secondary: '#374151',
        accent: '#10b981',
        background: '#000000',
        surface: '#000000',
        text: '#ffffff',
        textSecondary: '#6b7280',
        border: '#111111',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
    },
  };

  private colorSchemes: Record<string, Record<string, string>> = {
    blue: {
      primary: '#3b82f6',
      secondary: '#1d4ed8',
      accent: '#1e40af',
    },
    green: {
      primary: '#10b981',
      secondary: '#059669',
      accent: '#047857',
    },
    purple: {
      primary: '#8b5cf6',
      secondary: '#7c3aed',
      accent: '#6d28d9',
    },
    red: {
      primary: '#ef4444',
      secondary: '#dc2626',
      accent: '#b91c1c',
    },
    orange: {
      primary: '#f97316',
      secondary: '#ea580c',
      accent: '#c2410c',
    },
    teal: {
      primary: '#14b8a6',
      secondary: '#0d9488',
      accent: '#0f766e',
    },
  };

  private applyResolvedTheme(themeName: string, colorScheme: string): void {
    const theme = this.themes[themeName];
    const colors = this.colorSchemes[colorScheme];

    if (!theme || !colors) {
      console.error('Invalid theme or color scheme');
      return;
    }

    const root = document.documentElement;

    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });

    root.style.setProperty('--color-primary', colors.primary);
    root.style.setProperty('--color-secondary', colors.secondary);
    root.style.setProperty('--color-accent', colors.accent);

    document.body.className = document.body.className
      .replace(/theme-\w+/g, '')
      .replace(/scheme-\w+/g, '');

    document.body.classList.add(`theme-${themeName}`, `scheme-${colorScheme}`);
  }

  applyTheme(themeName: string, colorScheme: string): void {
    this.currentTheme = themeName;
    this.currentColorScheme = colorScheme;

    if (this.systemThemeStop) {
      this.systemThemeStop();
      this.systemThemeStop = undefined;
    }

    if (themeName === 'auto') {
      const systemTheme = this.detectSystemTheme();
      this.applyResolvedTheme(systemTheme, colorScheme);
      this.systemThemeStop = this.watchSystemTheme((theme) => {
        this.applyResolvedTheme(theme, colorScheme);
      });
    } else {
      this.applyResolvedTheme(themeName, colorScheme);
    }

    // Store in localStorage
    localStorage.setItem('mremote-theme', themeName);
    localStorage.setItem('mremote-color-scheme', colorScheme);
  }

  getCurrentTheme(): string {
    return this.currentTheme;
  }

  getCurrentColorScheme(): string {
    return this.currentColorScheme;
  }

  getAvailableThemes(): string[] {
    return Object.keys(this.themes);
  }

  getAvailableColorSchemes(): string[] {
    return Object.keys(this.colorSchemes);
  }

  loadSavedTheme(): void {
    const savedTheme = localStorage.getItem('mremote-theme') || 'dark';
    const savedColorScheme = localStorage.getItem('mremote-color-scheme') || 'blue';
    
    this.applyTheme(savedTheme, savedColorScheme);
  }

  // Auto theme detection
  detectSystemTheme(): string {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  // Listen for system theme changes
  watchSystemTheme(callback: (theme: string) => void): (() => void) | undefined {
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleChange = (e: MediaQueryListEvent) => {
        callback(e.matches ? 'dark' : 'light');
      };

      mediaQuery.addEventListener('change', handleChange);
      
      // Return cleanup function
      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }
  }

  // Generate CSS for themes
  generateThemeCSS(): string {
    let css = '';

    Object.entries(this.themes).forEach(([themeName, theme]) => {
      css += `.theme-${themeName} {\n`;
      Object.entries(theme.colors).forEach(([key, value]) => {
        css += `  --color-${key}: ${value};\n`;
      });
      css += '}\n\n';
    });

    Object.entries(this.colorSchemes).forEach(([schemeName, colors]) => {
      css += `.scheme-${schemeName} {\n`;
      Object.entries(colors).forEach(([key, value]) => {
        css += `  --color-${key}: ${value};\n`;
      });
      css += '}\n\n';
    });

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
    const existingStyle = document.getElementById('theme-styles');
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'theme-styles';
    style.textContent = this.generateThemeCSS();
    document.head.appendChild(style);
  }
}
