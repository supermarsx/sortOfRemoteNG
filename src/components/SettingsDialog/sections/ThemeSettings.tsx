import SectionHeading from '../../ui/SectionHeading';
import { InfoTooltip } from '../../ui/InfoTooltip';
import React from "react";
import { GlobalSettings, Theme } from "../../../types/settings/settings";
import { Palette, Droplets, Sparkles, Eye, Code, Zap } from "lucide-react";
import { useThemeSettings, formatLabel } from "../../../hooks/settings/useThemeSettings";
import { Checkbox, NumberInput, Slider, Select, Textarea} from '../../ui/forms';

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
    <h4 className="sor-section-heading">
      <Droplets className="w-4 h-4" />
      {mgr.t("settings.theme.appearance", "Appearance")}
    </h4>
    <div className="space-y-2">
      <label className="text-sm text-[var(--color-textSecondary)]">{mgr.t("settings.theme")} <InfoTooltip text="Select the base theme that controls the overall look and feel of the application" /></label>
      <Select value={settings.theme} onChange={(v: string) => updateSettings({ theme: v as Theme })} options={[...mgr.themes.map((theme) => ({ value: theme, label: formatLabel(theme) }))]} className="sor-settings-select w-full" />
    </div>
    <div className="space-y-2">
      <label className="text-sm text-[var(--color-textSecondary)]">Color Scheme <InfoTooltip text="Choose a preset color scheme that defines the primary accent colors used throughout the UI" /></label>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {mgr.schemeOptions.map((option) => (
          <button key={option.value} onClick={() => mgr.handleSchemeChange(option.value)} className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all ${!settings.useCustomAccent && settings.colorScheme === option.value ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50" : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"}`}>
            <span className="w-3 h-3 rounded-full border border-black/30 flex-shrink-0" style={{ backgroundColor: option.color }} />
            <span className="truncate text-xs">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={settings.useCustomAccent ?? false} onChange={(v: boolean) => mgr.handleToggleCustomAccent(v)} />
          <span className="text-sm text-[var(--color-textSecondary)]">Custom Accent <InfoTooltip text="Override the color scheme with a custom accent color of your choice" /></span>
        </label>
        <div className={`flex items-center gap-2 ${!settings.useCustomAccent ? "opacity-40 pointer-events-none" : ""}`}>
          <input type="color" value={settings.primaryAccentColor || "#3b82f6"} onChange={(e) => mgr.handleAccentChange(e.target.value)} className="w-10 h-8 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer" />
          <span className="text-xs text-[var(--color-textMuted)] bg-[var(--color-surface)] px-2 py-1 rounded">{settings.primaryAccentColor || "#3b82f6"}</span>
        </div>
      </div>
    </div>
  </div>
);

const GlowSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Sparkles className="w-4 h-4" />
      {mgr.t("settings.theme.backgroundGlow", "Background Glow")}
    </h4>
    <div className="sor-settings-card">
      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox checked={settings.backgroundGlowEnabled} onChange={(v: boolean) => updateSettings({ backgroundGlowEnabled: v })} />
        <span className="text-sm text-[var(--color-textSecondary)]">Enable background glow effect <InfoTooltip text="Add a soft radial glow effect behind the main content area" /></span>
      </label>
      <label className={`flex items-center space-x-3 cursor-pointer ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}>
        <Checkbox checked={settings.backgroundGlowFollowsColorScheme} onChange={(v: boolean) => updateSettings({ backgroundGlowFollowsColorScheme: v })} />
        <span className="text-sm text-[var(--color-textSecondary)]">Glow follows color scheme <InfoTooltip text="Automatically match the glow color to your selected color scheme" /></span>
      </label>
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${!settings.backgroundGlowEnabled ? "opacity-50 pointer-events-none" : ""}`}>
        <div className={`space-y-1 ${settings.backgroundGlowFollowsColorScheme ? "opacity-50 pointer-events-none" : ""}`}>
          <label className="text-xs text-[var(--color-textSecondary)]">Color {settings.backgroundGlowFollowsColorScheme && "(auto)"} <InfoTooltip text="The color of the background glow effect" /></label>
          <input type="color" value={settings.backgroundGlowColor || "#2563eb"} onChange={(e) => updateSettings({ backgroundGlowColor: e.target.value })} className="w-full h-9 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md cursor-pointer" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)]">Opacity <InfoTooltip text="How visible the glow effect is (0 = invisible, 1 = fully opaque)" /></label>
          <NumberInput value={settings.backgroundGlowOpacity} onChange={(v: number) => updateSettings({ backgroundGlowOpacity: v })} className="w-full" min={0} max={1} step={0.05} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)]">Radius (px) <InfoTooltip text="The size of the glow circle in pixels" /></label>
          <NumberInput value={settings.backgroundGlowRadius} onChange={(v: number) => updateSettings({ backgroundGlowRadius: v })} className="w-full" min={200} max={1200} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--color-textSecondary)]">Blur (px) <InfoTooltip text="How much the glow is blurred at the edges in pixels" /></label>
          <NumberInput value={settings.backgroundGlowBlur} onChange={(v: number) => updateSettings({ backgroundGlowBlur: v })} className="w-full" min={40} max={320} />
        </div>
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">The glow effect appears centered in the main content area for an exquisite visual experience.</p>
    </div>
  </div>
);

const TransparencySection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Eye className="w-4 h-4" />
      {mgr.t("settings.theme.transparency", "Window Transparency")}
      <span className="ml-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-warning/20 text-warning border border-warning/30 rounded">Experimental</span>
    </h4>
    <p className="text-xs text-[var(--color-textMuted)]">Window transparency is experimental and may cause visual artifacts on some platforms or compositors. Disabled by default.</p>
    <div className="sor-settings-card">
      <label data-setting-key="windowTransparencyEnabled" className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.windowTransparencyEnabled} onChange={(v: boolean) => updateSettings({ windowTransparencyEnabled: v })} />
        <div>
          <span className="sor-toggle-label">Enable window transparency <InfoTooltip text="Make the application window semi-transparent so the desktop is visible behind it" /></span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Make the application window semi-transparent</p>
        </div>
      </label>
      <div className={`space-y-2 ${!settings.windowTransparencyEnabled ? "opacity-50 pointer-events-none" : ""}`}>
        <label data-setting-key="windowTransparencyOpacity" className="text-xs text-[var(--color-textSecondary)]">Opacity Level <InfoTooltip text="Controls how transparent the window is (0 = fully transparent, 1 = fully opaque)" /></label>
        <div className="flex items-center gap-3">
          <Slider value={mgr.opacityValue} onChange={(v: number) => updateSettings({ windowTransparencyOpacity: v })} min={0} max={1} variant="full" className="flex-1" step={0.01} />
          <NumberInput value={mgr.opacityValue} onChange={(v: number) => updateSettings({ windowTransparencyOpacity: v })} className="w-20 px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] text-xs" min={0} max={1} step={0.01} />
        </div>
      </div>
      <label data-setting-key="showTransparencyToggle" className="flex items-center space-x-3 cursor-pointer group">
        <Checkbox checked={settings.showTransparencyToggle ?? false} onChange={(v: boolean) => updateSettings({ showTransparencyToggle: v })} />
        <div>
          <span className="sor-toggle-label">Show transparency toggle in title bar <InfoTooltip text="Add a button to the title bar for quickly toggling window transparency on and off" /></span>
          <p className="text-[10px] text-[var(--color-textMuted)]">Add a quick-toggle button to the window title bar</p>
        </div>
      </label>
    </div>
  </div>
);

const AnimationsSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Zap className="w-4 h-4" />
      {mgr.t("settings.theme.animations", "Animations")}
    </h4>
    <div className="sor-settings-card">
      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox checked={settings.animationsEnabled} onChange={(v: boolean) => updateSettings({ animationsEnabled: v })} />
        <span className="text-sm text-[var(--color-textSecondary)]">{mgr.t("settings.theme.enableAnimations", "Enable animations and transitions")} <InfoTooltip text="Enable or disable all UI animations and transition effects globally" /></span>
      </label>
      <label className="flex items-center space-x-3 cursor-pointer">
        <Checkbox checked={settings.reduceMotion} onChange={(v: boolean) => updateSettings({ reduceMotion: v })} disabled={!settings.animationsEnabled} />
        <span className={`text-sm text-[var(--color-textSecondary)] ${!settings.animationsEnabled ? "opacity-50" : ""}`}>{mgr.t("settings.theme.reduceMotion", "Reduce motion (minimal animations)")} <InfoTooltip text="Use minimal, subtle animations instead of full motion effects for accessibility" /></span>
      </label>
      <div className={`space-y-2 ${!settings.animationsEnabled ? "opacity-50 pointer-events-none" : ""}`}>
        <label className="text-xs text-[var(--color-textSecondary)]">{mgr.t("settings.theme.animationDuration", "Animation duration")} <InfoTooltip text="Base duration for animations in milliseconds; lower values feel snappier" /></label>
        <div className="flex items-center space-x-4">
          <Slider value={settings.animationDuration || 200} onChange={(v: number) => updateSettings({ animationDuration: v })} min={50} max={500} variant="full" className="flex-1" step={25} />
          <span className="text-[var(--color-textSecondary)] text-sm w-16 text-right">{settings.animationDuration || 200}ms</span>
        </div>
      </div>
    </div>
  </div>
);

const CustomCssSection: React.FC<{
  mgr: Mgr;
  settings: GlobalSettings;
  updateSettings: (u: Partial<GlobalSettings>) => void;
}> = ({ mgr, settings, updateSettings }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Code className="w-4 h-4" />
      {mgr.t("settings.theme.customCss", "Custom CSS")} <InfoTooltip text="Write custom CSS rules to override any application styles for advanced personalization" />
    </h4>
    <div className="css-editor">
      <pre ref={mgr.cssHighlightRef} className="css-editor-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mgr.highlightedCss + (mgr.highlightedCss.endsWith("\n") ? "" : "\n") }} />
      <Textarea value={settings.customCss || ""} onChange={(v) => updateSettings({ customCss: v })} onScroll={mgr.handleCssScroll} rows={6} spellCheck={false} className="css-editor-input" placeholder="/* Enter custom CSS rules... */" />
    </div>
    <p className="text-xs text-[var(--color-textMuted)]">Add custom styles to personalize the application appearance.</p>
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
      <SectionHeading icon={<Palette className="w-5 h-5" />} title="Theme" description="Color scheme, background glow, window transparency, animations, and custom CSS." />
      <AppearanceSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <GlowSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <TransparencySection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <AnimationsSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
      <CustomCssSection mgr={mgr} settings={settings} updateSettings={updateSettings} />
    </div>
  );
};

export default ThemeSettings;
