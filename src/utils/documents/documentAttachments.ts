import type {
  DatabaseDocuments,
  DocumentAttachment,
} from "../../types/documents/document";
import { generateId } from "../core/id";
import { DOCUMENT_LIMITS } from "./validation";
const fail = () =>
  new Error(
    "Unsupported, oversized or inconsistent document attachment. No file was saved.",
  );
const starts = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => bytes[index] === byte);
function verifyMime(bytes: Uint8Array, mime: DocumentAttachment["mimeType"]) {
  if (bytes.byteLength > DOCUMENT_LIMITS.attachmentBytes) throw fail();
  if (mime === "image/png" && !starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10]))
    throw fail();
  if (mime === "image/jpeg" && !starts(bytes, [255, 216, 255])) throw fail();
  if (
    mime === "image/webp" &&
    !(
      starts(bytes, [82, 73, 70, 70]) &&
      starts(bytes.subarray(8), [87, 69, 66, 80])
    )
  )
    throw fail();
  if (mime === "application/pdf" && !starts(bytes, [37, 80, 68, 70, 45]))
    throw fail();
  if (mime === "text/plain" || mime === "text/markdown") {
    try {
      if (
        new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0")
      )
        throw fail();
    } catch {
      throw fail();
    }
  }
}
const hash = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export function decodeDocumentAttachment(
  attachment: DocumentAttachment,
): Uint8Array {
  if (
    attachment.size > DOCUMENT_LIMITS.attachmentBytes ||
    attachment.dataBase64.length >
      Math.ceil(DOCUMENT_LIMITS.attachmentBytes / 3) * 4
  )
    throw fail();
  let binary: string;
  try {
    binary = atob(attachment.dataBase64);
  } catch {
    throw fail();
  }
  if (binary.length !== attachment.size) throw fail();
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
export async function createDocumentAttachment(
  bytes: Uint8Array,
  name: string,
  mimeType: DocumentAttachment["mimeType"],
): Promise<DocumentAttachment> {
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/markdown",
    ].includes(mimeType) ||
    !name.trim() ||
    name.length > 256 ||
    /[\0\\/]/.test(name)
  )
    throw fail();
  const captured = new Uint8Array(bytes);
  verifyMime(captured, mimeType);
  let binary = "";
  for (let offset = 0; offset < captured.length; offset += 8192)
    binary += String.fromCharCode(...captured.subarray(offset, offset + 8192));
  return {
    id: generateId(),
    name,
    mimeType,
    size: captured.byteLength,
    sha256: await hash(captured),
    dataBase64: btoa(binary),
  };
}
/** Hashes only new/changed attachments when a verified previous snapshot exists. */
export async function verifyDocumentAttachments(
  data: DatabaseDocuments,
  previous?: DatabaseDocuments,
): Promise<void> {
  for (const item of data.attachments) {
    const old = previous?.attachments.find((entry) => entry.id === item.id);
    if (
      old &&
      old.sha256 === item.sha256 &&
      old.dataBase64 === item.dataBase64 &&
      old.mimeType === item.mimeType &&
      old.size === item.size
    )
      continue;
    const bytes = decodeDocumentAttachment(item);
    verifyMime(bytes, item.mimeType);
    if ((await hash(bytes)) !== item.sha256) throw fail();
  }
}
