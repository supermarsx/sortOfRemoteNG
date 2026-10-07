import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentBlockEditor, {
  type DocumentBlockEditorProps,
} from "../../src/components/documents/DocumentBlockEditor";
import type { RichTextEditorProps } from "../../src/components/documents/RichTextEditor";
import type {
  DocumentAttachment,
  DocumentBlock,
  DocumentReference,
  DocumentRichTextNode,
} from "../../src/types/documents/document";
import type { RichTextBlockInsertion } from "../../src/utils/documents/documentInlineInsert";
import { fixture } from "./fixtures";

const mock = vi.hoisted(() => ({
  editors: new Map<string, RichTextEditorProps>(),
  change: vi.fn(),
}));
vi.mock("../../src/components/documents/RichTextEditor", () => ({
  default: (props: RichTextEditorProps) => {
    mock.editors.set(props.documentKey, props);
    return (
      <>
        {props.presentation !== "inline" && (
          <div role="toolbar" aria-label="Text formatting" />
        )}
        <textarea
          aria-label={`Writing ${props.documentKey}`}
          readOnly={props.readOnly}
          value={
            props.content.content
              ?.map((node) =>
                node.content?.map((item) => item.text ?? "").join(""),
              )
              .join("\n") ?? ""
          }
          onChange={(event) =>
            props.onChange({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: event.target.value
                    ? [{ type: "text", text: event.target.value }]
                    : [],
                },
              ],
            })
          }
        />
      </>
    );
  },
}));
vi.mock("../../src/components/documents/AttachmentPreview", () => ({
  default: () => <div>Attachment preview</div>,
}));

const paragraph = (text: string): DocumentRichTextNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: DocumentRichTextNode[]): DocumentRichTextNode => ({
  type: "doc",
  content,
});
const request = (
  type: DocumentBlock["type"] = "note",
): RichTextBlockInsertion => ({
  type,
  original: doc(paragraph("Before"), paragraph("/"), paragraph("After")),
  before: doc(paragraph("Before")),
  after: doc(paragraph("After")),
});
const source = (value = request()): DocumentBlock => ({
  id: "source",
  type: "rich-text",
  content: value.original,
});
const reference: DocumentReference = {
  databaseId: "db-a",
  kind: "cell",
  id: "doc",
  blockId: "sheet",
  sheetId: "main",
  address: "B3",
};
const attachment: DocumentAttachment = {
  id: "file-data",
  name: "fixture.txt",
  mimeType: "text/plain",
  size: 1,
  sha256: "a".repeat(64),
  dataBase64: "eA==",
};
function Harness({
  initial = [source()],
  ...props
}: Partial<DocumentBlockEditorProps> & { initial?: DocumentBlock[] }) {
  const [blocks, setBlocks] = React.useState(initial);
  return (
    <>
      <DocumentBlockEditor
        documentKey="owner:doc"
        attachments={[]}
        {...props}
        blocks={blocks}
        onChange={(next) => {
          mock.change(next);
          if (props.onChange?.(next) === false) return false;
          setBlocks(next);
          return true;
        }}
      />
      <output data-testid="saved-draft">{JSON.stringify(blocks)}</output>
    </>
  );
}
const blocks = () =>
  JSON.parse(screen.getByTestId("saved-draft").textContent!) as DocumentBlock[];
const editor = () =>
  [...mock.editors.entries()]
    .filter(([key]) => key.includes(":source:"))
    .slice(-1)[0][1];
const ready = async () =>
  screen.findByRole("textbox", { name: /Writing .*:source:/ });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mock.editors.clear();
  mock.change.mockReset();
});
afterEach(cleanup);

describe("document writing composition", () => {
  it("defaults to Write and changes views without mutating data or remounting spreadsheets", async () => {
    let mounts = 0;
    function Sheet() {
      React.useEffect(() => {
        mounts++;
      }, []);
      return <div role="grid" aria-label="Existing workbook" />;
    }
    const initial = [source(), fixture().documents[0].blocks[2]];
    render(<Harness initial={initial} renderSpreadsheet={() => <Sheet />} />);
    await ready();
    expect(screen.getByRole("button", { name: "Write" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("toolbar", { name: "Text formatting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove block 1" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Start a new paragraph with/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Blocks" }));
    expect(
      screen.getByRole("toolbar", { name: "Text formatting" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove block 1" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(mounts).toBe(1);
    expect(blocks()).toEqual(initial);
    expect(mock.change).not.toHaveBeenCalled();
  });

  it.each(["empty", "tail"])(
    "keeps the %s writing surface ephemeral until actual input",
    async (kind) => {
      const initial: DocumentBlock[] =
        kind === "empty"
          ? []
          : [{ id: "existing", type: "note", text: "Keep" }];
      render(<Harness initial={initial} />);
      const text = await screen.findByRole("textbox", { name: /Writing/ });
      expect(blocks()).toEqual(initial);
      expect(mock.change).not.toHaveBeenCalled();
      const rich = [...mock.editors.values()].slice(-1)[0];
      act(() => rich.onChange(doc({ type: "paragraph", content: [] })));
      expect(mock.change).not.toHaveBeenCalled();
      fireEvent.change(text, { target: { value: "Started writing" } });
      expect(blocks()).toHaveLength(initial.length + 1);
      expect(blocks().slice(0, initial.length)).toEqual(initial);
      expect(blocks().slice(-1)[0]).toMatchObject({
        type: "rich-text",
        content: doc(paragraph("Started writing")),
      });
      expect(mock.change).toHaveBeenCalledOnce();
      expect(
        await screen.findByRole("textbox", { name: /Writing/ }),
      ).toHaveFocus();
      fireEvent.change(screen.getByRole("textbox", { name: /Writing/ }), {
        target: { value: "More writing" },
      });
      expect(blocks()).toHaveLength(initial.length + 1);
    },
  );

  it("accepts one split, preserves all existing structured blocks, and focuses continuation", async () => {
    const sheet = fixture().documents[0].blocks[2];
    const markdown: DocumentBlock = {
      id: "md",
      type: "markdown",
      text: "# Raw Markdown\n<script>literal</script>",
    };
    render(
      <Harness
        initial={[source(), sheet, markdown]}
        renderSpreadsheet={() => <div role="grid" />}
      />,
    );
    await ready();
    const key = editor().documentKey;
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await editor().onInsertBlock!(request());
    });
    expect(accepted).toBe(true);
    expect(mock.change).toHaveBeenCalledOnce();
    expect(blocks().map((block) => block.type)).toEqual([
      "rich-text",
      "note",
      "rich-text",
      "spreadsheet",
      "markdown",
    ]);
    expect(blocks()[0]).toEqual({
      id: "source",
      type: "rich-text",
      content: request().before,
    });
    expect(blocks().slice(3)).toEqual([sheet, markdown]);
    expect(editor().documentKey).not.toBe(key);
    const continuation = blocks()[2];
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", {
          name: `Writing owner:doc:${continuation.id}:0`,
        }),
      ).toHaveFocus(),
    );
  });

  it("adds no empty continuation record after inserting at the end of text", async () => {
    const value: RichTextBlockInsertion = {
      type: "note",
      original: doc(paragraph("Before"), paragraph("/")),
      before: doc(paragraph("Before")),
      after: null,
    };
    render(<Harness initial={[source(value)]} />);
    await ready();
    await act(async () => {
      expect(await editor().onInsertBlock!(value)).toBe(true);
    });
    expect(blocks()).toHaveLength(2);
    expect(blocks().map((block) => block.type)).toEqual(["rich-text", "note"]);
    const continuation = (
      await screen.findAllByRole("textbox", { name: /Writing/ })
    ).find(
      (element) => !element.getAttribute("aria-label")!.includes(":source:"),
    )!;
    expect(continuation).toHaveValue("");
    expect(continuation).toHaveFocus();
    expect(mock.change).toHaveBeenCalledOnce();
  });

  it("reports a refused workspace update without consuming source or resetting its editor", async () => {
    render(<Harness onChange={() => false} />);
    await ready();
    const key = editor().documentKey;
    await act(async () => {
      expect(await editor().onInsertBlock!(request())).toBe(false);
    });
    expect(blocks()).toEqual([source()]);
    expect(editor().documentKey).toBe(key);
  });

  it("preserves edits to other blocks while an asynchronous reference is selected", async () => {
    const pending = deferred<DocumentReference | null>();
    const validity = vi.fn();
    render(
      <Harness
        initial={[source(), { id: "other", type: "note", text: "Old" }]}
        onChooseReference={() => pending.promise}
        onValidityChange={validity}
      />,
    );
    await ready();
    let result!: boolean | Promise<boolean>;
    act(() => {
      result = editor().onInsertBlock!(request("reference"));
    });
    expect(validity).toHaveBeenLastCalledWith(false);
    expect(blocks()[0]).toEqual(source());
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Concurrent edit" },
    });
    await act(async () => {
      pending.resolve(reference);
      expect(await result).toBe(true);
    });
    expect(blocks().slice(-1)[0]).toEqual({
      id: "other",
      type: "note",
      text: "Concurrent edit",
    });
    expect(blocks()[1]).toMatchObject({ type: "reference", reference });
    expect(validity).toHaveBeenLastCalledWith(true);
  });

  it.each([
    "cancel",
    "source edit",
    "policy",
    "read-only",
    "owner",
    "child guard",
  ])(
    "retains slash/source when a reference insertion expires: %s",
    async (reason) => {
      const pending = deferred<DocumentReference | null>();
      const change = vi.fn();
      const props: DocumentBlockEditorProps = {
        documentKey: "owner:doc",
        blocks: [source()],
        attachments: [],
        onChange: change,
        onChooseReference: () => pending.promise,
      };
      const view = render(<DocumentBlockEditor {...props} />);
      await ready();
      let active = true;
      const value = { ...request("reference"), isCurrent: () => active };
      let result!: boolean | Promise<boolean>;
      act(() => {
        result = editor().onInsertBlock!(value);
      });
      if (reason === "source edit")
        view.rerender(
          <DocumentBlockEditor
            {...props}
            blocks={[
              {
                id: "source",
                type: "rich-text",
                content: doc(paragraph("Changed /")),
              },
            ]}
          />,
        );
      if (reason === "policy")
        view.rerender(
          <DocumentBlockEditor {...props} enabledTypes={["rich-text"]} />,
        );
      if (reason === "read-only") {
        view.rerender(<DocumentBlockEditor {...props} readOnly />);
        view.rerender(<DocumentBlockEditor {...props} />);
      }
      if (reason === "owner")
        view.rerender(
          <DocumentBlockEditor {...props} documentKey="other:doc" />,
        );
      if (reason === "child guard") active = false;
      await act(async () => {
        pending.resolve(reason === "cancel" ? null : reference);
        expect(await result).toBe(false);
      });
      expect(change).not.toHaveBeenCalled();
    },
  );

  it("handles native attachment cancellation without calling the attachment writer", async () => {
    const onAttach = vi.fn();
    render(<Harness onAttach={onAttach} />);
    await ready();
    let result!: boolean | Promise<boolean>;
    act(() => {
      result = editor().onInsertBlock!(request("attachment"));
    });
    fireEvent(
      screen.getByLabelText("Choose document attachment"),
      new Event("cancel", { bubbles: true }),
    );
    await act(async () => {
      expect(await result).toBe(false);
    });
    expect(onAttach).not.toHaveBeenCalled();
    expect(mock.change).not.toHaveBeenCalled();
    expect(blocks()).toEqual([source()]);
  });

  it("passes a live anchor guard to attachment preparation and applies only the real attachment ID", async () => {
    const pending = deferred<DocumentAttachment | null>();
    const onAttach = vi.fn(() => pending.promise);
    render(<Harness onAttach={onAttach} attachments={[attachment]} />);
    await ready();
    let result!: boolean | Promise<boolean>;
    act(() => {
      result = editor().onInsertBlock!(request("attachment"));
    });
    const file = new File(["x"], "fixture.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose document attachment"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(onAttach).toHaveBeenCalledWith(file, expect.any(Function)),
    );
    expect(mock.change).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(attachment);
      expect(await result).toBe(true);
    });
    expect(blocks()[1]).toMatchObject({
      type: "attachment",
      attachmentId: attachment.id,
    });
    expect(mock.change).toHaveBeenCalledOnce();
  });

  it("filters unavailable creation types and refuses an out-of-policy request", async () => {
    render(
      <Harness
        enabledTypes={[
          "rich-text",
          "note",
          "attachment",
          "reference",
          "spreadsheet",
        ]}
      />,
    );
    await ready();
    expect(editor().insertableBlocks).toEqual(["rich-text", "note"]);
    await act(async () => {
      expect(await editor().onInsertBlock!(request("secret"))).toBe(false);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/disabled/);
    expect(mock.change).not.toHaveBeenCalled();
  });

  const chooseBlockAttachment = () => {
    fireEvent.click(screen.getByRole("button", { name: "Blocks" }));
    fireEvent.click(screen.getByLabelText("Block type"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Add block" }));
    const file = new File(["x"], "fixture.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose document attachment"), {
      target: { files: [file] },
    });
    return file;
  };

  it.each(["document", "read-only", "unmount", "policy"] as const)(
    "guards Blocks attachment storage during a delayed read when access changes: %s",
    async (change) => {
      const reading = deferred<void>();
      const stored: DocumentAttachment[] = [];
      const onAttach = vi.fn(async (_file: File, isCurrent?: () => boolean) => {
        if (isCurrent && !isCurrent()) return null;
        await reading.promise;
        if (isCurrent && !isCurrent()) return null;
        stored.push(attachment);
        return attachment;
      });
      const onChange = vi.fn();
      const props: DocumentBlockEditorProps = {
        documentKey: "same-database:first-document",
        blocks: [{ id: "note", type: "note", text: "Preserved" }],
        attachments: [],
        onChange,
        onAttach,
      };
      const view = render(<DocumentBlockEditor {...props} />);
      const file = chooseBlockAttachment();
      expect(onAttach).toHaveBeenCalledExactlyOnceWith(
        file,
        expect.any(Function),
      );
      const isCurrent = onAttach.mock.calls[0][1]!;
      expect(isCurrent()).toBe(true);
      if (change === "document")
        view.rerender(
          <DocumentBlockEditor
            {...props}
            documentKey="same-database:second-document"
          />,
        );
      if (change === "read-only") {
        view.rerender(<DocumentBlockEditor {...props} readOnly />);
        view.rerender(<DocumentBlockEditor {...props} readOnly={false} />);
      }
      if (change === "unmount") view.unmount();
      if (change === "policy")
        view.rerender(
          <DocumentBlockEditor {...props} enabledTypes={["note"]} />,
        );
      expect(isCurrent()).toBe(false);
      await act(async () => {
        reading.resolve();
        await onAttach.mock.results[0].value;
      });
      expect(stored).toEqual([]);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("allows a current Blocks attachment through the guard and appends its real ID", async () => {
    const onAttach = vi.fn(async (_file: File, isCurrent?: () => boolean) => {
      expect(isCurrent?.()).toBe(true);
      return attachment;
    });
    const initial: DocumentBlock[] = [
      { id: "note", type: "note", text: "Preserved" },
    ];
    render(
      <Harness
        initial={initial}
        attachments={[attachment]}
        onAttach={onAttach}
      />,
    );
    const file = chooseBlockAttachment();
    await waitFor(() => expect(mock.change).toHaveBeenCalledOnce());
    expect(onAttach).toHaveBeenCalledExactlyOnceWith(
      file,
      expect.any(Function),
    );
    expect(blocks()).toHaveLength(2);
    expect(blocks()[0]).toEqual(initial[0]);
    expect(blocks()[1]).toMatchObject({
      type: "attachment",
      attachmentId: attachment.id,
    });
  });
});
