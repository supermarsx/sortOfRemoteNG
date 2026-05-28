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
  Maximize2,
  Timer,
  Brush,
} from "lucide-react";
import {
  useThemeSettings,
  formatLabel,
} from "../../../hooks/settings/useThemeSettings";
import { Textarea } from "../../ui/forms";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsSelectRow,
  SettingsSliderRow,
  SettingsColorRow,
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
      <SettingsSelectRow
        icon={<Palette size={16} />}
        label={mgr.t("settings.theme", "Theme")}
        value={settings.theme}
        options={mgr.themes.map((theme) => ({
          value: theme,
          label: formatLabel(theme),
        }))}
        onChange={(v) => updateSettings({ theme: v as Theme })}
        infoTooltip="Select the base theme that controls the overall look and feel of the application."
      />
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
        <SettingsColorRow
          icon={<Droplets size={16} />}
          label="Accent Color"
          value={settings.primaryAccentColor || "#3b82f6"}
          onChange={(v) => mgr.handleAccentChange(v)}
          infoTooltip="The custom color used as the primary accent throughout the UI when Custom Accent is enabled."
        />
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
        className={`flex flex-col gap-2.5 ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        <div
          className={
            settings.backgroundGlowFollowsColorScheme
              ? "opacity-50 pointer-events-none"
              : undefined
          }
        >
          <SettingsColorRow
            icon={<Droplets size={16} />}
            label={
              settings.backgroundGlowFollowsColorScheme
                ? "Glow Color (auto)"
                : "Glow Color"
            }
            value={settings.backgroundGlowColor || "#2563eb"}
            fallbackValue="#2563eb"
            onChange={(v) => updateSettings({ backgroundGlowColor: v })}
            infoTooltip="The color of the background glow effect. Disabled when 'Glow follows color scheme' is on."
          />
        </div>

        <SettingsSliderRow
          icon={<Eye size={16} />}
          label="Glow Opacity"
          value={settings.backgroundGlowOpacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => updateSettings({ backgroundGlowOpacity: v })}
          infoTooltip="How visible the glow effect is (0 = invisible, 1 = fully opaque)."
        />

        <SettingsSliderRow
          icon={<Maximize2 size={16} />}
          label="Glow Radius"
          value={settings.backgroundGlowRadius}
          min={200}
          max={1200}
          step={10}
          unit="px"
          onChange={(v) => updateSettings({ backgroundGlowRadius: v })}
          infoTooltip="The size of the glow circle in pixels."
        />

        <SettingsSliderRow
          icon={<Brush size={16} />}
          label="Glow Blur"
          value={settings.backgroundGlowBlur}
          min={40}
          max={320}
          step={4}
          unit="px"
          onChange={(v) => updateSettings({ backgroundGlowBlur: v })}
          infoTooltip="How much the glow is blurred at the edges in pixels."
        />
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
        className={
          settings.windowTransparencyEnabled
            ? undefined
            : "opacity-50 pointer-events-none"
        }
      >
        <SettingsSliderRow
          settingKey="windowTransparencyOpacity"
          icon={<Layers size={16} />}
          label="Opacity Level"
          value={mgr.opacityValue}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) =>
            updateSettings({ windowTransparencyOpacity: v })
          }
          infoTooltip="Controls how transparent the window is (0 = fully transparent, 1 = fully opaque)."
        />
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
        className={
          settings.animationsEnabled
            ? undefined
            : "opacity-50 pointer-events-none"
        }
      >
        <SettingsSliderRow
          icon={<Timer size={16} />}
          label={mgr.t(
            "settings.theme.animationDuration",
            "Animation duration",
          )}
          value={settings.animationDuration || 200}
          min={50}
          max={500}
          step={25}
          unit="ms"
          onChange={(v) => updateSettings({ animationDuration: v })}
          infoTooltip="Base duration for animations in milliseconds; lower values feel snappier."
        />
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
