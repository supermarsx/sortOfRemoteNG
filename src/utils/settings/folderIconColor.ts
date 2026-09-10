import type { GlobalSettings } from "../../types/settings/settings";

type FolderAppearance = Pick<
  GlobalSettings,
  "folderIconColorMode" | "folderIconCustomColor"
>;
export const DEFAULT_FOLDER_ICON_COLOR = "#f59e0b";

export function normalizeFolderIconMode(
  value: unknown,
): NonNullable<GlobalSettings["folderIconColorMode"]> {
  return value === "accent" || value === "custom" ? value : "default";
}

export function normalizeFolderIconColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : DEFAULT_FOLDER_ICON_COLOR;
}

/** CSS references follow the active theme live, including custom accents. */
export function resolveFolderIconColor(settings: FolderAppearance): string {
  switch (normalizeFolderIconMode(settings.folderIconColorMode)) {
    case "accent":
      return "var(--color-primary)";
    case "custom":
      return normalizeFolderIconColor(settings.folderIconCustomColor);
    default:
      return "var(--color-warning)";
  }
}
