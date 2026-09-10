import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
const tools = vi.hoisted(() => ({
  discover: vi.fn(),
  analyze: vi.fn(),
  format: vi.fn(),
  javascript: vi.fn(),
}));
vi.mock("../../src/utils/recording/scriptEditorTools", async (original) => ({
  ...(await original<
    typeof import("../../src/utils/recording/scriptEditorTools")
  >()),
  loadScriptToolCapabilities: tools.discover,
  analyzeInstalledScript: tools.analyze,
  formatInstalledScript: tools.format,
  formatJavaScript: tools.javascript,
}));
import ScriptCodeEditorSurface from "../../src/components/ui/editor/ScriptCodeEditorSurface";
import type { ScriptCodeEditorProps } from "../../src/components/ui/editor/scriptEditorTypes";
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const capability = {
  analysisAvailable: true,
  formatAvailable: true,
  analyzer: "Installed parser",
  formatter: "Installed formatter",
  reason: null,
};
const discover = async () => {
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Check local tools" })),
  );
};
let visibility: PropertyDescriptor | undefined;
beforeEach(() => {
  tools.discover.mockReset().mockResolvedValue({
    bash: capability,
    sh: capability,
    powershell: capability,
    batch: {
      ...capability,
      analysisAvailable: false,
      formatAvailable: false,
    },
  });
  tools.analyze
    .mockReset()
    .mockResolvedValue({ diagnostics: [], tool: "Installed parser" });
  tools.format.mockReset().mockResolvedValue({
    formatted: "formatted\n",
    tool: "Installed formatter",
  });
  tools.javascript.mockReset().mockResolvedValue("const value = 1;\n");
  visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  if (!Range.prototype.getClientRects)
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
  if (!Range.prototype.getBoundingClientRect)
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (visibility)
    Object.defineProperty(document, "visibilityState", visibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
function mount(options: Partial<ScriptCodeEditorProps> = {}) {
  let props = {
    code: "echo one",
    language: "bash",
    documentKey: "script-a",
    ...options,
  } as Omit<ScriptCodeEditorProps, "onChange">;
  const changed = vi.fn((code: string) => {
    props = { ...props, code };
    mounted.rerender(<ScriptCodeEditorSurface {...props} onChange={changed} />);
  });
  const mounted = render(
    <ScriptCodeEditorSurface {...props} onChange={changed} />,
  );
  return {
    ...mounted,
    changed,
    view: () =>
      EditorView.findFromDOM(
        mounted.container.querySelector(".cm-editor") as HTMLElement,
      )!,
    update: (next: Partial<ScriptCodeEditorProps>) => {
      props = { ...props, ...next };
      mounted.rerender(
        <ScriptCodeEditorSurface {...props} onChange={changed} />,
      );
    },
  };
}
describe("actual mounted CodeMirror script editor", () => {
  it("edits and formats TypeScript locally without discovering or invoking shell tools", async () => {
    const editor = mount({
      language: "typescript",
      code: "const value:number=1",
    });
    expect(
      screen.queryByRole("button", { name: "Check local tools" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Syntax check" }));
    await screen.findByText(/TypeScript syntax parser: 0 diagnostic/);
    tools.javascript.mockResolvedValueOnce("const value: number = 1;\n");
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    await waitFor(() =>
      expect(editor.changed).toHaveBeenCalledWith("const value: number = 1;\n"),
    );
    expect(tools.javascript).toHaveBeenCalledWith(
      "const value:number=1",
      "typescript",
    );
    expect(tools.discover).not.toHaveBeenCalled();
    expect(tools.analyze).not.toHaveBeenCalled();
    expect(tools.format).not.toHaveBeenCalled();
  });
  it("edits the real model, provides line numbers and undo without native calls on mount", () => {
    const editor = mount();
    expect(
      screen.getByRole("textbox", { name: "Script code" }),
    ).toBeInTheDocument();
    expect(editor.container.querySelector(".cm-lineNumbers")).not.toBeNull();
    act(() =>
      editor.view().dispatch({ changes: { from: 8, insert: " more" } }),
    );
    expect(editor.changed).toHaveBeenLastCalledWith("echo one more");
    fireEvent.click(screen.getByRole("button", { name: "Undo code edit" }));
    expect(editor.view().state.doc.toString()).toBe("echo one");
    expect(tools.discover).not.toHaveBeenCalled();
    expect(tools.analyze).not.toHaveBeenCalled();
  });
  it("switching documentKey resets undo so another script can never be restored", () => {
    const editor = mount();
    act(() =>
      editor
        .view()
        .dispatch({ changes: { from: 8, insert: " old-secret-draft" } }),
    );
    expect(undoDepth(editor.view().state)).toBeGreaterThan(0);
    editor.update({
      code: "echo completely-different",
      documentKey: "script-b",
    });
    expect(undoDepth(editor.view().state)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Undo code edit" }));
    expect(editor.view().state.doc.toString()).toBe(
      "echo completely-different",
    );
  });
  it("shows genuine syntax diagnostics for malformed JavaScript", async () => {
    mount({ language: "javascript", code: "const = ;" });
    fireEvent.click(screen.getByRole("button", { name: "Syntax check" }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/JavaScript syntax error near this position/)
          .length,
      ).toBeGreaterThan(0),
    );
    expect(tools.analyze).not.toHaveBeenCalled();
  });
  it("manual formatting updates only the draft and can be undone", async () => {
    const editor = mount({ language: "javascript", code: "const value=1;" });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Format" })),
    );
    expect(editor.changed).toHaveBeenLastCalledWith("const value = 1;\n");
    expect(screen.getByText(/updated the draft only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo code edit" }));
    expect(editor.view().state.doc.toString()).toBe("const value=1;");
  });
  it.each(["edit", "document", "read-only-aba"])(
    "discards a formatter reply after %s changes",
    async (change) => {
      const pending = deferred<string>();
      tools.javascript.mockReturnValue(pending.promise);
      const editor = mount({ language: "javascript", code: "const value=1;" });
      fireEvent.click(screen.getByRole("button", { name: "Format" }));
      if (change === "edit")
        act(() =>
          editor.view().dispatch({
            changes: {
              from: editor.view().state.doc.length,
              insert: " // new edit",
            },
          }),
        );
      if (change === "document") editor.update({ documentKey: "script-b" });
      if (change === "read-only-aba") {
        editor.update({ readOnly: true });
        editor.update({ readOnly: false });
      }
      const before = editor.view().state.doc.toString();
      await act(async () => pending.resolve("OLD FORMATTED CONTENT"));
      expect(editor.view().state.doc.toString()).toBe(before);
      expect(editor.changed).not.toHaveBeenCalledWith("OLD FORMATTED CONTENT");
    },
  );
  it("native automatic analysis is opt-in via discovery, debounced, single-flight and latest-draft coalesced", async () => {
    vi.useFakeTimers();
    const first = deferred<{ diagnostics: []; tool: string }>();
    tools.analyze.mockReturnValueOnce(first.promise);
    const editor = mount();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(tools.analyze).not.toHaveBeenCalled();
    await discover();
    expect(screen.getByLabelText(/Analyze as I type/)).toBeChecked();
    await act(async () => vi.advanceTimersByTime(999));
    expect(tools.analyze).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(tools.analyze).toHaveBeenCalledExactlyOnceWith("bash", "echo one");
    act(() =>
      editor.view().dispatch({ changes: { from: 8, insert: " latest" } }),
    );
    await act(async () => vi.advanceTimersByTime(2000));
    expect(tools.analyze).toHaveBeenCalledTimes(1);
    await act(async () =>
      first.resolve({ diagnostics: [], tool: "Old parser" }),
    );
    expect(screen.queryByText(/Old parser:/)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(tools.analyze).toHaveBeenLastCalledWith("bash", "echo one latest");
    expect(tools.analyze).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(10000));
    expect(tools.analyze).toHaveBeenCalledTimes(2);
    expect(tools.format).not.toHaveBeenCalled();
  });
  it("pauses automatic tooling while hidden/read-only and cancels timers on unmount", async () => {
    vi.useFakeTimers();
    const editor = mount();
    await discover();
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => vi.advanceTimersByTime(3000));
    expect(tools.analyze).not.toHaveBeenCalled();
    editor.update({ readOnly: true });
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => vi.advanceTimersByTime(3000));
    expect(tools.analyze).not.toHaveBeenCalled();
    editor.update({ readOnly: false });
    editor.unmount();
    await act(async () => vi.advanceTimersByTime(3000));
    expect(tools.analyze).not.toHaveBeenCalled();
  });
  it("explicitly disables Batch formal tooling and preserves oversized code", async () => {
    const source = "x".repeat(65537);
    const editor = mount({ language: "batch", code: source });
    await discover();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
    expect(screen.getByText(/retained in full/)).toBeInTheDocument();
    expect(editor.view().state.doc.length).toBe(source.length);
    expect(tools.analyze).not.toHaveBeenCalled();
  });
});
