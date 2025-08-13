import { SettingsManager } from './settings';

export function debugLog(...args: unknown[]): void {
  const settings = SettingsManager.getInstance().getSettings();
  if (settings.logLevel === 'debug') {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}
