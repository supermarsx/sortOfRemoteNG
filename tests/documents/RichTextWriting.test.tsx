import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Editor } from "@tiptap/core";
import RichTextEditor, {
  type RichTextEditorProps,
} from "../../src/components/documents/RichTextEditor";
import { fromEditorContent } from "../../src/components/documents/richTextAdapter";
import type { DocumentRichTextNode } from "../../src/types/documents/document";
import type { RichTextBlockInsertion } from "../../src/utils/documents/documentInlineInsert";

type GuardedInsertion = RichTextBlockInsertion & { isCurrent: () => boolean };
const paragraph = (text = ""): DocumentRichTextNode => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const document = (
  ...content: DocumentRichTextNode[]
): DocumentRichTextNode => ({ type: "doc", content });
const rects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const box = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }),
  });
});
afterEach(cleanup);
afterAll(() => {
  if (rects) Object.defineProperty(Range.prototype, "getClientRects", rects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (box) Object.defineProperty(Range.prototype, "getBoundingClientRect", box);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});

function Harness(
  props: RichTextEditorProps & { replacement?: DocumentRichTextNode },
) {
  const [value, setValue] = useState(props.content);
  return (
    <RichTextEditor
      {...props}
      content={props.replacement ?? value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}
async function mount(
  extra: Partial<RichTextEditorProps> = {},
  position: number | "end" = "end",
) {
  const props: RichTextEditorProps = {
    content: document(paragraph("/")),
    onChange: vi.fn(),
    documentKey: "writing",
    presentation: "inline",
    onInsertBlock: vi.fn(() => false),
    ...extra,
  };
  const view = render(<Harness {...props} />);
  const dom = await screen.findByRole("textbox", {
    name: "Rich document text",
  });
  const editor = (dom as HTMLElement & { editor: Editor }).editor;
  await act(async () => {
    editor.commands.focus(position);
  });
  await waitFor(() => expect(editor.isFocused).toBe(true));
  return { ...view, dom, editor, props };
}
async function type(editor: Editor, text: string) {
  for (const char of text)
    await act(async () => {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handler) =>
        handler(editor.view, from, to, char, () =>
          editor.state.tr.insertText(char, from, to),
        ),
      );
      if (!handled)
        editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("inline writing surface", () => {
  it("starts without bulky formatting controls and exposes them on demand", async () => {
    await mount({
      content: document(paragraph("A paragraph")),
      onInsertBlock: undefined,
    });
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByText(/Paste inserts plain text/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show text formatting" }),
    );
    expect(
      screen.getByRole("toolbar", { name: "Text formatting" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.getByRole("button", { name: "Apply link" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Hide text formatting" }),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
  it.each([
    ["# ", "heading"],
    ["- ", "bulletList"],
    ["1. ", "orderedList"],
    ["> ", "blockquote"],
  ])(
    "keeps the real StarterKit Markdown rule for %s",
    async (text, expected) => {
      const { editor } = await mount({ content: document(paragraph()) });
      await type(editor, text);
      expect(fromEditorContent(editor.getJSON()).content?.[0].type).toBe(
        expected,
      );
      expect(screen.queryByRole("listbox")).toBeNull();
    },
  );
  it("keeps native typing undo and plain-text-only paste in inline mode", async () => {
    const { editor, dom } = await mount({ content: document(paragraph()) });
    await type(editor, "hello");
    expect(dom).toHaveTextContent("hello");
    fireEvent.keyDown(dom, { key: "z", ctrlKey: true });
    await waitFor(() => expect(dom).not.toHaveTextContent("hello"));
    fireEvent.paste(dom, {
      clipboardData: {
        getData: (format: string) =>
          format === "text/plain"
            ? "Safe text"
            : '<img src="https://untrusted.test"><script>alert(1)</script>',
      },
    });
    expect(dom).toHaveTextContent("Safe text");
    expect(dom.querySelector("img,script")).toBeNull();
  });
});

describe("real editor slash insert", () => {
  it("lists every supported block, filters by policy, and navigates accessibly without changing source", async () => {
    const { dom, props, rerender } = await mount();
    const list = await screen.findByRole("listbox", {
      name: "Insert document block",
    });
    expect(screen.getAllByRole("option")).toHaveLength(13);
    expect(dom).toHaveAttribute("aria-controls", list.id);
    rerender(<Harness {...props} insertableBlocks={["note", "spreadsheet"]} />);
    expect(
      screen.getAllByRole("option").map((entry) => entry.textContent),
    ).toEqual(["Note", "Spreadsheet"]);
    fireEvent.keyDown(dom, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Spreadsheet" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(dom).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Spreadsheet" }).id,
    );
    fireEvent.keyDown(dom, { key: "Enter" });
    await waitFor(() => expect(props.onInsertBlock).toHaveBeenCalledOnce());
    expect(vi.mocked(props.onInsertBlock!).mock.calls[0][0]).toMatchObject({
      type: "spreadsheet",
      original: document(paragraph("/")),
      before: null,
      after: null,
    });
    expect(dom).toHaveTextContent("/");
  });
  it.each([
    ["/table", "Spreadsheet"],
    ["/image", "Attachment"],
  ])("finds %s through search keywords", async (query, label) => {
    await mount({ content: document(paragraph(query)) });
    expect(
      await screen.findByRole("option", { name: label }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
  it("preserves earlier blocks and all right-hand text, marks, references and trailing paragraphs", async () => {
    const reference: DocumentRichTextNode = {
      type: "reference",
      reference: { databaseId: "db", kind: "document", id: "related" },
    };
    const suffix: DocumentRichTextNode[] = [
      {
        type: "text",
        text: " keep",
        marks: [
          { type: "italic" },
          { type: "link", href: "https://example.test" },
        ],
      },
      reference,
      { type: "hardBreak" },
      { type: "text", text: "tail", marks: [{ type: "bold" }] },
    ];
    const before = paragraph("Before");
    const after = paragraph("After");
    const content = document(
      before,
      {
        type: "paragraph",
        content: [
          { type: "text", text: "/table", marks: [{ type: "bold" }] },
          ...suffix,
        ],
      },
      after,
    );
    const { dom, props, editor } = await mount(
      { content },
      "Before".length + 2 + 1 + "/table".length,
    );
    await screen.findByRole("option", { name: "Spreadsheet" });
    const canonical = fromEditorContent(editor.getJSON());
    vi.mocked(props.onChange).mockClear();
    fireEvent.keyDown(dom, { key: "Enter" });
    await waitFor(() => expect(props.onInsertBlock).toHaveBeenCalledOnce());
    expect(vi.mocked(props.onInsertBlock!).mock.calls[0][0]).toMatchObject({
      original: canonical,
      before: document(before),
      after: document(
        { type: "paragraph", content: canonical.content![1].content!.slice(1) },
        after,
      ),
    });
    expect(fromEditorContent(editor.getJSON())).toEqual(canonical);
    const kept = vi.mocked(props.onInsertBlock!).mock.calls[0][0].after!
      .content![0].content!;
    expect(kept[0].marks).toEqual(
      expect.arrayContaining([
        { type: "italic" },
        { type: "link", href: "https://example.test" },
      ]),
    );
    expect(kept.slice(1)).toEqual(suffix.slice(1));
    expect(props.onChange).not.toHaveBeenCalled();
  });
  it("Escape dismisses without editing, and a changed query opens a fresh menu", async () => {
    const { dom, editor, props } = await mount();
    await screen.findByRole("listbox");
    fireEvent.keyDown(dom, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dom).toHaveTextContent("/");
    expect(props.onInsertBlock).not.toHaveBeenCalled();
    await type(editor, "table");
    expect(
      await screen.findByRole("option", { name: "Spreadsheet" }),
    ).toBeInTheDocument();
  });
  it("keeps unmatched queries visible without running Enter as an insertion", async () => {
    const { dom, props } = await mount({
      content: document(paragraph("/nonexistent")),
    });
    expect(
      await screen.findByText("No matching enabled blocks"),
    ).toBeInTheDocument();
    fireEvent.keyDown(dom, { key: "Enter" });
    expect(props.onInsertBlock).not.toHaveBeenCalled();
    expect(dom).toHaveTextContent("/nonexistent");
  });
  it.each([
    document({
      type: "codeBlock",
      content: [{ type: "text", text: "/table" }],
    }),
    document({
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("/table")] }],
    }),
    document({ type: "blockquote", content: [paragraph("/table")] }),
    document({
      type: "heading",
      level: 2,
      content: [{ type: "text", text: "/table" }],
    }),
    document({
      type: "paragraph",
      content: [{ type: "text", text: "/table", marks: [{ type: "code" }] }],
    }),
    document(paragraph("Text /table")),
    document({
      type: "paragraph",
      content: [
        {
          type: "reference",
          reference: { databaseId: "db", kind: "document", id: "other" },
        },
        { type: "text", text: "/table" },
      ],
    }),
    document(paragraph(`/${"x".repeat(65)}`)),
  ])(
    "does not trigger in an ineligible paragraph or position (%j)",
    async (content) => {
      const { props } = await mount({ content });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(props.onInsertBlock).not.toHaveBeenCalled();
    },
  );
  it("does not trigger for a selected range, absent callback or an empty enabled list", async () => {
    const { editor, props, rerender } = await mount({
      content: document(paragraph("/table")),
      insertableBlocks: [],
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<Harness {...props} insertableBlocks={["spreadsheet"]} />);
    await screen.findByRole("listbox");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 7 });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<Harness {...props} onInsertBlock={undefined} />);
    act(() => {
      editor.commands.setTextSelection(7);
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("scrolls only the menu container when moving to an off-screen option", async () => {
    const { dom } = await mount({ insertableBlocks: ["note", "spreadsheet"] });
    const list = await screen.findByRole("listbox");
    const option = screen.getByRole("option", { name: "Spreadsheet" });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 64,
    });
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 64,
      left: 0,
      right: 272,
      width: 272,
      height: 64,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(option, "getBoundingClientRect").mockReturnValue({
      top: 180,
      bottom: 212,
      left: 0,
      right: 272,
      width: 272,
      height: 32,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    });
    const outer = list.parentElement!;
    outer.scrollTop = 31;
    fireEvent.keyDown(dom, { key: "ArrowDown" });
    expect(list.scrollTop).toBe(152);
    expect(outer.scrollTop).toBe(31);
  });
});

describe("async slash insert protection", () => {
  it("retains source until parent success, prevents duplicate picks, and treats a canceled picker as no edit", async () => {
    const result = deferred<boolean>();
    const insert = vi.fn(() => result.promise);
    const { dom, editor, props } = await mount({
      content: document(paragraph("/image")),
      onInsertBlock: insert,
    });
    await screen.findByRole("option", { name: "Attachment" });
    vi.mocked(props.onChange).mockClear();
    fireEvent.keyDown(dom, { key: "Enter" });
    fireEvent.keyDown(dom, { key: "Enter" });
    expect(insert).toHaveBeenCalledOnce();
    expect(dom).toHaveTextContent("/image");
    expect(props.onChange).not.toHaveBeenCalled();
    await act(async () => {
      result.resolve(false);
    });
    expect(fromEditorContent(editor.getJSON())).toEqual(
      document(paragraph("/image")),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it.each([
    "selection",
    "source",
    "readOnly",
    "unmount",
    "documentKey",
    "composition",
    "Escape",
    "policy",
  ])(
    "revokes a pending request after %s changes, including after restoration",
    async (reason) => {
      const result = deferred<void>();
      const commit = vi.fn();
      const insert = vi.fn(async (request: RichTextBlockInsertion) => {
        await result.promise;
        if (!(request as GuardedInsertion).isCurrent()) return false;
        commit();
        return true;
      });
      const { dom, editor, props, rerender, unmount } = await mount({
        content: document(paragraph("/image")),
        onInsertBlock: insert,
      });
      await screen.findByRole("option", { name: "Attachment" });
      fireEvent.keyDown(dom, { key: "Enter" });
      const request = insert.mock.calls[0][0] as GuardedInsertion;
      expect(request.isCurrent()).toBe(true);
      if (reason === "selection") {
        act(() => {
          editor.commands.setTextSelection(1);
        });
        act(() => {
          editor.commands.setTextSelection(7);
        });
      } else if (reason === "source") {
        await type(editor, " changed");
      } else if (reason === "readOnly") {
        rerender(<Harness {...props} readOnly />);
        rerender(<Harness {...props} readOnly={false} />);
      } else if (reason === "unmount") unmount();
      else if (reason === "documentKey")
        rerender(<Harness {...props} documentKey="writing-history-restored" />);
      else if (reason === "composition") fireEvent.compositionStart(dom);
      else if (reason === "Escape") fireEvent.keyDown(dom, { key: "Escape" });
      else rerender(<Harness {...props} insertableBlocks={[]} />);
      expect(request.isCurrent()).toBe(false);
      await act(async () => {
        result.resolve();
      });
      expect(commit).not.toHaveBeenCalled();
      if (reason !== "unmount") expect(dom.textContent).toContain("/image");
    },
  );
  it("does not insert on IME Enter or show the menu during composition", async () => {
    const { dom, props } = await mount({
      content: document(paragraph("/table")),
    });
    await screen.findByRole("option", { name: "Spreadsheet" });
    fireEvent.keyDown(dom, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(props.onInsertBlock).not.toHaveBeenCalled();
    fireEvent.compositionStart(dom);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(dom, { key: "Enter", isComposing: true });
    expect(props.onInsertBlock).not.toHaveBeenCalled();
    fireEvent.compositionEnd(dom);
  });
  it("reports a rejected insertion without erasing the slash or trailing text", async () => {
    const { dom } = await mount(
      {
        content: document(paragraph("/table tail")),
        onInsertBlock: vi.fn(async () => {
          throw Error("No access");
        }),
      },
      7,
    );
    await screen.findByRole("option", { name: "Spreadsheet" });
    fireEvent.keyDown(dom, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your text is unchanged",
    );
    expect(dom).toHaveTextContent("/table tail");
  });
});
