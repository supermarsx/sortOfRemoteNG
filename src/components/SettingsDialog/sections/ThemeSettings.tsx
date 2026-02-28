import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings, Theme, ColorScheme } from "../../../types/settings";
import { ThemeManager } from "../../../utils/themeManager";
import { Palette, Droplets, Sparkles, Eye, Code, Zap } from "lucide-react";

interface ThemeSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const formatLabel = (value: string): string =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();
  const themeManager = ThemeManager.getInstance();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [schemes, setSchemes] = useState<ColorScheme[]>([]);
  const cssHighlightRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    setThemes(themeManager.getAvailableThemes());
    setSchemes(themeManager.getAvailableColorSchemes());
  }, [themeManager]);

  const schemeOptions = useMemo(() => {
    const accent = settings.primaryAccentColor || "#3b82f6";
    return schemes.map((scheme) => ({
      value: scheme,
      label: formatLabel(scheme),
      color:
        scheme === "custom"
          ? accent
          : (themeManager.getColorSchemeConfig(scheme)?.primary ?? "#3b82f6"),
    }));
  }, [schemes, settings.primaryAccentColor, themeManager]);

  const handleAccentChange = (value: string) => {
    updateSettings({
      primaryAccentColor: value,
      colorScheme: "custom",
    });
  };

  const escapeHtml = useCallback((value: string) => {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }, []);

  const highlightCss = useCallback(
    (code: string) => {
      let html = escapeHtml(code);
      html = html.replace(
        /\/\*[\s\S]*?\*\//g,
        '<span class="css-token-comment">$&</span>',
      );
      html = html.replace(
        /(^|\n)(\s*)([^\n{}]+)(\s*\{)/g,
        '$1$2<span class="css-token-selector">$3</span>$4',
      );
      html = html.replace(
        /([a-zA-Z-]+)(\s*):/g,
        '<span class="css-token-property">$1</span>$2:',
      );
      html = html.replace(
        /:(\s*)([^;\n}]+)/g,
        ':$1<span class="css-token-value">$2</span>',
      );
      return html;
    },
    [escapeHtml],
  );

  const highlightedCss = useMemo(
    () => highlightCss(settings.customCss || ""),
    [highlightCss, settings.customCss],
  );

  const handleCssScroll = useCallback(
    (event: React.UIEvent<HTMLTextAreaElement>) => {
      if (!cssHighlightRef.current) return;
      cssHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
      cssHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    },
    [],
  );

  const opacityValue = Number(settings.windowTransparencyOpacity ?? 1);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <Palette className="w-5 h-5" />
        Theme
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Color scheme, background glow, window transparency, animations, and
        custom CSS.
      </p>

      {/* Theme & Color Scheme Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Droplets className="w-4 h-4" />
          {t("settings.theme.appearance", "Appearance")}
        </h4>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Theme Selection */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--color-textSecondary)]">
              {t("settings.theme")}
            </label>
            <select
              value={settings.theme}
              onChange={(e) =>
                updateSettings({ theme: e.target.value as Theme })
              }
              className="sor-settings-select w-full"
            >
              {themes.map((theme) => (
                <option key={theme} value={theme}>
                  {formatLabel(theme)}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Accent Color */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--color-textSecondary)]">
              Custom Accent
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.primaryAccentColor || "#3b82f6"}
                onChange={(e) => handleAccentChange(e.target.value)}
                className="w-12 h-10 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md cursor-pointer"
              />
              <span className="text-xs text-gray-500 bg-[var(--color-surface)] px-2 py-1 rounded">
                {settings.primaryAccentColor || "#3b82f6"}
              </span>
            </div>
          </div>
        </div>

        {/* Color Scheme Grid */}
        <div className="space-y-2">
          <label className="text-sm text-[var(--color-textSecondary)]">
            Color Scheme
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {schemeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  updateSettings({ colorScheme: option.value as ColorScheme })
                }
                className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all ${
                  settings.colorScheme === option.value
                    ? "border-blue-500 bg-blue-600/20 text-[var(--color-text)] ring-1 ring-blue-500/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full border border-black/30 flex-shrink-0"
                  style={{ backgroundColor: option.color }}
                />
                <span className="truncate text-xs">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Background Glow Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          {t("settings.theme.backgroundGlow", "Background Glow")}
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.backgroundGlowEnabled}
              onChange={(e) =>
                updateSettings({ backgroundGlowEnabled: e.target.checked })
              }
              className="sor-settings-checkbox"
            />
            <span className="text-sm text-[var(--color-textSecondary)]">
              Enable background glow effect
            </span>
          </label>

          <label
            className={`flex items-center space-x-3 cursor-pointer ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <input
              type="checkbox"
              checked={settings.backgroundGlowFollowsColorScheme}
              onChange={(e) =>
                updateSettings({
                  backgroundGlowFollowsColorScheme: e.target.checked,
                })
              }
              className="sor-settings-checkbox"
            />
            <span className="text-sm text-[var(--color-textSecondary)]">
              Glow follows color scheme
            </span>
          </label>

          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div
              className={`space-y-1 ${settings.backgroundGlowFollowsColorScheme ? "opacity-50 pointer-events-none" : ""}`}
            >
              <label className="text-xs text-[var(--color-textSecondary)]">
                Color {settings.backgroundGlowFollowsColorScheme && "(auto)"}
              </label>
              <input
                type="color"
                value={settings.backgroundGlowColor || "#2563eb"}
                onChange={(e) =>
                  updateSettings({ backgroundGlowColor: e.target.value })
                }
                className="w-full h-9 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md cursor-pointer"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-textSecondary)]">
                Opacity
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={settings.backgroundGlowOpacity}
                onChange={(e) =>
                  updateSettings({
                    backgroundGlowOpacity: Math.min(
                      1,
                      Math.max(0, parseFloat(e.target.value || "0")),
                    ),
                  })
                }
                className="sor-settings-input w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-textSecondary)]">
                Radius (px)
              </label>
              <input
                type="number"
                min="200"
                max="1200"
                value={settings.backgroundGlowRadius}
                onChange={(e) =>
                  updateSettings({
                    backgroundGlowRadius: Math.max(
                      200,
                      parseInt(e.target.value || "0"),
                    ),
                  })
                }
                className="sor-settings-input w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--color-textSecondary)]">
                Blur (px)
              </label>
              <input
                type="number"
                min="40"
                max="320"
                value={settings.backgroundGlowBlur}
                onChange={(e) =>
                  updateSettings({
                    backgroundGlowBlur: Math.max(
                      40,
                      parseInt(e.target.value || "0"),
                    ),
                  })
                }
                className="sor-settings-input w-full"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            The glow effect appears centered in the main content area for an
            exquisite visual experience.
          </p>
        </div>
      </div>

      {/* Window Transparency Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Eye className="w-4 h-4" />
          {t("settings.theme.transparency", "Window Transparency")}
          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded">
            Experimental
          </span>
        </h4>

        <p className="text-xs text-gray-500">
          Window transparency is experimental and may cause visual artifacts on
          some platforms or compositors. Disabled by default.
        </p>

        <div className="sor-settings-card">
          <label
            data-setting-key="windowTransparencyEnabled"
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={settings.windowTransparencyEnabled}
              onChange={(e) =>
                updateSettings({ windowTransparencyEnabled: e.target.checked })
              }
              className="sor-settings-checkbox"
            />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Enable window transparency
              </span>
              <p className="text-[10px] text-gray-500">
                Make the application window semi-transparent
              </p>
            </div>
          </label>

          <div
            className={`space-y-2 ${!settings.windowTransparencyEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label
              data-setting-key="windowTransparencyOpacity"
              className="text-xs text-[var(--color-textSecondary)]"
            >
              Opacity Level
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={opacityValue}
                onChange={(e) =>
                  updateSettings({
                    windowTransparencyOpacity: Math.min(
                      1,
                      Math.max(0, parseFloat(e.target.value || "1")),
                    ),
                  })
                }
                className="sor-settings-range-full flex-1"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={opacityValue.toFixed(2)}
                onChange={(e) =>
                  updateSettings({
                    windowTransparencyOpacity: Math.min(
                      1,
                      Math.max(0, parseFloat(e.target.value || "1")),
                    ),
                  })
                }
                className="w-20 px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-xs"
              />
            </div>
          </div>

          <label
            data-setting-key="showTransparencyToggle"
            className="flex items-center space-x-3 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={settings.showTransparencyToggle ?? false}
              onChange={(e) =>
                updateSettings({ showTransparencyToggle: e.target.checked })
              }
              className="sor-settings-checkbox"
            />
            <div>
              <span className="text-sm text-[var(--color-textSecondary)] group-hover:text-[var(--color-text)]">
                Show transparency toggle in title bar
              </span>
              <p className="text-[10px] text-gray-500">
                Add a quick-toggle button to the window title bar
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Animation Settings Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          {t("settings.theme.animations", "Animations")}
        </h4>

        <div className="sor-settings-card">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.animationsEnabled}
              onChange={(e) =>
                updateSettings({ animationsEnabled: e.target.checked })
              }
              className="sor-settings-checkbox"
            />
            <span className="text-sm text-[var(--color-textSecondary)]">
              {t(
                "settings.theme.enableAnimations",
                "Enable animations and transitions",
              )}
            </span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(e) =>
                updateSettings({ reduceMotion: e.target.checked })
              }
              className="sor-settings-checkbox"
              disabled={!settings.animationsEnabled}
            />
            <span
              className={`text-sm text-[var(--color-textSecondary)] ${!settings.animationsEnabled ? "opacity-50" : ""}`}
            >
              {t(
                "settings.theme.reduceMotion",
                "Reduce motion (minimal animations)",
              )}
            </span>
          </label>

          <div
            className={`space-y-2 ${!settings.animationsEnabled ? "opacity-50 pointer-events-none" : ""}`}
          >
            <label className="text-xs text-[var(--color-textSecondary)]">
              {t("settings.theme.animationDuration", "Animation duration")}
            </label>
            <div className="flex items-center space-x-4">
              <input
                type="range"
                min="50"
                max="500"
                step="25"
                value={settings.animationDuration || 200}
                onChange={(e) =>
                  updateSettings({
                    animationDuration: parseInt(e.target.value),
                  })
                }
                className="sor-settings-range-full flex-1"
              />
              <span className="text-[var(--color-textSecondary)] text-sm w-16 text-right">
                {settings.animationDuration || 200}ms
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Custom CSS Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-textSecondary)] border-b border-[var(--color-border)] pb-2 flex items-center gap-2">
          <Code className="w-4 h-4" />
          {t("settings.theme.customCss", "Custom CSS")}
        </h4>

        <div className="css-editor">
          <pre
            ref={cssHighlightRef}
            className="css-editor-highlight"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html:
                highlightedCss + (highlightedCss.endsWith("\n") ? "" : "\n"),
            }}
          />
          <textarea
            value={settings.customCss || ""}
            onChange={(e) => updateSettings({ customCss: e.target.value })}
            onScroll={handleCssScroll}
            rows={6}
            spellCheck={false}
            className="css-editor-input"
            placeholder="/* Enter custom CSS rules... */"
          />
        </div>
        <p className="text-xs text-gray-500">
          Add custom styles to personalize the application appearance.
        </p>
      </div>
    </div>
  );
};

export default ThemeSettings;
