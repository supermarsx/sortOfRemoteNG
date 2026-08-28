import type { SettingSearchEntry } from "./types";

/**
 * Search index entries for the `theme` settings tab.
 *
 * Every `key` must match a `settingKey` / `data-setting-key` rendered by that
 * tab's section components — `tests/settings/settingsSearchDrift.test.ts`
 * enforces the join in both directions.
 */
export const THEME_SEARCH_ENTRIES: SettingSearchEntry[] = [
  // ─── Theme ──────────────────────────────────────────────────────
  {
    key: "theme",
    label: "Theme",
    description: "Color theme",
    tags: ["dark mode", "light mode", "appearance", "colors", "skin"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "colorScheme",
    label: "Color Scheme",
    description: "Accent color scheme",
    tags: ["colors", "palette", "accent"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "primaryAccentColor",
    label: "Primary Accent Color",
    description: "Primary accent color",
    tags: ["color", "accent", "tint"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "backgroundGlowEnabled",
    label: "Background Glow",
    description: "Enable background glow effect",
    tags: ["glow", "ambient", "effect"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "windowTransparencyEnabled",
    label: "Window Transparency",
    description: "Enable window transparency",
    tags: ["transparent", "opacity", "glass", "blur"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "windowTransparencyOpacity",
    label: "Transparency Opacity",
    description: "Window transparency level",
    tags: ["opacity", "alpha", "transparent"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "customCss",
    label: "Custom CSS",
    description: "Custom CSS styles",
    tags: ["css", "style", "stylesheet", "custom"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "animationsEnabled",
    label: "Animations",
    description: "Enable UI animations",
    tags: ["animation", "motion", "transitions"],
    section: "theme",
    sectionLabel: "Theme",
  },
  {
    key: "reduceMotion",
    label: "Reduce Motion",
    description: "Reduce UI animations for accessibility",
    tags: ["accessibility", "a11y", "motion"],
    section: "theme",
    sectionLabel: "Theme",
  },
];
