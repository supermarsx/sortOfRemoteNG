const STORAGE_KEY = 'rdp-session-history';
const MAX_ENTRIES = 50;

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
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
