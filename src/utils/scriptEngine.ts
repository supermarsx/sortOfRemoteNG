import { CustomScript } from "../types/settings";
import { Connection, ConnectionSession } from "../types/connection";
import { SettingsManager } from "./settingsManager";
import { generateId } from "./id";
import * as ts from "typescript";

export interface ScriptExecutionContext extends Record<string, unknown> {
  connection?: Connection;
  session?: ConnectionSession;
  trigger: "onConnect" | "onDisconnect" | "manual";
}

export interface HttpClient {
  get<T = unknown>(url: string, options?: RequestInit): Promise<T>;
  post<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestInit,
  ): Promise<T>;
  put<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: RequestInit,
  ): Promise<T>;
  delete<T = unknown>(url: string, options?: RequestInit): Promise<T>;
}

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

  async executeScript<T = unknown>(
    script: CustomScript,
    context: ScriptExecutionContext,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!script.enabled) {
      throw new Error("Script is disabled");
    }

    const startTime = Date.now();
    this.settingsManager.logAction(
      "info",
      "Script execution started",
      context.connection?.id,
      `Script: ${script.name}, Trigger: ${context.trigger}`,
    );

    try {
      const result = await this.runScript<T>(script, context, signal);

      const duration = Date.now() - startTime;
      this.settingsManager.logAction(
        "info",
        "Script execution completed",
        context.connection?.id,
        `Script: ${script.name}, Duration: ${duration}ms`,
        duration,
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.settingsManager.logAction(
        "error",
        "Script execution failed",
        context.connection?.id,
        `Script: ${script.name}, Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        duration,
      );
      throw error;
    }
  }

  private async runScript<T>(
    script: CustomScript,
    context: ScriptExecutionContext,
    signal?: AbortSignal,
  ): Promise<T> {
    // Create a safe execution environment
    const scriptContext = {
      // Connection context
      connection: context.connection,
      session: context.session,
      trigger: context.trigger,

      // Utility functions
      console: {
        log: (...args: unknown[]) =>
          this.scriptLog("info", script.name, args.join(" ")),
        warn: (...args: unknown[]) =>
          this.scriptLog("warn", script.name, args.join(" ")),
        error: (...args: unknown[]) =>
          this.scriptLog("error", script.name, args.join(" ")),
      },

      // HTTP utilities
      http: {
        get: <R = unknown>(url: string, options?: RequestInit) =>
          this.httpRequest<R>("GET", url, options, signal),
        post: <R = unknown, D = unknown>(
          url: string,
          data?: D,
          options?: RequestInit,
        ) =>
          data !== undefined
            ? this.httpRequest<R>(
                "POST",
                url,
                {
                  ...options,
                  body: JSON.stringify(data),
                },
                signal,
              )
            : this.httpRequest<R>("POST", url, options, signal),
        put: <R = unknown, D = unknown>(
          url: string,
          data?: D,
          options?: RequestInit,
        ) =>
          data !== undefined
            ? this.httpRequest<R>(
                "PUT",
                url,
                {
                  ...options,
                  body: JSON.stringify(data),
                },
                signal,
              )
            : this.httpRequest<R>("PUT", url, options, signal),
        delete: <R = unknown>(url: string, options?: RequestInit) =>
          this.httpRequest<R>("DELETE", url, options, signal),
      },

      // SSH utilities (if SSH session)
      ssh:
        context.session?.protocol === "ssh"
          ? {
              execute: (command: string) =>
                this.sshExecute(context.session, command, signal),
              sendKeys: (keys: string) =>
                this.sshSendKeys(context.session, keys, signal),
            }
          : undefined,

      // Utility functions
      sleep: (ms: number) => this.sleep(ms, signal),
      uuid: () => generateId(),
      timestamp: () => new Date().toISOString(),

      // Settings access
      getSetting: (key: string) => this.getSetting(key),
      setSetting: async (key: string, value: unknown) =>
        this.setSetting(key, value),
    };

    // Execute the script
    const isNode = typeof process !== "undefined" && !!process.versions?.node;

    if (script.type === "javascript") {
      return this.executeJavaScript<T>(
        script.content,
        scriptContext,
        script.name,
        signal,
      );
    } else if (script.type === "typescript") {
      if (isNode) {
        const js = this.transpileTypeScript(script.content, script.name);
        return this.executeJavaScript<T>(
          js,
          scriptContext,
          script.name,
          signal,
        );
      }
      return this.executeInWorker<T>(
        script.content,
        scriptContext,
        script.name,
        "typescript",
        signal,
      );
    } else {
      throw new Error(`Unsupported script type: ${script.type}`);
    }
  }

  private async executeJavaScript<T>(
    code: string,
    context: ScriptExecutionContext,
    scriptName: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const isNode = typeof process !== "undefined" && !!process.versions?.node;

    if (isNode) {
      const { VM } = await import("vm2");
      const vm = new VM({ timeout: 1000, sandbox: {} });

      // Expose only whitelisted utilities
      for (const [key, value] of Object.entries(context)) {
        vm.freeze(value, key);
      }

      // Explicitly undefine globals
      [
        "global",
        "globalThis",
        "process",
        "window",
        "document",
        "self",
        "Function",
        "eval",
        "Proxy",
        "require",
        "fetch",
      ].forEach((g) => vm.freeze(undefined, g));

      const wrapped = `"use strict"; (async () => { ${code} })();`;
      const resultPromise = vm.run(wrapped);
      const abortPromise = new Promise<never>((_, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Script execution timed out")), 1000),
      );
      return await Promise.race([resultPromise, abortPromise, timeoutPromise]);
    }

    return await this.executeInWorker<T>(
      code,
      context,
      scriptName,
      "javascript",
      signal,
    );
  }

  private async executeInWorker<T>(
    code: string,
    context: ScriptExecutionContext,
    scriptName: string,
    language: "javascript" | "typescript" = "javascript",
    signal?: AbortSignal,
  ): Promise<T> {
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
              if (!(self).esbuildInitialized) {
                importScripts('https://cdn.jsdelivr.net/npm/esbuild-wasm@0.21.5/esbuild.js');
                await (self).esbuild.initialize({
                  wasmURL: 'https://cdn.jsdelivr.net/npm/esbuild-wasm@0.21.5/esbuild.wasm',
                  worker: false,
                });
                (self).esbuildInitialized = true;
              }
              const result = await (self).esbuild.transform(code, {
                loader: 'ts',
                format: 'esm',
                target: 'es2017',
              });
              code = result.code;
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
            sleep: ms => rpcCall('sleep', ms),
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
            postMessage({ type: 'result', error: { message: err?.message || String(err), name: err?.name } });
          }
        };
      `;

      const blob = new Blob([workerScript], { type: "application/javascript" });
      const worker = new Worker(URL.createObjectURL(blob));

      const rpcHandlers: Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      > = {
        "http.get": (url: string, options?: RequestInit) =>
          this.httpRequest("GET", url, options, signal),
        "http.post": (url: string, data?: unknown, options?: RequestInit) =>
          this.httpRequest(
            "POST",
            url,
            data !== undefined
              ? { ...options, body: JSON.stringify(data) }
              : options,
            signal,
          ),
        "http.put": (url: string, data?: unknown, options?: RequestInit) =>
          this.httpRequest(
            "PUT",
            url,
            data !== undefined
              ? { ...options, body: JSON.stringify(data) }
              : options,
            signal,
          ),
        "http.delete": (url: string, options?: RequestInit) =>
          this.httpRequest("DELETE", url, options, signal),
        "ssh.execute": (cmd: string) =>
          context.session
            ? this.sshExecute(context.session, cmd, signal)
            : Promise.reject("No SSH session"),
        "ssh.sendKeys": (keys: string) =>
          context.session
            ? this.sshSendKeys(context.session, keys, signal)
            : Promise.reject("No SSH session"),
        getSetting: (key: string) => Promise.resolve(this.getSetting(key)),
        setSetting: (key: string, value: unknown) =>
          this.setSetting(key, value),
        uuid: () => Promise.resolve(generateId()),
        sleep: (ms: number) => this.sleep(ms, signal),
      };

      worker.onmessage = async (event) => {
        const data = event.data;
        if (data.type === "console") {
          this.scriptLog(data.level, scriptName, data.message);
          return;
        }
        if (data.type === "rpc") {
          const { id, method, args } = data;
          const handler = rpcHandlers[method];
          if (!handler) {
            worker.postMessage({
              type: "rpc-response",
              id,
              error: "Unknown method",
            });
            return;
          }
          try {
            const result = await handler(...args);
            worker.postMessage({ type: "rpc-response", id, result });
          } catch (err) {
            worker.postMessage({
              type: "rpc-response",
              id,
              error:
                err instanceof Error
                  ? { message: err.message, name: err.name }
                  : { message: String(err) },
            });
          }
          return;
        }
        if (data.type === "result") {
          clearTimeout(timeoutId);
          worker.terminate();
          signal?.removeEventListener("abort", abortHandler);
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
          } else if (data.error) {
            reject(
              data.error.name
                ? new DOMException(data.error.message, data.error.name)
                : new Error(data.error.message || data.error),
            );
          } else {
            resolve(data.result);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        worker.terminate();
        reject(new Error("Script execution timed out"));
      }, 1000);

      const abortHandler = () => {
        clearTimeout(timeoutId);
        worker.terminate();
        signal?.removeEventListener("abort", abortHandler);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abortHandler, { once: true });

      worker.postMessage({ type: "execute", context, code, language });
    });
  }

  private transpileTypeScript(code: string, scriptName: string): string {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2017,
      },
      reportDiagnostics: true,
    });
    if (result.diagnostics && result.diagnostics.length > 0) {
      const message = result.diagnostics
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("\n");
      throw new Error(
        `TypeScript compilation failed in ${scriptName}: ${message}`,
      );
    }
    return result.outputText;
  }

  private async httpRequest<T>(
    method: string,
    url: string,
    options: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
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
      (h) => h.toLowerCase() === "content-type",
    );

    if (
      restOptions.body !== undefined &&
      restOptions.body !== null &&
      !hasContentType
    ) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      signal,
      ...restOptions,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return (await response.json()) as T;
    } else {
      return (await response.text()) as T;
    }
  }

  private async sshExecute(
    session: ConnectionSession,
    command: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const done = () => {
        this.settingsManager.logAction(
          "debug",
          "SSH command executed",
          session.connectionId,
          `Command: ${command}`,
        );
        resolve(`Executed: ${command}`);
      };

      const timeout = setTimeout(done, 0);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private async sshSendKeys(
    session: ConnectionSession,
    keys: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const done = () => {
        this.settingsManager.logAction(
          "debug",
          "SSH keys sent",
          session.connectionId,
          `Keys: ${keys}`,
        );
        resolve();
      };

      const timeout = setTimeout(done, 0);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal?.aborted) {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private scriptLog(
    level: "info" | "warn" | "error",
    scriptName: string,
    message: string,
  ): void {
    this.settingsManager.logAction(
      level,
      "Script log",
      undefined,
      `[${scriptName}] ${message}`,
    );
  }

  private getSetting(key: string): unknown {
    const settings = this.settingsManager.getSettings() as Record<
      string,
      unknown
    >;
    return settings[key];
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    await this.settingsManager.saveSettings({ [key]: value });
  }

  // Get scripts for a specific trigger and protocol
  getScriptsForTrigger(
    trigger: "onConnect" | "onDisconnect" | "manual",
    protocol?: string,
  ): CustomScript[] {
    return this.settingsManager
      .getCustomScripts()
      .filter(
        (script) =>
          script.enabled &&
          script.trigger === trigger &&
          (!script.protocol || !protocol || script.protocol === protocol),
      );
  }

  // Execute all scripts for a trigger
  async executeScriptsForTrigger(
    trigger: "onConnect" | "onDisconnect",
    context: {
      connection: Connection;
      session: ConnectionSession;
    },
  ): Promise<void> {
    const scripts = this.getScriptsForTrigger(
      trigger,
      context.connection.protocol,
    );

    for (const script of scripts) {
      try {
        await this.executeScript(script, { ...context, trigger });
      } catch (error) {
        console.error(`Script execution failed: ${script.name}`, error);
      }
    }
  }
}
