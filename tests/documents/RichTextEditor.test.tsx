import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import RichTextEditor from "../../src/components/documents/RichTextEditor";
import {
  fromEditorContent,
  toEditorContent,
  safeDocumentLink,
} from "../../src/components/documents/richTextAdapter";
import type { DocumentRichTextNode } from "../../src/types/documents/document";
const content: DocumentRichTextNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Fixture",
          marks: [
            { type: "bold" },
            { type: "link", href: "https://example.test" },
          ],
        },
      ],
    },
    { type: "heading", level: 2, content: [{ type: "text", text: "Heading" }] },
    {
      type: "paragraph",
      content: [
        {
          type: "reference",
          reference: { databaseId: "db", kind: "document", id: "other" },
        },
      ],
    },
  ],
};
const rangeRects = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getClientRects",
);
const rangeBox = Object.getOwnPropertyDescriptor(
  Range.prototype,
  "getBoundingClientRect",
);
beforeAll(() => {
  // jsdom lacks layout; editor transactions still run against the real engine.
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
afterAll(() => {
  if (rangeRects)
    Object.defineProperty(Range.prototype, "getClientRects", rangeRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  if (rangeBox)
    Object.defineProperty(Range.prototype, "getBoundingClientRect", rangeBox);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
describe("portable rich text adapter", () => {
  it("roundtrips allowed marks, headings and typed references without editor attributes", () => {
    const editor = toEditorContent(content);
    expect(fromEditorContent(editor)).toEqual(content);
    expect(JSON.stringify(editor)).not.toContain("onclick");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///secret",
    "https://user:pass@example.test",
  ])("refuses unsafe URL %s", (url) => {
    expect(safeDocumentLink(url)).toBe(false);
    expect(() =>
      fromEditorContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "bad",
                marks: [{ type: "link", attrs: { href: url } }],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it("does not convert arbitrary HTML nodes or event attributes into data", () => {
    expect(() =>
      fromEditorContent({
        type: "doc",
        content: [{ type: "image", attrs: { src: "https://evil.test" } }],
      }),
    ).toThrow();
    expect(
      fromEditorContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { onclick: "bad", style: "url(https://evil.test)" },
            content: [{ type: "text", text: "safe" }],
          },
        ],
      }),
    ).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "safe" }] },
      ],
    });
  });
});
describe("real rich text editor", () => {
  it("applies a real heading transaction and supports undo/redo", async () => {
    const change = vi.fn();
    render(
      <RichTextEditor
        content={{
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Title" }] },
          ],
        }}
        onChange={change}
        documentKey="format"
      />,
    );
    await screen.findByRole("textbox", { name: "Rich document text" });
    fireEvent.click(screen.getByRole("button", { name: "Heading 1" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Title", level: 1 }),
      ).toBeInTheDocument(),
    );
    expect(change.mock.calls.slice(-1)[0][0].content[0]).toMatchObject({
      type: "heading",
      level: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Title" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Title", level: 1 }),
      ).toBeInTheDocument(),
    );
  });
  it("mounts the real editor and uses the exact typed reference callback", async () => {
    const open = vi.fn();
    const { unmount } = render(
      <RichTextEditor
        content={content}
        onChange={vi.fn()}
        documentKey="one"
        onReference={open}
      />,
    );
    await screen.findByRole("textbox", { name: "Rich document text" });
    expect(
      screen.getByRole("heading", { name: "Heading" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open document reference" }),
    );
    expect(open).toHaveBeenCalledWith({
      databaseId: "db",
      kind: "document",
      id: "other",
    });
    unmount();
  });
  it("pastes only plain text, preserves the model and exposes formatting commands", async () => {
    const change = vi.fn();
    render(
      <RichTextEditor
        content={{ type: "doc", content: [{ type: "paragraph" }] }}
        onChange={change}
        documentKey="paste"
      />,
    );
    const editor = await screen.findByRole("textbox", {
      name: "Rich document text",
    });
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain"
            ? "Plain fixture"
            : '<img src="https://evil.test">',
      },
    });
    await waitFor(() => expect(change).toHaveBeenCalled());
    expect(JSON.stringify(change.mock.calls.slice(-1)[0]?.[0])).toContain(
      "Plain fixture",
    );
    expect(editor.querySelector("img")).toBeNull();
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Heading 1",
      "Bullet list",
      "Numbered list",
      "Code block",
      "Undo",
      "Redo",
    ])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });
  it("switching document key destroys the old editor history and content", async () => {
    const { rerender } = render(
      <RichTextEditor content={content} onChange={vi.fn()} documentKey="one" />,
    );
    await screen.findByRole("textbox", { name: "Rich document text" });
    rerender(
      <RichTextEditor
        content={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "New document" }],
            },
          ],
        }}
        onChange={vi.fn()}
        documentKey="two"
        readOnly
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveTextContent("New document"),
    );
    expect(screen.getByRole("textbox")).not.toHaveTextContent("Fixture");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });
});
