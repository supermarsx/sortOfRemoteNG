import { beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ invoke: vi.fn(), get: vi.fn() }));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: boundary.get }));
import {
  loadScriptToolCapabilities,
  analyzeInstalledScript,
  formatInstalledScript,
} from "../../src/utils/recording/scriptEditorTools";
beforeEach(() => {
  boundary.invoke.mockReset();
  boundary.get.mockReset().mockResolvedValue(boundary.invoke);
});
describe("bounded native static tool adapter", () => {
  it("discovers only capability names without sending source or installing tools", async () => {
    const item = {
      analysisAvailable: false,
      formatAvailable: false,
      analyzer: null,
      formatter: null,
      reason: "Not installed",
    };
    boundary.invoke.mockResolvedValue({
      languages: { bash: item, sh: item, powershell: item, batch: item },
    });
    expect((await loadScriptToolCapabilities()).batch.formatAvailable).toBe(
      false,
    );
    expect(boundary.invoke).toHaveBeenCalledExactlyOnceWith(
      "script_tooling_capabilities",
    );
  });
  it("submits literal source to only the fixed analysis command", async () => {
    boundary.invoke.mockResolvedValue({
      available: true,
      tool: "ShellCheck",
      reason: null,
      diagnostics: [
        {
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 2,
          severity: "warning",
          code: "SC1000",
          message: "Review",
        },
      ],
    });
    const source = "echo $(never-execute-me)";
    const result = await analyzeInstalledScript("sh", source);
    expect(boundary.invoke).toHaveBeenCalledExactlyOnceWith(
      "script_tooling_analyze",
      { language: "sh", source },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
  it("refuses unavailable or malformed results instead of claiming clean analysis", async () => {
    boundary.invoke.mockResolvedValue({
      available: false,
      tool: null,
      reason: "Install ShellCheck yourself",
      diagnostics: [],
    });
    await expect(analyzeInstalledScript("bash", "echo okay")).rejects.toThrow(
      "Install ShellCheck",
    );
    boundary.invoke.mockResolvedValue({
      available: true,
      tool: "Tool",
      reason: null,
      diagnostics: [{ line: 0, column: 1, endLine: 1, endColumn: 1 }],
    });
    await expect(analyzeInstalledScript("bash", "echo okay")).rejects.toThrow(
      "diagnostic position",
    );
  });
  it("rejects oversized source before even resolving native invocation", async () => {
    await expect(
      analyzeInstalledScript("bash", "😀".repeat(20000)),
    ).rejects.toThrow("64 KiB");
    expect(boundary.get).not.toHaveBeenCalled();
  });
  it("returns formatter text as a draft, no save/run/filesystem calls", async () => {
    boundary.invoke.mockResolvedValue({
      available: true,
      tool: "shfmt",
      reason: null,
      formatted: "echo okay\n",
    });
    expect(await formatInstalledScript("bash", "echo okay")).toEqual({
      formatted: "echo okay\n",
      tool: "shfmt",
    });
    expect(boundary.invoke).toHaveBeenCalledExactlyOnceWith(
      "script_tooling_format",
      { language: "bash", source: "echo okay" },
    );
  });
  it("browser-only mode and malformed formatter output are honest errors", async () => {
    boundary.get.mockResolvedValueOnce(null);
    await expect(loadScriptToolCapabilities()).rejects.toThrow("desktop app");
    boundary.invoke.mockResolvedValue({
      available: true,
      tool: "Tool",
      formatted: "x".repeat(65537),
      reason: null,
    });
    await expect(
      formatInstalledScript("powershell", "Get-Date"),
    ).rejects.toThrow("draft was not changed");
  });
});
