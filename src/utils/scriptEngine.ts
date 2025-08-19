import { CustomScript } from '../types/settings';
import { Connection, ConnectionSession } from '../types/connection';
import { SettingsManager } from './settingsManager';
import { generateId } from './id';
import * as ts from 'typescript';

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
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;

    if (script.type === 'javascript') {
      return this.executeJavaScript(script.content, scriptContext, script.name);
    } else if (script.type === 'typescript') {
      if (isNode) {
        const js = this.transpileTypeScript(script.content, script.name);
        return this.executeJavaScript(js, scriptContext, script.name);
      }
      return this.executeInWorker(script.content, scriptContext, script.name, 'typescript');
    } else {
      throw new Error(`Unsupported script type: ${script.type}`);
    }
  }

  private async executeJavaScript(
    code: string,
    context: any,
    scriptName: string
  ): Promise<any> {
    const isNode = typeof process !== 'undefined' && !!process.versions?.node;

    if (isNode) {
      const { VM } = await import('vm2');
      const vm = new VM({ timeout: 1000, sandbox: {} });

      // Expose only whitelisted utilities
      for (const [key, value] of Object.entries(context)) {
        vm.freeze(value, key);
      }

      // Explicitly undefine globals
      [
        'global',
        'globalThis',
        'process',
        'window',
        'document',
        'self',
        'Function',
        'eval',
        'Proxy',
        'require',
        'fetch',
      ].forEach(g => vm.freeze(undefined, g));

      const wrapped = `"use strict"; (async () => { ${code} })();`;
      const resultPromise = vm.run(wrapped);
      return await Promise.race([
        resultPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Script execution timed out')), 1000)
        ),
      ]);
    }

    return await this.executeInWorker(code, context, scriptName);
  }

  private async executeInWorker(
    code: string,
    context: any,
    scriptName: string,
    language: 'javascript' | 'typescript' = 'javascript'
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const workerScript = `
        const pending = new Map();
        let rpcId = 0;
        function rpcCall(method, ...args) {
          return new Promise((resolve, reject) => {
            const id = rpcId++;
            pending.set(id, { resolve, reject });
            postMessage({ type: 'rpc', id, method, args });
          });
        }

        onmessage = async (event) => {
          const data = event.data;
          if (data.type === 'rpc-response') {
            const handler = pending.get(data.id);
            if (handler) {
              pending.delete(data.id);
              data.error ? handler.reject(data.error) : handler.resolve(data.result);
            }
            return;
          }
          if (data.type !== 'execute') return;
          const base = data.context;
          let code = data.code;
          if (data.language === 'typescript') {
            try {
              if (!(self).ts) {
                importScripts('https://cdn.jsdelivr.net/npm/typescript@5.5.3/lib/typescript.js');
              }
              const result = (self).ts.transpileModule(code, { compilerOptions: { module: (self).ts.ModuleKind.ESNext, target: (self).ts.ScriptTarget.ES2017 }, reportDiagnostics: true });
              if (result.diagnostics && result.diagnostics.length) {
                const message = result.diagnostics.map(d => (self).ts.flattenDiagnosticMessageText(d.messageText, '\\n')).join('\\n');
                postMessage({ type: 'result', error: message });
                return;
              }
              code = result.outputText;
            } catch (err) {
              postMessage({ type: 'result', error: err?.message || String(err) });
              return;
            }
          }
          const console = {
            log: (...a) => postMessage({ type: 'console', level: 'info', message: a.join(' ') }),
            warn: (...a) => postMessage({ type: 'console', level: 'warn', message: a.join(' ') }),
            error: (...a) => postMessage({ type: 'console', level: 'error', message: a.join(' ') }),
          };
          const http = {
            get: (url, options) => rpcCall('http.get', url, options),
            post: (url, data, options) => rpcCall('http.post', url, data, options),
            put: (url, data, options) => rpcCall('http.put', url, data, options),
            delete: (url, options) => rpcCall('http.delete', url, options),
          };
          const ssh = base.session && base.session.protocol === 'ssh' ? {
            execute: cmd => rpcCall('ssh.execute', cmd),
            sendKeys: keys => rpcCall('ssh.sendKeys', keys)
          } : undefined;
          const api = {
            connection: base.connection,
            session: base.session,
            trigger: base.trigger,
            console,
            http,
            ssh,
            sleep: ms => new Promise(r => setTimeout(r, ms)),
            uuid: () => rpcCall('uuid'),
            timestamp: () => new Date().toISOString(),
            getSetting: key => rpcCall('getSetting', key),
            setSetting: (key, value) => rpcCall('setSetting', key, value),
          };
          try {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const fn = new AsyncFunction(
              ...Object.keys(api),
              'globalThis',
              'self',
              '"use strict"; return (async () => { ' + code + ' })();'
            );
            const result = await fn(...Object.values(api), undefined, undefined);
            postMessage({ type: 'result', result });
          } catch (err) {
            postMessage({ type: 'result', error: err?.message || String(err) });
          }
        };
      `;

      const blob = new Blob([workerScript], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      const rpcHandlers: Record<string, (...args: any[]) => Promise<any>> = {
        'http.get': (url: string, options?: RequestInit) => this.httpRequest('GET', url, options),
        'http.post': (url: string, data?: any, options?: RequestInit) =>
          this.httpRequest('POST', url, data !== undefined ? { ...options, body: JSON.stringify(data) } : options),
        'http.put': (url: string, data?: any, options?: RequestInit) =>
          this.httpRequest('PUT', url, data !== undefined ? { ...options, body: JSON.stringify(data) } : options),
        'http.delete': (url: string, options?: RequestInit) => this.httpRequest('DELETE', url, options),
        'ssh.execute': (cmd: string) =>
          context.session ? this.sshExecute(context.session, cmd) : Promise.reject('No SSH session'),
        'ssh.sendKeys': (keys: string) =>
          context.session ? this.sshSendKeys(context.session, keys) : Promise.reject('No SSH session'),
        getSetting: (key: string) => Promise.resolve(this.getSetting(key)),
        setSetting: (key: string, value: any) => this.setSetting(key, value),
        uuid: () => Promise.resolve(generateId()),
      };

      worker.onmessage = async event => {
        const data = event.data;
        if (data.type === 'console') {
          this.scriptLog(data.level, scriptName, data.message);
          return;
        }
        if (data.type === 'rpc') {
          const { id, method, args } = data;
          const handler = rpcHandlers[method];
          if (!handler) {
            worker.postMessage({ type: 'rpc-response', id, error: 'Unknown method' });
            return;
          }
          try {
            const result = await handler(...args);
            worker.postMessage({ type: 'rpc-response', id, result });
          } catch (err) {
            worker.postMessage({
              type: 'rpc-response',
              id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return;
        }
        if (data.type === 'result') {
          clearTimeout(timeoutId);
          worker.terminate();
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error('Script execution timed out'));
      }, 1000);

      worker.postMessage({ type: 'execute', context, code, language });
    });
  }

  private transpileTypeScript(code: string, scriptName: string): string {
    const result = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2017 },
      reportDiagnostics: true,
    });
    if (result.diagnostics && result.diagnostics.length > 0) {
      const message = result.diagnostics
        .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
        .join('\n');
      throw new Error(`TypeScript compilation failed in ${scriptName}: ${message}`);
    }
    return result.outputText;
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
