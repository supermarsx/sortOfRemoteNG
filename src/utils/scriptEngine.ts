import { CustomScript } from '../types/settings';
import { Connection, ConnectionSession } from '../types/connection';
import { SettingsManager } from './settingsManager';
import { generateId } from './id';

export class ScriptEngine {
  private static instance: ScriptEngine | null = null;
  private settingsManager = SettingsManager.getInstance();

  static getInstance(): ScriptEngine {
    if (ScriptEngine.instance === null) {
      ScriptEngine.instance = new ScriptEngine();
    }
    return ScriptEngine.instance;
  }

  static resetInstance(): void {
    ScriptEngine.instance = null;
  }

  async executeScript(
    script: CustomScript,
    context: {
      connection?: Connection;
      session?: ConnectionSession;
      trigger: 'onConnect' | 'onDisconnect' | 'manual';
      [key: string]: any;
    }
  ): Promise<any> {
    if (!script.enabled) {
      throw new Error('Script is disabled');
    }

    const startTime = Date.now();
    this.settingsManager.logAction(
      'info',
      'Script execution started',
      context.connection?.id,
      `Script: ${script.name}, Trigger: ${context.trigger}`
    );

    try {
      const result = await this.runScript(script, context);
      
      const duration = Date.now() - startTime;
      this.settingsManager.logAction(
        'info',
        'Script execution completed',
        context.connection?.id,
        `Script: ${script.name}, Duration: ${duration}ms`,
        duration
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.settingsManager.logAction(
        'error',
        'Script execution failed',
        context.connection?.id,
        `Script: ${script.name}, Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        duration
      );
      throw error;
    }
  }

  private async runScript(script: CustomScript, context: any): Promise<any> {
    // Create a safe execution environment
    const scriptContext = {
      // Connection context
      connection: context.connection,
      session: context.session,
      trigger: context.trigger,
      
      // Utility functions
      console: {
        log: (...args: any[]) => this.scriptLog('info', script.name, args.join(' ')),
        warn: (...args: any[]) => this.scriptLog('warn', script.name, args.join(' ')),
        error: (...args: any[]) => this.scriptLog('error', script.name, args.join(' ')),
      },
      
      // HTTP utilities
      http: {
        get: (url: string, options?: RequestInit) => this.httpRequest('GET', url, options),
        post: (url: string, data?: any, options?: RequestInit) =>
          data !== undefined
            ? this.httpRequest('POST', url, { ...options, body: JSON.stringify(data) })
            : this.httpRequest('POST', url, options),
        put: (url: string, data?: any, options?: RequestInit) =>
          data !== undefined
            ? this.httpRequest('PUT', url, { ...options, body: JSON.stringify(data) })
            : this.httpRequest('PUT', url, options),
        delete: (url: string, options?: RequestInit) => this.httpRequest('DELETE', url, options),
      },
      
      // SSH utilities (if SSH session)
      ssh: context.session?.protocol === 'ssh' ? {
        execute: (command: string) => this.sshExecute(context.session, command),
        sendKeys: (keys: string) => this.sshSendKeys(context.session, keys),
      } : undefined,
      
      // Utility functions
      sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
      uuid: () => generateId(),
      timestamp: () => new Date().toISOString(),
      
      // Settings access
      getSetting: (key: string) => this.getSetting(key),
      setSetting: async (key: string, value: any) => this.setSetting(key, value),
    };

    // Execute the script
    if (script.type === 'javascript') {
      return this.executeJavaScript(script.content, scriptContext);
    } else if (script.type === 'typescript') {
      // For TypeScript, we'd need to transpile first
      // For now, treat as JavaScript
      return this.executeJavaScript(script.content, scriptContext);
    } else {
      throw new Error(`Unsupported script type: ${script.type}`);
    }
  }

  private async executeJavaScript(code: string, context: any): Promise<any> {
    // Create a function with the script code
    const scriptFunction = new Function(
      ...Object.keys(context),
      `
      "use strict";
      return (async function() {
        ${code}
      })();
      `
    );

    // Execute with context
    return await scriptFunction(...Object.values(context));
  }

  private async httpRequest(method: string, url: string, options: RequestInit = {}): Promise<any> {
    const { headers: optHeaders, ...restOptions } = options;
    let headers: Record<string, string> = {};

    if (optHeaders instanceof Headers) {
      optHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (optHeaders) {
      headers = { ...(optHeaders as Record<string, string>) };
    }

    const hasContentType = Object.keys(headers).some(
      h => h.toLowerCase() === 'content-type'
    );

    if (restOptions.body !== undefined && restOptions.body !== null && !hasContentType) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      ...restOptions,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    } else {
      return await response.text();
    }
  }

  private async sshExecute(session: ConnectionSession, command: string): Promise<string> {
    // This would integrate with the SSH client to execute commands
    // For now, return a placeholder
    this.settingsManager.logAction(
      'debug',
      'SSH command executed',
      session.connectionId,
      `Command: ${command}`
    );
    return `Executed: ${command}`;
  }

  private async sshSendKeys(session: ConnectionSession, keys: string): Promise<void> {
    // This would integrate with the SSH client to send key sequences
    this.settingsManager.logAction(
      'debug',
      'SSH keys sent',
      session.connectionId,
      `Keys: ${keys}`
    );
  }

  private scriptLog(level: 'info' | 'warn' | 'error', scriptName: string, message: string): void {
    this.settingsManager.logAction(level, 'Script log', undefined, `[${scriptName}] ${message}`);
  }

  private getSetting(key: string): any {
    const settings = this.settingsManager.getSettings();
    return (settings as any)[key];
  }

  private async setSetting(key: string, value: any): Promise<void> {
    await this.settingsManager.saveSettings({ [key]: value });
  }

  // Get scripts for a specific trigger and protocol
  getScriptsForTrigger(
    trigger: 'onConnect' | 'onDisconnect' | 'manual',
    protocol?: string
  ): CustomScript[] {
    return this.settingsManager.getCustomScripts().filter(script => 
      script.enabled &&
      script.trigger === trigger &&
      (!script.protocol || !protocol || script.protocol === protocol)
    );
  }

  // Execute all scripts for a trigger
  async executeScriptsForTrigger(
    trigger: 'onConnect' | 'onDisconnect',
    context: {
      connection: Connection;
      session: ConnectionSession;
    }
  ): Promise<void> {
    const scripts = this.getScriptsForTrigger(trigger, context.connection.protocol);
    
    for (const script of scripts) {
      try {
        await this.executeScript(script, { ...context, trigger });
      } catch (error) {
        console.error(`Script execution failed: ${script.name}`, error);
      }
    }
  }
}
