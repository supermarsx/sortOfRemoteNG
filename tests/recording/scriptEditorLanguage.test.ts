import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { StringStream, ensureSyntaxTree } from "@codemirror/language";
import { CompletionContext } from "@codemirror/autocomplete";
import { localCompletionSource } from "@codemirror/lang-javascript";
import {
  batchSyntax,
  javaScriptSyntaxDiagnostics,
  nativeScriptDiagnostics,
  scriptCompletions,
  scriptLanguageExtension,
} from "../../src/utils/recording/scriptEditorLanguage";
import {
  formatJavaScript,
  withinScriptToolLimit,
} from "../../src/utils/recording/scriptEditorTools";

describe("real script language helpers", () => {
  it("provides TypeScript grammar, local completion and real local formatting without native tooling", async () => {
    const source = "const typedName: string = 'sample';\ntyped";
    expect(javaScriptSyntaxDiagnostics(source, "typescript")).toEqual([]);
    expect(
      javaScriptSyntaxDiagnostics("const x: = ;", "typescript").length,
    ).toBeGreaterThan(0);
    const state = EditorState.create({
      doc: source,
      extensions: [scriptLanguageExtension("typescript")],
    });
    ensureSyntaxTree(state, source.length, 1000);
    expect(
      localCompletionSource(
        new CompletionContext(state, source.length, true),
      )?.options.some((item) => item.label === "typedName"),
    ).toBe(true);
    expect(await formatJavaScript("const value:number=1", "typescript")).toBe(
      "const value: number = 1;\n",
    );
    expect(scriptCompletions("typescript")).toEqual([]);
  });
  it("uses actual JavaScript grammar errors, never evaluates source", () => {
    const execute = vi.fn();
    Object.assign(globalThis, { editorMustNotExecute: execute });
    expect(
      javaScriptSyntaxDiagnostics(
        "globalThis.editorMustNotExecute(); const okay = 1;",
      ),
    ).toEqual([]);
    expect(javaScriptSyntaxDiagnostics("const = ;").length).toBeGreaterThan(0);
    expect(execute).not.toHaveBeenCalled();
    Reflect.deleteProperty(globalThis, "editorMustNotExecute");
  });
  it("offers actual local JavaScript variable completion", () => {
    const source = "const customerName = 'sample';\ncustomer";
    const state = EditorState.create({
      doc: source,
      extensions: [scriptLanguageExtension("javascript")],
    });
    ensureSyntaxTree(state, source.length, 1000);
    const result = localCompletionSource(
      new CompletionContext(state, source.length, true),
    );
    expect(result?.options.some((item) => item.label === "customerName")).toBe(
      true,
    );
  });
  it.each(["bash", "sh", "powershell", "batch"] as const)(
    "%s language loads syntax mode and explicit snippets",
    (language) => {
      const state = EditorState.create({
        doc:
          language === "batch"
            ? '@echo off\necho "%PATH%"'
            : language === "powershell"
              ? 'Write-Output "$value"'
              : 'printf "%s\\n" "$value"',
        extensions: [scriptLanguageExtension(language)],
      });
      expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
      const completions = scriptCompletions(language);
      expect(completions.length).toBeGreaterThan(10);
      expect(completions.some((item) => item.detail === "snippet")).toBe(true);
    },
  );
  it.each([
    'echo "%"',
    'echo "!"',
    'echo "%unfinished"',
    'echo "!unfinished"',
    'echo "%%"',
    'echo "100% safe!"',
    'echo "unterminated',
  ])(
    "Batch consumes every token of %s without pretending to lint",
    (source) => {
      const stream = new StringStream(source, 4, 2);
      const state = batchSyntax.startState!(2);
      let count = 0;
      while (!stream.eol()) {
        stream.start = stream.pos;
        const before = stream.pos;
        batchSyntax.token(stream, state);
        expect(stream.pos).toBeGreaterThan(before);
        expect(++count).toBeLessThanOrEqual(source.length);
      }
      expect(stream.pos).toBe(source.length);
    },
  );
  it("maps native UTF-16 diagnostic positions without splitting astral offsets", () => {
    const source = "😀 value\nsecond";
    const result = nativeScriptDiagnostics(
      source,
      [
        {
          line: 1,
          column: 4,
          endLine: 1,
          endColumn: 9,
          severity: "warning",
          code: "SC1",
          message: "Review value",
        },
      ],
      "ShellCheck",
    );
    expect(result).toEqual([
      {
        from: 3,
        to: 8,
        severity: "warning",
        source: "ShellCheck",
        message: "SC1: Review value",
      },
    ]);
  });
  it("formats JavaScript with the real local Prettier parser without running it", async () => {
    const source = "const value={a:1,b:[2,3]};";
    const result = await formatJavaScript(source);
    expect(result).toBe("const value = { a: 1, b: [2, 3] };\n");
    await expect(formatJavaScript("const =")).rejects.toThrow();
  });
  it("bounds by UTF-8 bytes and never truncates oversized drafts", async () => {
    expect(withinScriptToolLimit("a".repeat(65536))).toBe(true);
    expect(withinScriptToolLimit("😀".repeat(16385))).toBe(false);
    await expect(formatJavaScript("a".repeat(65537))).rejects.toThrow(
      "not been truncated",
    );
    expect(javaScriptSyntaxDiagnostics("a".repeat(65537))).toEqual([]);
  });
});
