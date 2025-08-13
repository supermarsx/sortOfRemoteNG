import { ActionLogEntry, GlobalSettings } from '../../types/settings';
import { IndexedDbService } from '../indexedDbService';
import { generateId } from '../id';

export class ActionLogManager {
  private actionLog: ActionLogEntry[] = [];

  constructor(
    private getSettings: () => GlobalSettings,
    private getConnectionName: (id: string) => string,
  ) {}

  async load(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<any[]>('mremote-action-log');
      if (stored) {
        this.actionLog = stored.map(entry => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
      }
    } catch (error) {
      console.error('Failed to load action log:', error);
    }
  }

  logAction(
    level: 'debug' | 'info' | 'warn' | 'error',
    action: string,
    connectionId?: string,
    details: string = '',
    duration?: number,
  ): void {
    if (!this.getSettings().enableActionLog) return;

    const entry: ActionLogEntry = {
      id: generateId(),
      timestamp: new Date(),
      level,
      action,
      connectionId,
      connectionName: connectionId ? this.getConnectionName(connectionId) : undefined,
      details,
      duration,
    };

    this.actionLog.unshift(entry);

    if (this.actionLog.length > this.getSettings().maxLogEntries) {
      this.actionLog = this.actionLog.slice(0, this.getSettings().maxLogEntries);
    }

    void this.save();
  }

  getActionLog(): ActionLogEntry[] {
    return this.actionLog;
  }

  clearActionLog(): void {
    this.actionLog = [];
    void this.save();
  }

  private async save(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-action-log', this.actionLog);
    } catch (error) {
      console.error('Failed to save action log:', error);
    }
  }
}

