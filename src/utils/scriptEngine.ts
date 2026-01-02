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
    context: any,
    scriptName: string,
    signal?: AbortSignal,
  ): Promise<T> {
    // Use Tauri IPC for script execution
    const { invoke } = await import("@tauri-apps/api/core");

    const scriptContext = {
      connection_id: context.connection?.id,
      session_id: context.session?.id,
      trigger: context.trigger,
    };

    try {
      const result = await invoke("execute_user_script", {
        code,
        scriptType: "javascript",
        context: scriptContext,
      });

      if (result.success) {
        // For now, return a simple result
        // TODO: Implement proper result parsing and context handling
        return result.result as T;
      } else {
        const errorMessage = result.error || "Script execution failed";
        if (errorMessage.startsWith("AbortError:")) {
          throw new DOMException(errorMessage.substring("AbortError:".length).trim(), "AbortError");
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      // If it's already a proper error, re-throw it
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Script execution failed: ${error}`);
    }
  }

  private async executeInWorker<T>(
    code: string,
    context: any,
    scriptName: string,
    language: "javascript" | "typescript" = "javascript",
    signal?: AbortSignal,
  ): Promise<T> {
    // Use Tauri IPC for script execution
    const { invoke } = await import("@tauri-apps/api/core");

    const scriptContext = {
      connection_id: context.connection?.id,
      session_id: context.session?.id,
      trigger: context.trigger,
    };

    try {
      const result = await invoke("execute_user_script", {
        code,
        scriptType: language,
        context: scriptContext,
      });

      if (result.success) {
        // For now, return a simple result
        // TODO: Implement proper result parsing and context handling
        return result.result as T;
      } else {
        const errorMessage = result.error || "Script execution failed";
        if (errorMessage.startsWith("AbortError:")) {
          throw new DOMException(errorMessage.substring("AbortError:".length).trim(), "AbortError");
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      // If it's already a proper error, re-throw it
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Script execution failed: ${error}`);
    }
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
    const { headers: optHeaders, signal: optSignal, ...restOptions } = options;
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

    let combinedSignal: AbortSignal | undefined;
    if (signal && optSignal) {
      const controller = new AbortController();
      const forward = (sig: AbortSignal) => {
        if (sig.aborted) {
          controller.abort(sig.reason);
        } else {
          sig.addEventListener("abort", () => controller.abort(sig.reason), {
            once: true,
          });
        }
      };
      forward(signal);
      forward(optSignal);
      combinedSignal = controller.signal;
    } else {
      combinedSignal = signal || optSignal;
    }

    const response = await fetch(url, {
      method,
      headers,
      ...restOptions,
      signal: combinedSignal,
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
