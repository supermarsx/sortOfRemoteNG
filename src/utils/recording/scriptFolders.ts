import { hasAutomationControlCharacters } from "./automationProvenance";
/** Folder names are category paths; scripts retain their existing category data. */
export function normalizeScriptFolders(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some(
      (name) =>
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 128 ||
        hasAutomationControlCharacters(name, false),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid script folders.");
  return [...value] as string[];
}
