import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { ScriptEngine, ScriptExecutionContext } from "../scriptEngine";
import { SettingsManager } from "../settingsManager";
import { CustomScript } from "../../types/settings";

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
  (global as any).window = dom.window;
  (global as any).document = dom.window.document;
  localStorage.clear();
  SettingsManager.resetInstance();
  ScriptEngine.resetInstance();
});

describe("ScriptEngine.setSetting", () => {
  it("persists setting changes via scripts", async () => {
    const settingsManager = SettingsManager.getInstance();
    await settingsManager.loadSettings();
    const engine = ScriptEngine.getInstance();

    const script: CustomScript = {
      id: "s1",
      name: "update setting",
      type: "javascript",
      content: "await setSetting('colorScheme', 'purple');",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    await engine.executeScript<void>(script, context);

    SettingsManager.resetInstance();
    const again = SettingsManager.getInstance();
    const loaded = await again.loadSettings();
    expect(loaded.colorScheme).toBe("purple");
  });
});

describe("ScriptEngine sandbox", () => {
  it("prevents access to global window", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "s-window",
      name: "window access",
      type: "javascript",
      content: "return typeof window;",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    const result = await engine.executeScript<string>(script, context);
    expect(result).toBe("undefined");
  });

  it("prevents access to global document", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "s-document",
      name: "document access",
      type: "javascript",
      content: "return typeof document;",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    const result = await engine.executeScript<string>(script, context);
    expect(result).toBe("undefined");
  });

  it("hides globalThis and process", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "s-global",
      name: "global access",
      type: "javascript",
      content: "return [typeof globalThis, typeof process];",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    const result = await engine.executeScript<string[]>(script, context);
    expect(result).toEqual(["undefined", "undefined"]);
  });
});

describe("ScriptEngine error handling", () => {
  it("reports script errors", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "s-error",
      name: "error script",
      type: "javascript",
      content: "throw new Error('boom');",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    await expect(engine.executeScript<void>(script, context)).rejects.toThrow(
      "boom",
    );
  });

  it("enforces execution timeout", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "s-timeout",
      name: "timeout script",
      type: "javascript",
      content: "while(true) {}",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    await expect(engine.executeScript<void>(script, context)).rejects.toThrow(
      /timed out/,
    );
  });
});

describe("ScriptEngine TypeScript", () => {
  it("executes TypeScript scripts", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "ts-success",
      name: "ts script",
      type: "typescript",
      content: "const n: number = 1; return n;",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    const result = await engine.executeScript<number>(script, context);
    expect(result).toBe(1);
  });

  it("surfaces TypeScript compilation errors", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "ts-error",
      name: "ts error",
      type: "typescript",
      content: "const o = ;",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const context: ScriptExecutionContext = { trigger: "manual" };
    await expect(engine.executeScript<void>(script, context)).rejects.toThrow(
      /TypeScript compilation failed/,
    );
  });
});

describe("ScriptEngine.httpRequest", () => {
  it("makes GET request without Content-Type header", async () => {
    const engine = ScriptEngine.getInstance();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      status: 200,
      statusText: "OK",
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response);
    (global as any).fetch = fetchSpy;

    const httpRequest = (
      engine as unknown as {
        httpRequest: <T>(
          method: string,
          url: string,
          options?: RequestInit,
        ) => Promise<T>;
      }
    ).httpRequest;
    await httpRequest<unknown>("GET", "https://example.com");

    const headers = fetchSpy.mock.calls[0][1]?.headers;
    if (headers instanceof Headers) {
      expect(headers.has("Content-Type")).toBe(false);
      expect(headers.has("content-type")).toBe(false);
    } else {
      expect(headers?.["Content-Type"]).toBeUndefined();
      expect(headers?.["content-type"]).toBeUndefined();
    }
  });
});
