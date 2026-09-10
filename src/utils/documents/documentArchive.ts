import type {
  DatabaseDocuments,
  DocumentReference,
  DocumentRichTextNode,
} from "../../types/documents/document";
import {
  encryptWithPassword,
  decryptWithPassword,
  isWebCryptoPayload,
} from "../crypto/webCryptoAes";
import { generateId } from "../core/id";
import { normalizeDatabaseDocuments } from "./validation";
import { verifyDocumentAttachments } from "./documentAttachments";

const LIMIT = 48 * 1024 * 1024;
const DATABASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export interface DocumentArchive {
  format: "sorng-documents";
  version: 1;
  databaseId: string;
  data: DatabaseDocuments;
}

export async function exportDocumentArchive(
  data: DatabaseDocuments,
  databaseId: string,
  password: string,
): Promise<string> {
  if (!DATABASE_ID.test(databaseId))
    throw new Error("Choose a valid owning database.");
  if (password.length < 12)
    throw new Error("Use at least 12 characters for the archive password.");
  const normalized = normalizeDatabaseDocuments(data);
  await verifyDocumentAttachments(normalized);
  const payload = JSON.stringify({
    format: "sorng-documents",
    version: 1,
    databaseId,
    data: normalized,
  });
  if (new TextEncoder().encode(payload).length > LIMIT)
    throw new Error("The document archive exceeds the export size limit.");
  return encryptWithPassword(payload, password);
}

export async function importDocumentArchive(
  payload: string,
  password: string,
): Promise<DocumentArchive> {
  if (payload.length > LIMIT || !isWebCryptoPayload(payload))
    throw new Error(
      "Choose an encrypted sortOfRemoteNG document archive (up to 48 MB).",
    );
  const raw = JSON.parse(await decryptWithPassword(payload, password));
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (key) => !["format", "version", "databaseId", "data"].includes(key),
    ) ||
    raw.format !== "sorng-documents" ||
    raw.version !== 1 ||
    !Object.prototype.hasOwnProperty.call(raw, "data") ||
    raw.data === null ||
    typeof raw.databaseId !== "string" ||
    !DATABASE_ID.test(raw.databaseId)
  ) {
    throw new Error("This is not a supported document archive.");
  }
  const data = normalizeDatabaseDocuments(raw.data);
  await verifyDocumentAttachments(data);
  return {
    format: "sorng-documents",
    version: 1,
    databaseId: raw.databaseId,
    data,
  };
}

/** Append as new records. Never replace existing IDs or rebind foreign connections. */
export function appendDocumentArchive(
  current: DatabaseDocuments,
  archive: DocumentArchive,
  databaseId: string,
  parentFolderId: string | null,
): DatabaseDocuments {
  const imported = normalizeDatabaseDocuments(archive.data);
  const mappings = {
    document: new Map(
      imported.documents.map((entry) => [entry.id, generateId()]),
    ),
    person: new Map(imported.people.map((entry) => [entry.id, generateId()])),
    ticket: new Map(imported.tickets.map((entry) => [entry.id, generateId()])),
    attachment: new Map(
      imported.attachments.map((entry) => [entry.id, generateId()]),
    ),
  };
  const ref = (value: DocumentReference): DocumentReference => {
    if (value.databaseId !== archive.databaseId || value.kind === "connection")
      return value;
    const id = mappings[value.kind === "cell" ? "document" : value.kind].get(
      value.id,
    );
    return id ? { ...value, databaseId, id } : value;
  };
  const rich = (node: DocumentRichTextNode): DocumentRichTextNode => ({
    ...node,
    ...(node.reference ? { reference: ref(node.reference) } : {}),
    ...(node.content ? { content: node.content.map(rich) } : {}),
  });
  for (const doc of imported.documents) {
    doc.id = mappings.document.get(doc.id)!;
    doc.parentFolderId = parentFolderId;
    for (const block of doc.blocks) {
      if (block.type === "rich-text") block.content = rich(block.content);
      if (block.type === "reference") block.reference = ref(block.reference);
      if (block.type === "attachment")
        block.attachmentId = mappings.attachment.get(block.attachmentId)!;
      if (block.type === "identity")
        block.attachmentIds = block.attachmentIds.map((id) =>
          mappings.attachment.get(id)!,
        );
      if (block.type === "spreadsheet")
        for (const sheet of block.workbook.sheets)
          for (const cell of Object.values(sheet.cells))
            if (cell.reference) cell.reference = ref(cell.reference);
    }
  }
  for (const item of imported.attachments)
    item.id = mappings.attachment.get(item.id)!;
  for (const item of imported.people) {
    item.id = mappings.person.get(item.id)!;
    item.references = item.references.map(ref);
  }
  for (const item of imported.tickets) {
    item.id = mappings.ticket.get(item.id)!;
    item.references = item.references.map(ref);
  }
  return normalizeDatabaseDocuments({
    ...current,
    documents: [...current.documents, ...imported.documents],
    attachments: [...current.attachments, ...imported.attachments],
    people: [...current.people, ...imported.people],
    tickets: [...current.tickets, ...imported.tickets],
  });
}
