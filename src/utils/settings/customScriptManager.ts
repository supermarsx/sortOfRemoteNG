import { CustomScript } from '../../types/settings';
import { IndexedDbService } from '../indexedDbService';
import { generateId } from '../id';

export class CustomScriptManager {
  private customScripts: CustomScript[] = [];

  constructor(
    private logAction: (
      level: 'debug' | 'info' | 'warn' | 'error',
      action: string,
      connectionId?: string,
      details?: string,
      duration?: number,
    ) => void,
  ) {}

  async load(): Promise<void> {
    try {
      const stored = await IndexedDbService.getItem<any[]>('mremote-custom-scripts');
      if (stored) {
        this.customScripts = stored.map(script => ({
          ...script,
          createdAt: new Date(script.createdAt),
          updatedAt: new Date(script.updatedAt),
        }));
      }
    } catch (error) {
      console.error('Failed to load custom scripts:', error);
    }
  }

  addCustomScript(script: Omit<CustomScript, 'id' | 'createdAt' | 'updatedAt'>): CustomScript {
    const newScript: CustomScript = {
      ...script,
      id: generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.customScripts.push(newScript);
    void this.save();
    this.logAction('info', 'Custom script added', undefined, `Script "${script.name}" created`);

    return newScript;
  }

  updateCustomScript(id: string, updates: Partial<CustomScript>): void {
    const index = this.customScripts.findIndex(script => script.id === id);
    if (index !== -1) {
      this.customScripts[index] = {
        ...this.customScripts[index],
        ...updates,
        updatedAt: new Date(),
      };
      void this.save();
      this.logAction('info', 'Custom script updated', undefined, `Script "${this.customScripts[index].name}" updated`);
    }
  }

  deleteCustomScript(id: string): void {
    const script = this.customScripts.find(s => s.id === id);
    this.customScripts = this.customScripts.filter(s => s.id !== id);
    void this.save();
    this.logAction('info', 'Custom script deleted', undefined, `Script "${script?.name}" deleted`);
  }

  getCustomScripts(): CustomScript[] {
    return this.customScripts;
  }

  private async save(): Promise<void> {
    try {
      await IndexedDbService.setItem('mremote-custom-scripts', this.customScripts);
    } catch (error) {
      console.error('Failed to save custom scripts:', error);
    }
  }
}

