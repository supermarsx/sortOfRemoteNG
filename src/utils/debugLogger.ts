import { SettingsManager } from "./settingsManager";

export function debugLog(...args: unknown[]): void {
  const settings = SettingsManager.getInstance().getSettings();
  if (settings.logLevel === "debug") {
    console.log(...args);
  }
}
