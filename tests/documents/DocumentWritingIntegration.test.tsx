import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import DocumentBlockEditor from "../../src/components/documents/DocumentBlockEditor";
import type {
  DocumentBlock,
  DocumentRichTextNode,
} from "../../src/types/documents/document";
import { fixture } from "./fixtures";

// Match RichTextWriting's geometry shim; both composing editors remain real.
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

const paragraph = (text: string): DocumentRichTextNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: DocumentRichTextNode[]): DocumentRichTextNode => ({
  type: "doc",
  content,
});
function Harness({
  initial = [],
  onChange = () => {},
}: {
  initial?: DocumentBlock[];
  onChange?: (blocks: DocumentBlock[]) => void;
}) {
  const [blocks, setBlocks] = useState(initial);
  return (
    <>
      <DocumentBlockEditor
        documentKey="integration:document"
        blocks={blocks}
        attachments={[]}
        onChange={(next) => {
          onChange(next);
          setBlocks(next);
          return true;
        }}
        renderSpreadsheet={(block) => (
          <div role="grid" aria-label={`Spreadsheet ${block.id}`}>
            {block.workbook.sheets[0].name}
          </div>
        )}
      />
      <output data-testid="document-draft">{JSON.stringify(blocks)}</output>
    </>
  );
}
const draft = () =>
  JSON.parse(
    screen.getByTestId("document-draft").textContent!,
  ) as DocumentBlock[];
const engine = (dom: HTMLElement) =>
  (dom as HTMLElement & { editor: Editor }).editor;
async function focus(dom: HTMLElement, position: number | "end" = "end") {
  const editor = engine(dom);
  await act(async () => {
    editor.commands.focus(position);
  });
  await waitFor(() => expect(editor.isFocused).toBe(true));
  return editor;
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
const richText = () =>
  draft()
    .filter((block) => block.type === "rich-text")
    .map((block) => JSON.stringify(block.content))
    .join("\n");

describe("real document writing integration", () => {
  it.each([
    ["Note", "note"],
    ["Spreadsheet", "spreadsheet"],
  ] as const)(
    "materializes the blank writer once, inserts %s, and continues in its stable source ID",
    async (label, kind) => {
      const change = vi.fn();
      render(<Harness onChange={change} />);
      const blank = await screen.findByRole("textbox", {
        name: "Rich document text",
      });
      const writer = await focus(blank);
      expect(draft()).toEqual([]);
      expect(change).not.toHaveBeenCalled();
      await type(writer, "/");
      expect(draft()).toHaveLength(1);
      const sourceId = draft()[0].id;
      const materialized = screen.getByRole("textbox", {
        name: "Rich document text",
      });
      expect(materialized).toBe(blank);
      expect(engine(materialized)).toBe(writer);
      expect(materialized).toHaveFocus();
      const menu = await screen.findByRole("listbox", {
        name: "Insert document block",
      });
      expect(within(menu).getByRole("option", { name: "Note" })).toBeVisible();
      expect(
        within(menu).getByRole("option", { name: "Spreadsheet" }),
      ).toBeVisible();
      fireEvent.click(within(menu).getByRole("option", { name: label }));
      await waitFor(() =>
        expect(draft().map((block) => block.type)).toEqual([kind, "rich-text"]),
      );
      const inserted = structuredClone(draft()[0]);
      expect(draft()[1].id).toBe(sourceId);
      expect(richText()).not.toContain('"/"');
      if (kind === "spreadsheet") {
        expect(
          screen.getByRole("grid", { name: `Spreadsheet ${inserted.id}` }),
        ).toBeVisible();
        expect(inserted).toMatchObject({
          workbook: {
            version: 1,
            sheets: [{ rows: 100, columns: 26, cells: {} }],
            styles: {},
            validations: {},
          },
        });
      } else expect(screen.getByLabelText("Note")).toHaveValue("");
      const continuation = await screen.findByRole("textbox", {
        name: "Rich document text",
      });
      await waitFor(() => expect(continuation).toHaveFocus());
      const continuationEditor = engine(continuation);
      await type(continuationEditor, "More text");
      expect(draft()).toHaveLength(2);
      expect(draft().map((block) => block.id)).toEqual([inserted.id, sourceId]);
      expect(draft()[0]).toEqual(inserted);
      expect(draft()[1]).toMatchObject({
        content: doc(paragraph("More text")),
      });
      expect(
        engine(screen.getByRole("textbox", { name: "Rich document text" })),
      ).toBe(continuationEditor);
    },
  );

  it("preserves both sides of a real caret split and prevents native undo from duplicating the transferred suffix", async () => {
    const before = paragraph("Before");
    const suffix: DocumentRichTextNode = {
      type: "paragraph",
      content: [
        { type: "text", text: "Suffix", marks: [{ type: "bold" }] },
        {
          type: "reference",
          reference: {
            databaseId: "db-a",
            kind: "cell",
            id: "doc",
            blockId: "sheet",
            sheetId: "main",
            address: "B3",
          },
        },
      ],
    };
    const trailing = paragraph("After");
    const source: DocumentBlock = {
      id: "source",
      type: "rich-text",
      content: doc(before, suffix, trailing),
    };
    const workbook = fixture().documents[0].blocks[2];
    render(<Harness initial={[source, workbook]} />);
    const original = await within(
      screen.getByRole("region", { name: "Rich text block 1" }),
    ).findByRole("textbox", { name: "Rich document text" });
    const originalEditor = await focus(original, "Before".length + 2 + 1);
    await type(originalEditor, "/note");
    fireEvent.click(await screen.findByRole("option", { name: "Note" }));
    await waitFor(() =>
      expect(draft().map((block) => block.type)).toEqual([
        "rich-text",
        "note",
        "rich-text",
        "spreadsheet",
      ]),
    );
    expect(draft()[0]).toEqual({ ...source, content: doc(before) });
    expect(draft()[2]).toMatchObject({
      type: "rich-text",
      content: doc(suffix, trailing),
    });
    expect(draft()[2].id).not.toBe(source.id);
    expect(draft()[3]).toEqual(workbook);
    const split = structuredClone(draft());
    const left = await within(
      screen.getByRole("region", { name: "Rich text block 1" }),
    ).findByRole("textbox", { name: "Rich document text" });
    const right = await within(
      screen.getByRole("region", { name: "Rich text block 3" }),
    ).findByRole("textbox", { name: "Rich document text" });
    await waitFor(() => expect(right).toHaveFocus());
    // A transferred fragment must not remain in either editor's native history.
    for (const surface of [left, right]) {
      await focus(surface);
      fireEvent.keyDown(surface, { key: "z", ctrlKey: true });
      expect(draft()).toEqual(split);
    }
    // Both real editors still support undo for typing after the structural edit.
    for (const surface of [left, right]) {
      const current = await focus(surface);
      await type(current, " Added");
      expect(surface).toHaveTextContent("Added");
      expect(draft().map((block) => block.id)).toEqual(
        split.map((block) => block.id),
      );
      fireEvent.keyDown(surface, { key: "z", ctrlKey: true });
      await waitFor(() => expect(surface).not.toHaveTextContent("Added"));
      expect(draft()).toEqual(split);
    }
    expect(richText().match(/Suffix/g) ?? []).toHaveLength(1);
    expect(richText()).not.toContain("/note");
    expect(draft()[3]).toEqual(workbook);
  });
});
