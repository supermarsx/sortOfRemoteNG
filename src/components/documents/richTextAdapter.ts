import type { JSONContent } from "@tiptap/core";
import type {
  DocumentRichTextNode,
  DocumentTextMark,
} from "../../types/documents/document";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../../utils/documents/validation";

export function safeDocumentLink(value: string): boolean {
  if (value.length > 2048 || /[\r\n\0]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function validateRichText(content: DocumentRichTextNode): void {
  normalizeDatabaseDocuments({
    ...emptyDatabaseDocuments(),
    documents: [
      {
        id: "validation",
        parentFolderId: null,
        name: "Draft",
        icon: "document",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        blocks: [{ id: "rich", type: "rich-text", content }],
      },
    ],
  });
  if (content.type !== "doc")
    throw new Error("Rich text must have a document root.");
  const inline = new Set(["text", "hardBreak", "reference"]);
  const blocks = new Set([
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "blockquote",
    "codeBlock",
    "horizontalRule",
  ]);
  const check = (node: DocumentRichTextNode) => {
    const children = node.content ?? [];
    const reject = () => {
      throw new Error("Unsupported rich text structure.");
    };
    if (node.marks?.length && !inline.has(node.type)) reject();
    if (["doc", "blockquote", "listItem"].includes(node.type)) {
      if (!children.length || children.some((child) => !blocks.has(child.type)))
        reject();
      if (node.type === "listItem" && children[0].type !== "paragraph")
        reject();
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      if (
        !children.length ||
        children.some((child) => child.type !== "listItem")
      )
        reject();
    } else if (node.type === "paragraph" || node.type === "heading") {
      if (children.some((child) => !inline.has(child.type))) reject();
    } else if (node.type === "codeBlock") {
      if (
        children.some((child) => child.type !== "text" || !!child.marks?.length)
      )
        reject();
    } else if (children.length) reject();
    if (node.type === "text" && !node.text) reject();
    children.forEach(check);
  };
  check(content);
}
export function toEditorContent(content: DocumentRichTextNode): JSONContent {
  validateRichText(content);
  const map = (node: DocumentRichTextNode): JSONContent => ({
    type: node.type,
    ...(node.text === undefined ? {} : { text: node.text }),
    ...(node.type === "heading" ? { attrs: { level: node.level ?? 1 } } : {}),
    ...(node.type === "reference"
      ? { attrs: { reference: node.reference } }
      : {}),
    ...(node.content ? { content: node.content.map(map) } : {}),
    ...(node.marks
      ? {
          marks: node.marks.map((mark) => ({
            type: mark.type,
            ...(mark.type === "link" ? { attrs: { href: mark.href } } : {}),
          })),
        }
      : {}),
  });
  return map(content);
}
/** Rebuild only the portable AST: editor attributes/HTML cannot become stored data. */
export function fromEditorContent(content: JSONContent): DocumentRichTextNode {
  let count = 0;
  const map = (node: JSONContent, depth = 0): DocumentRichTextNode => {
    if (depth > 32 || ++count > 20000)
      throw new Error("Rich text is too large.");
    const type = node.type as DocumentRichTextNode["type"];
    if (
      ![
        "doc",
        "paragraph",
        "heading",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "hardBreak",
        "horizontalRule",
        "reference",
      ].includes(type)
    )
      throw new Error("Unsupported rich text element.");
    const marks = node.marks?.map((mark): DocumentTextMark => {
      if (
        !["bold", "italic", "underline", "strike", "code", "link"].includes(
          mark.type,
        )
      )
        throw new Error("Unsupported text formatting.");
      if (
        mark.type === "link" &&
        (typeof mark.attrs?.href !== "string" ||
          !safeDocumentLink(mark.attrs.href))
      )
        throw new Error("Only HTTP, HTTPS and email links are allowed.");
      return {
        type: mark.type as DocumentTextMark["type"],
        ...(mark.type === "link" ? { href: mark.attrs!.href as string } : {}),
      };
    });
    return {
      type,
      ...(node.text === undefined ? {} : { text: node.text }),
      ...(marks?.length ? { marks } : {}),
      ...(node.content
        ? { content: node.content.map((child) => map(child, depth + 1)) }
        : {}),
      ...(type === "heading"
        ? { level: node.attrs?.level as DocumentRichTextNode["level"] }
        : {}),
      ...(type === "reference" ? { reference: node.attrs?.reference } : {}),
    };
  };
  const result = map(content);
  validateRichText(result);
  return result;
}
