import { SettingsManager } from "../settings/settingsManager";

export function debugLog(...args: unknown[]): void {
  const settings = SettingsManager.getInstance().getSettings();
  if (settings.logLevel === "debug") {
    console.log(...args);
  }
}
