import type {
  DatabaseDocument,
  DocumentBlock,
  DocumentRichTextNode,
} from "../../types/documents/document";

function richText(node: DocumentRichTextNode): string {
  if (node.type === "text") return node.text ?? "";
  // Inline marks do not split words; structural nodes separate paragraphs.
  const separator = ["paragraph", "heading", "codeBlock"].includes(node.type)
    ? ""
    : "\n";
  return (node.content ?? []).map(richText).join(separator);
}

function* searchableText(block: DocumentBlock): Generator<string> {
  switch (block.type) {
    case "rich-text":
      yield richText(block.content);
      break;
    case "markdown":
    case "note":
    case "mermaid":
      yield block.text;
      break;
    case "secret":
    case "credential":
    case "email":
    case "reference":
      yield block.label;
      break;
    case "wifi":
      yield block.ssid;
      break;
    case "attachment":
      yield block.caption;
      break;
    case "spreadsheet":
      for (const sheet of block.workbook.sheets) {
        yield sheet.name;
        for (const cell of Object.values(sheet.cells)) {
          if (cell.value !== null) yield String(cell.value);
          if (cell.formula) yield cell.formula; // Text only; never evaluate formulas.
          if (cell.note) yield cell.note;
        }
      }
      break;
    // No private identity fields, account addresses, usernames or passwords.
    case "identity":
    case "email-account":
      break;
  }
}

/** Ephemeral, explicitly allowlisted search; never build an index or use redacted exports. */
export function documentMatchesSearch(
  document: DatabaseDocument,
  query: string,
  fullText = false,
): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  const matches = (value: string) => value.toLowerCase().includes(search);
  if (matches(document.name)) return true;
  if (!fullText) return false;
  for (const block of document.blocks)
    for (const text of searchableText(block)) if (matches(text)) return true;
  return false;
}
