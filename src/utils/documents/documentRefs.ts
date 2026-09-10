import type {
  DatabaseDocuments,
  DocumentReference,
  DocumentRichTextNode,
} from "../../types/documents/document";
import { normalizeDatabaseDocuments } from "./validation";

/** Only whole-database copies remap their own references; foreign owners stay foreign. */
export function rebindDatabaseDocuments(
  value: unknown,
  sourceDatabaseId: string,
  destinationDatabaseId: string,
): DatabaseDocuments {
  const data = normalizeDatabaseDocuments(value);
  const ref = (value: DocumentReference): DocumentReference =>
    value.databaseId === sourceDatabaseId
      ? { ...value, databaseId: destinationDatabaseId }
      : value;
  const rich = (node: DocumentRichTextNode): DocumentRichTextNode => ({
    ...node,
    ...(node.reference ? { reference: ref(node.reference) } : {}),
    ...(node.content ? { content: node.content.map(rich) } : {}),
  });
  for (const doc of data.documents)
    for (const block of doc.blocks) {
      if (block.type === "reference") block.reference = ref(block.reference);
      if (block.type === "rich-text") block.content = rich(block.content);
      if (block.type === "spreadsheet")
        for (const sheet of block.workbook.sheets)
          for (const cell of Object.values(sheet.cells))
            if (cell.reference) cell.reference = ref(cell.reference);
    }
  for (const entry of [...data.people, ...data.tickets])
    entry.references = entry.references.map(ref);
  return data;
}
