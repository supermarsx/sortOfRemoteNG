import { describe, it, expect, vi } from "vitest";
import {
  ScriptEngine,
  ScriptExecutionContext,
} from "../src/utils/scriptEngine";
import { CustomScript } from "../src/types/settings";

describe("ScriptEngine abort handling", () => {
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
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
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
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalled();
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
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
