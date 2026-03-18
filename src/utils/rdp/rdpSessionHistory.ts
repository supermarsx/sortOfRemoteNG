import { SettingsManager } from '../settings/settingsManager';

const STORAGE_KEY = 'rdp-session-history';
const DEFAULT_MAX_ENTRIES = 1000;

function getMaxEntries(): number {
  try {
    const settings = SettingsManager.getInstance().getSettings();
    return (settings as any).rdpSessionHistoryMax ?? DEFAULT_MAX_ENTRIES;
  } catch {
    return DEFAULT_MAX_ENTRIES;
  }
}

export interface RDPSessionHistoryEntry {
  connectionId: string;
  connectionName: string;
  hostname: string;
  port: number;
  username: string;
  lastConnected: string;
  disconnectedAt: string;
  duration: number;
  desktopWidth: number;
  desktopHeight: number;
}

export function loadSessionHistory(): RDPSessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSessionHistory(entries: RDPSessionHistoryEntry[]): void {
  try {
    const max = getMaxEntries();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, max)));
  } catch { /* ignore */ }
}

export function recordRdpSessionHistory(entry: RDPSessionHistoryEntry): void {
  const history = loadSessionHistory();
  history.unshift(entry);
  saveSessionHistory(history);
}

export function clearSessionHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
