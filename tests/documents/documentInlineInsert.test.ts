import { describe, expect, it } from "vitest";
import type {
  DocumentBlock,
  DocumentRichTextNode,
} from "../../src/types/documents/document";
import {
  emptyWritingContent,
  hasWritingContent,
  insertRichTextBlock,
  validateRichTextBlockInsertion,
  type RichTextBlockInsertion,
} from "../../src/utils/documents/documentInlineInsert";
import { fixture } from "./fixtures";

const paragraph = (text: string): DocumentRichTextNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: DocumentRichTextNode[]): DocumentRichTextNode => ({
  type: "doc",
  content,
});
const before = doc({
  type: "heading",
  level: 2,
  content: [{ type: "text", text: "Before", marks: [{ type: "bold" }] }],
});
const after = doc({
  type: "paragraph",
  content: [
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
});
const insertion = (): RichTextBlockInsertion => ({
  type: "note",
  original: doc(...before.content!, paragraph("/note"), ...after.content!),
  before,
  after,
});
const source = (request = insertion()): DocumentBlock => ({
  id: "source",
  type: "rich-text",
  content: request.original,
});
const inserted: DocumentBlock = { id: "new-note", type: "note", text: "" };

describe("inline document insertion", () => {
  it("splits portable text without changing unrelated workbook, attachment or Markdown data", () => {
    const request = insertion();
    const sheet = fixture().documents[0].blocks[2];
    const attachment: DocumentBlock = {
      id: "file",
      type: "attachment",
      attachmentId: "bytes",
      caption: "Keep me",
    };
    const markdown: DocumentBlock = {
      id: "md",
      type: "markdown",
      text: "# Keep source\n\n```text\n/raw\n```",
    };
    const blocks = [sheet, source(request), attachment, markdown];
    const snapshot = structuredClone(blocks);
    const result = insertRichTextBlock(blocks, "source", request, inserted);
    expect(result.blocks.map((block) => block.type)).toEqual([
      "spreadsheet",
      "rich-text",
      "note",
      "rich-text",
      "attachment",
      "markdown",
    ]);
    expect(result.blocks[1]).toEqual({
      id: "source",
      type: "rich-text",
      content: before,
    });
    expect(result.blocks[3]).toEqual({
      id: result.continuationId,
      type: "rich-text",
      content: after,
    });
    expect(result.continuationId).not.toBe("source");
    expect(result.blocks[0]).toBe(sheet);
    expect(result.blocks[4]).toBe(attachment);
    expect(result.blocks[5]).toBe(markdown);
    expect(blocks).toEqual(snapshot);
    expect(new Set(result.blocks.map((block) => block.id)).size).toBe(
      result.blocks.length,
    );
  });

  it("retains marked text and typed references to the right of a slash caret", () => {
    const prefix: DocumentRichTextNode = {
      type: "text",
      text: "/noteKeep",
      marks: [{ type: "italic" }],
    };
    const reference = after.content![0].content![0];
    const request: RichTextBlockInsertion = {
      type: "note",
      original: doc(
        ...before.content!,
        { type: "paragraph", content: [prefix, reference] },
        paragraph("Later"),
      ),
      before,
      after: doc(
        {
          type: "paragraph",
          content: [{ ...prefix, text: "Keep" }, reference],
        },
        paragraph("Later"),
      ),
    };
    const result = insertRichTextBlock(
      [source(request)],
      "source",
      request,
      inserted,
    );
    expect(result.blocks[2]).toMatchObject({ content: request.after });
  });

  it.each(["before", "after", "neither"] as const)(
    "keeps the originating ID with %s text and avoids a new empty tail record",
    (part) => {
      const request: RichTextBlockInsertion = {
        type: "note",
        before: part === "before" ? before : null,
        after: part === "after" ? after : null,
        original: doc(
          ...(part === "before" ? before.content! : []),
          paragraph("/"),
          ...(part === "after" ? after.content! : []),
        ),
      };
      const result = insertRichTextBlock(
        [source(request)],
        "source",
        request,
        inserted,
      );
      expect(result.blocks).toHaveLength(2);
      expect(
        result.blocks.filter((block) => block.id === "source"),
      ).toHaveLength(1);
      expect(result.continuationId).toBe(part === "before" ? null : "source");
      if (part === "neither")
        expect(result.blocks[1]).toMatchObject({
          content: emptyWritingContent(),
        });
    },
  );

  it("rejects a missing or edited source while permitting changes to other blocks", () => {
    const request = insertion();
    expect(() => insertRichTextBlock([], "source", request, inserted)).toThrow(
      /writing changed/,
    );
    expect(() =>
      insertRichTextBlock(
        [
          {
            id: "source",
            type: "rich-text",
            content: doc(paragraph("New text")),
          },
        ],
        "source",
        request,
        inserted,
      ),
    ).toThrow(/writing changed/);
    const latest: DocumentBlock = {
      id: "other",
      type: "note",
      text: "Concurrent edit",
    };
    expect(
      insertRichTextBlock(
        [source(request), latest],
        "source",
        request,
        inserted,
      ).blocks.slice(-1)[0],
    ).toBe(latest);
  });

  it.each([
    "altered prefix",
    "dropped suffix",
    "nested command",
    "inline code",
    "ordinary text",
  ])("rejects unsafe split: %s", (scenario) => {
    const request = insertion();
    if (scenario === "altered prefix")
      request.before = doc(paragraph("Replaced"));
    if (scenario === "dropped suffix") request.after = null;
    if (scenario === "nested command")
      request.original.content![1] = {
        type: "blockquote",
        content: [paragraph("/note")],
      };
    if (scenario === "inline code")
      request.original.content![1] = {
        type: "paragraph",
        content: [{ type: "text", text: "/note", marks: [{ type: "code" }] }],
      };
    if (scenario === "ordinary text")
      request.original.content![1] = paragraph("Keep this text");
    expect(() =>
      insertRichTextBlock([source(request)], "source", request, inserted),
    ).toThrow(/new paragraph/);
  });

  it("checks the full split size and current creation policy", () => {
    const request = insertion();
    const blocks: DocumentBlock[] = [
      source(request),
      ...Array.from({ length: 253 }, (_, i): DocumentBlock => ({
        id: `note-${i}`,
        type: "note",
        text: "",
      })),
    ];
    expect(
      insertRichTextBlock(blocks, "source", request, inserted).blocks,
    ).toHaveLength(256);
    expect(() =>
      validateRichTextBlockInsertion(
        [...blocks, { id: "last", type: "note", text: "" }],
        "source",
        request,
      ),
    ).toThrow(/256/);
    expect(() =>
      validateRichTextBlockInsertion(blocks, "source", request, ["rich-text"]),
    ).toThrow(/disabled/);
    expect(() =>
      validateRichTextBlockInsertion(blocks, "source", request, ["note"]),
    ).toThrow(/disabled rich-text/);
  });

  it("rejects mismatched types and ID collisions", () => {
    const request = insertion();
    expect(() =>
      insertRichTextBlock([source(request)], "source", request, {
        id: "source",
        type: "note",
        text: "",
      }),
    ).toThrow(/existing block/);
    expect(() =>
      insertRichTextBlock([source(request)], "source", request, {
        id: "new",
        type: "markdown",
        text: "",
      }),
    ).toThrow(/existing block/);
  });

  it("does not mistake initial empty paragraph normalization for writing", () => {
    expect(hasWritingContent(emptyWritingContent())).toBe(false);
    expect(hasWritingContent(doc({ type: "paragraph", content: [] }))).toBe(
      false,
    );
    expect(hasWritingContent(doc(paragraph("Typed")))).toBe(true);
    expect(
      hasWritingContent(doc({ type: "paragraph" }, { type: "paragraph" })),
    ).toBe(true);
  });
});
