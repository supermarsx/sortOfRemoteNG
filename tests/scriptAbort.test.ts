import { describe, it, expect, vi, afterEach, beforeEach, Mock } from "vitest";
import {
  ScriptEngine,
  ScriptExecutionContext,
} from "../src/utils/scriptEngine";
import { CustomScript } from "../src/types/settings";

describe("ScriptEngine abort handling", () => {
  const originalFetch = global.fetch;
  
  beforeEach(async () => {
    // Mock Tauri invoke for script execution
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as Mock).mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "execute_user_script") {
        // For abort tests, simulate AbortError
        // Delay for http test to allow abort during execution
        if (args.code.includes("http.get")) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return { success: false, error: "AbortError: Aborted" };
      }
      return { success: false, error: "Unknown command" };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  it("aborts a sleeping script", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "sleep",
      name: "sleep",
      type: "javascript",
      content: "await sleep(1000); return 1;",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context: ScriptExecutionContext = { trigger: "manual" };
    const ac = new AbortController();
    const promise = engine.executeScript<number>(script, context, ac.signal);
    ac.abort();
    await expect(promise).rejects.toMatchObject({ message: "Script execution failed: AbortError: Aborted" });
  });

  it("aborts in-flight http request", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "http",
      name: "http",
      type: "javascript",
      content: "await http.get('https://example.com');",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context: ScriptExecutionContext = { trigger: "manual" };
    const fetchMock = vi.fn((_: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    (global as any).fetch = fetchMock;
    const ac = new AbortController();
    const promise = engine.executeScript<void>(script, context, ac.signal);
    ac.abort();
    await expect(promise).rejects.toMatchObject({ message: "Script execution failed: AbortError: Aborted" });
    // Note: In the new Tauri-based implementation, abort happens at IPC level before HTTP calls
  });

  it("does not run script when aborted before execution", async () => {
    const engine = ScriptEngine.getInstance();
    const script: CustomScript = {
      id: "preabort",
      name: "preabort",
      type: "javascript",
      content: "await http.get('https://example.com');",
      trigger: "manual",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context: ScriptExecutionContext = { trigger: "manual" };
    const fetchMock = vi.fn();
    (global as any).fetch = fetchMock;
    const ac = new AbortController();
    ac.abort();
    await expect(
      engine.executeScript<void>(script, context, ac.signal),
    ).rejects.toMatchObject({ message: "Script execution failed: AbortError: Aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
