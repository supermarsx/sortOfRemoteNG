import React from "react";
import { GlobalSettings, Theme } from "../../../types/settings/settings";
import {
  Palette,
  Droplets,
  Sparkles,
  Eye,
  Code,
  Zap,
  Sun,
  Link2,
  Wand2,
  Accessibility,
  Layers,
  EyeOff,
} from "lucide-react";
import {
  useThemeSettings,
  formatLabel,
} from "../../../hooks/settings/useThemeSettings";
import {
  NumberInput,
  Slider,
  Select,
  Textarea,
} from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";
import { LoadingElementSection } from "./theme/LoadingElementSection";

type Mgr = ReturnType<typeof useThemeSettings>;

interface ThemeSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

// ─── Sub-components ─────────────────────────────────────────────────

const AppearanceSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Droplets className="w-4 h-4 text-primary" />}
      title={mgr.t("settings.theme.appearance", "Appearance")}
    />
    <Card>
      <div className="space-y-2">
        <label className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
          {mgr.t("settings.theme")}
          <InfoTooltip text="Select the base theme that controls the overall look and feel of the application" />
        </label>
        <Select
          value={settings.theme}
          onChange={(v: string) => updateSettings({ theme: v as Theme })}
          options={[
            ...mgr.themes.map((theme) => ({
              value: theme,
              label: formatLabel(theme),
            })),
          ]}
          className="sor-settings-select w-full"
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm text-[var(--color-textSecondary)] flex items-center gap-1">
          Color Scheme
          <InfoTooltip text="Choose a preset color scheme that defines the primary accent colors used throughout the UI" />
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
          {mgr.schemeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => mgr.handleSchemeChange(option.value)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all ${
                !settings.useCustomAccent &&
                settings.colorScheme === option.value
                  ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
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
      <Toggle
        icon={<Palette size={16} />}
        label="Custom Accent"
        description="Replace the preset scheme with any color you pick"
        checked={settings.useCustomAccent ?? false}
        onChange={(v) => mgr.handleToggleCustomAccent(v)}
        infoTooltip="Override the color scheme with a custom accent color of your choice"
      />

      <div
        className={
          settings.useCustomAccent
            ? undefined
            : "opacity-50 pointer-events-none"
        }
      >
        <div className="sor-settings-select-row">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Droplets size={16} />
            </span>
            Accent Color
            <InfoTooltip text="The custom color used as the primary accent throughout the UI when Custom Accent is enabled." />
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.primaryAccentColor || "#3b82f6"}
              onChange={(e) => mgr.handleAccentChange(e.target.value)}
              className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
            />
            <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded font-mono">
              {settings.primaryAccentColor || "#3b82f6"}
            </span>
          </div>
        </div>
      </div>
    </Card>
  </div>
);

const GlowSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Sparkles className="w-4 h-4 text-primary" />}
      title={mgr.t("settings.theme.backgroundGlow", "Background Glow")}
    />
    <Card>
      <Toggle
        checked={settings.backgroundGlowEnabled}
        onChange={(v) => updateSettings({ backgroundGlowEnabled: v })}
        icon={<Sparkles size={16} />}
        label="Enable background glow effect"
        description="Add a soft radial glow behind the main content area"
        settingKey="backgroundGlowEnabled"
        infoTooltip="Add a soft radial glow effect behind the main content area"
      />
      <div
        className={
          !settings.backgroundGlowEnabled
            ? "opacity-50 pointer-events-none"
            : undefined
        }
      >
        <Toggle
          checked={settings.backgroundGlowFollowsColorScheme}
          onChange={(v) =>
            updateSettings({ backgroundGlowFollowsColorScheme: v })
          }
          icon={<Link2 size={16} />}
          label="Glow follows color scheme"
          description="Auto-tint the glow to match the selected color scheme"
          settingKey="backgroundGlowFollowsColorScheme"
          infoTooltip="Automatically match the glow color to your selected color scheme"
        />
      </div>
      <div
        className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <div
          className={`space-y-1 ${settings.backgroundGlowFollowsColorScheme ? "opacity-50 pointer-events-none" : ""}`}
        >
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            Color {settings.backgroundGlowFollowsColorScheme && "(auto)"}
            <InfoTooltip text="The color of the background glow effect" />
          </label>
          <input
            type="color"
            value={settings.backgroundGlowColor || "#2563eb"}
            onChange={(e) =>
              updateSettings({ backgroundGlowColor: e.target.value })
            }
            className="w-full h-9 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            Opacity
            <InfoTooltip text="How visible the glow effect is (0 = invisible, 1 = fully opaque)" />
          </label>
          <NumberInput
            value={settings.backgroundGlowOpacity}
            onChange={(v: number) =>
              updateSettings({ backgroundGlowOpacity: v })
            }
            className="w-full"
            min={0}
            max={1}
            step={0.05}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            Radius (px)
            <InfoTooltip text="The size of the glow circle in pixels" />
          </label>
          <NumberInput
            value={settings.backgroundGlowRadius}
            onChange={(v: number) =>
              updateSettings({ backgroundGlowRadius: v })
            }
            className="w-full"
            min={200}
            max={1200}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            Blur (px)
            <InfoTooltip text="How much the glow is blurred at the edges in pixels" />
          </label>
          <NumberInput
            value={settings.backgroundGlowBlur}
            onChange={(v: number) =>
              updateSettings({ backgroundGlowBlur: v })
            }
            className="w-full"
            min={40}
            max={320}
          />
        </div>
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        The glow effect appears centered in the main content area for an
        exquisite visual experience.
      </p>
    </Card>
  </div>
);

const TransparencySection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Eye className="w-4 h-4 text-primary" />}
      title={
        <>
          {mgr.t("settings.theme.transparency", "Window Transparency")}
          <span className="ml-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-warning/20 text-warning border border-warning/30 rounded">
            Experimental
          </span>
        </>
      }
    />
    <Card>
      <p className="text-xs text-[var(--color-textMuted)]">
        Window transparency is experimental and may cause visual artifacts on
        some platforms or compositors. Disabled by default.
      </p>

      <Toggle
        checked={settings.windowTransparencyEnabled}
        onChange={(v) => updateSettings({ windowTransparencyEnabled: v })}
        icon={<Wand2 size={16} />}
        label="Enable window transparency"
        description="Make the application window semi-transparent so the desktop shows through"
        settingKey="windowTransparencyEnabled"
        infoTooltip="Make the application window semi-transparent so the desktop is visible behind it"
      />

      <div
        className={`space-y-2 ${!settings.windowTransparencyEnabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <label
          data-setting-key="windowTransparencyOpacity"
          className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1"
        >
          Opacity Level
          <InfoTooltip text="Controls how transparent the window is (0 = fully transparent, 1 = fully opaque)" />
        </label>
        <div className="flex items-center gap-3">
          <Slider
            value={mgr.opacityValue}
            onChange={(v: number) =>
              updateSettings({ windowTransparencyOpacity: v })
            }
            min={0}
            max={1}
            variant="full"
            className="flex-1"
            step={0.01}
          />
          <NumberInput
            value={mgr.opacityValue}
            onChange={(v: number) =>
              updateSettings({ windowTransparencyOpacity: v })
            }
            className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-xs"
            min={0}
            max={1}
            step={0.01}
          />
        </div>
      </div>

      <Toggle
        checked={settings.showTransparencyToggle ?? false}
        onChange={(v) => updateSettings({ showTransparencyToggle: v })}
        icon={<EyeOff size={16} />}
        label="Show transparency toggle in title bar"
        description="Add a quick-toggle button to the window title bar"
        settingKey="showTransparencyToggle"
        infoTooltip="Add a button to the title bar for quickly toggling window transparency on and off"
      />
    </Card>
  </div>
);

const AnimationsSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Zap className="w-4 h-4 text-primary" />}
      title={mgr.t("settings.theme.animations", "Animations")}
    />
    <Card>
      <Toggle
        checked={settings.animationsEnabled}
        onChange={(v) => updateSettings({ animationsEnabled: v })}
        icon={<Sun size={16} />}
        label={mgr.t(
          "settings.theme.enableAnimations",
          "Enable animations and transitions",
        )}
        description="Master switch for every UI animation and transition"
        settingKey="animationsEnabled"
        infoTooltip="Enable or disable all UI animations and transition effects globally"
      />

      <div
        className={
          !settings.animationsEnabled
            ? "opacity-50 pointer-events-none"
            : undefined
        }
      >
        <Toggle
          checked={settings.reduceMotion}
          onChange={(v) => updateSettings({ reduceMotion: v })}
          icon={<Accessibility size={16} />}
          label={mgr.t(
            "settings.theme.reduceMotion",
            "Reduce motion (minimal animations)",
          )}
          description="Use subtle animations only — better for motion sensitivity"
          settingKey="reduceMotion"
          infoTooltip="Use minimal, subtle animations instead of full motion effects for accessibility"
        />
      </div>

      <div
        className={
          !settings.animationsEnabled
            ? "opacity-50 pointer-events-none"
            : undefined
        }
      >
        <Toggle
          checked={settings.enableTabGroupAnimations}
          onChange={(v) => updateSettings({ enableTabGroupAnimations: v })}
          icon={<Layers size={16} />}
          label={mgr.t(
            "settings.theme.tabGroupAnimations",
            "Animate the Tab Group Manager",
          )}
          description="Fade and slide groups as they are added, removed, or filtered"
          settingKey="enableTabGroupAnimations"
          infoTooltip="Add fade and slide animations when groups are added, removed, searched, or filtered in the Tab Group Manager. Falls back to instant updates when off."
        />
      </div>

      <div
        className={`space-y-2 ${!settings.animationsEnabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <label className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
          {mgr.t("settings.theme.animationDuration", "Animation duration")}
          <InfoTooltip text="Base duration for animations in milliseconds; lower values feel snappier" />
        </label>
        <div className="flex items-center space-x-4">
          <Slider
            value={settings.animationDuration || 200}
            onChange={(v: number) =>
              updateSettings({ animationDuration: v })
            }
            min={50}
            max={500}
            variant="full"
            className="flex-1"
            step={25}
          />
          <span className="text-[var(--color-textSecondary)] text-sm w-16 text-right font-mono">
            {settings.animationDuration || 200}ms
          </span>
        </div>
      </div>
    </Card>
  </div>
);

const CustomCssSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Code className="w-4 h-4 text-primary" />}
      title={
        <>
          {mgr.t("settings.theme.customCss", "Custom CSS")}{" "}
          <InfoTooltip text="Write custom CSS rules to override any application styles for advanced personalization" />
        </>
      }
    />
    <Card>
      <div className="css-editor">
        <pre
          ref={mgr.cssHighlightRef}
          className="css-editor-highlight"
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html:
              mgr.highlightedCss +
              (mgr.highlightedCss.endsWith("\n") ? "" : "\n"),
          }}
        />
        <Textarea
          value={settings.customCss || ""}
          onChange={(v) => updateSettings({ customCss: v })}
          onScroll={mgr.handleCssScroll}
          rows={6}
          spellCheck={false}
          className="css-editor-input"
          placeholder="/* Enter custom CSS rules... */"
        />
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        Add custom styles to personalize the application appearance.
      </p>
    </Card>
  </div>
);

// ─── Root component ─────────────────────────────────────────────────

export const ThemeSettings: React.FC<ThemeSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useThemeSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<Palette className="w-5 h-5 text-primary" />}
        title="Theme"
        description="Color scheme, background glow, window transparency, animations, and custom CSS."
      />
      <AppearanceSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <GlowSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <TransparencySection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <AnimationsSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <LoadingElementSection settings={settings} updateSettings={updateSettings} />
      <CustomCssSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
    </div>
  );
};

export default ThemeSettings;
