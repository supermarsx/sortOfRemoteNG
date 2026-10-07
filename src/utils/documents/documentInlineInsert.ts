import type {
  DocumentBlock,
  DocumentRichTextNode,
} from "../../types/documents/document";
import { generateId } from "../core/id";
import { DOCUMENT_LIMITS } from "./validation";

/** Portable text fragments around one top-level slash-command paragraph. */
export interface RichTextBlockInsertion {
  type: DocumentBlock["type"];
  original: DocumentRichTextNode;
  before: DocumentRichTextNode | null;
  after: DocumentRichTextNode | null;
  /** Optional live editor/caret guard; never stored in document data. */
  isCurrent?: () => boolean;
}

export const emptyWritingContent = (): DocumentRichTextNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

/** Ignore JSON object key order, but preserve array order and every field. */
function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, i) => sameData(item, right[i]))
    );
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length ===
      Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameData(a[key], b[key]))
  );
}

export function hasWritingContent(content: DocumentRichTextNode): boolean {
  return !(
    content.type === "doc" &&
    content.content?.length === 1 &&
    content.content[0].type === "paragraph" &&
    !content.content[0].content?.length
  );
}

function isSlashSplit(
  command: DocumentRichTextNode | undefined,
  following: DocumentRichTextNode[],
  after: DocumentRichTextNode[],
): boolean {
  if (command?.type !== "paragraph" || !command.content?.length) return false;
  const slash = (value: string) => /^\/[\p{L}\p{N} -]{0,64}$/u.test(value);
  if (sameData(after, following)) {
    return (
      command.content.every(
        (node) =>
          node.type === "text" &&
          !node.marks?.some((mark) => mark.type === "code"),
      ) && slash(command.content.map((node) => node.text ?? "").join(""))
    );
  }
  // The child may split the slash paragraph at the caret, retaining its suffix.
  if (
    after.length !== following.length + 1 ||
    !sameData(after.slice(1), following)
  )
    return false;
  const suffix = after[0];
  if (
    suffix.type !== "paragraph" ||
    !suffix.content?.length ||
    !sameData({ ...command, content: suffix.content }, suffix)
  )
    return false;
  const textLength = (nodes: DocumentRichTextNode[]) =>
    nodes.reduce((length, node) => length + (node.text?.length ?? 0), 0);
  let remaining = textLength(command.content) - textLength(suffix.content);
  if (remaining < 1) return false;
  let removed = "";
  const kept: DocumentRichTextNode[] = [];
  for (const node of command.content) {
    if (!remaining) {
      kept.push(node);
      continue;
    }
    if (
      node.type !== "text" ||
      node.marks?.some((mark) => mark.type === "code")
    )
      return false;
    const text = node.text ?? "";
    const count = Math.min(remaining, text.length);
    removed += text.slice(0, count);
    remaining -= count;
    if (count < text.length) kept.push({ ...node, text: text.slice(count) });
  }
  return remaining === 0 && slash(removed) && sameData(kept, suffix.content);
}

/** Rechecked both before opening a picker and immediately before applying it. */
export function validateRichTextBlockInsertion(
  blocks: readonly DocumentBlock[],
  sourceId: string,
  request: RichTextBlockInsertion,
  enabledTypes?: readonly DocumentBlock["type"][],
): void {
  const source = blocks.find((block) => block.id === sourceId);
  if (
    source?.type !== "rich-text" ||
    !sameData(source.content, request.original)
  )
    throw new Error(
      "The writing changed while choosing a block. Start a new insertion.",
    );
  if (enabledTypes && !enabledTypes.includes(request.type))
    throw new Error(
      "This block type is disabled for new content in this database.",
    );
  const original = request.original.content ?? [];
  const before = request.before?.content ?? [];
  const after = request.after?.content ?? [];
  const command = original[before.length];
  if (
    request.original.type !== "doc" ||
    (request.before && (request.before.type !== "doc" || !before.length)) ||
    (request.after && (request.after.type !== "doc" || !after.length)) ||
    !sameData(before, original.slice(0, before.length)) ||
    !isSlashSplit(command, original.slice(before.length + 1), after)
  )
    throw new Error("Start a new paragraph with / to insert a block.");
  if (
    request.before &&
    request.after &&
    enabledTypes &&
    !enabledTypes.includes("rich-text")
  )
    throw new Error(
      "Splitting this paragraph would create a disabled rich-text block.",
    );
  // Keep the originating ID even when the command was its only paragraph.
  const textBlocks = Math.max(
    1,
    Number(!!request.before) + Number(!!request.after),
  );
  if (blocks.length + textBlocks > DOCUMENT_LIMITS.blocksPerDocument)
    throw new Error(
      "A document can contain at most 256 blocks, including split text.",
    );
}

export function insertRichTextBlock(
  blocks: readonly DocumentBlock[],
  sourceId: string,
  request: RichTextBlockInsertion,
  inserted: DocumentBlock,
  enabledTypes?: readonly DocumentBlock["type"][],
): { blocks: DocumentBlock[]; continuationId: string | null } {
  validateRichTextBlockInsertion(blocks, sourceId, request, enabledTypes);
  if (
    inserted.type !== request.type ||
    blocks.some((block) => block.id === inserted.id)
  )
    throw new Error("The selected block cannot replace an existing block.");
  const index = blocks.findIndex((block) => block.id === sourceId);
  const replacement: DocumentBlock[] = [];
  if (request.before)
    replacement.push({
      id: sourceId,
      type: "rich-text",
      content: request.before,
    });
  replacement.push(inserted);
  let continuationId: string | null = null;
  if (request.after || !request.before) {
    continuationId = request.before ? generateId() : sourceId;
    replacement.push({
      id: continuationId,
      type: "rich-text",
      content: request.after ?? emptyWritingContent(),
    });
  }
  return {
    blocks: [
      ...blocks.slice(0, index),
      ...replacement,
      ...blocks.slice(index + 1),
    ],
    continuationId,
  };
}
