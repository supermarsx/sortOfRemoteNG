import type { DocumentBlock } from "../../types/documents/document";
import { generateId } from "../core/id";

/** Empty, editable blocks only. Attachments and references need a real target. */
export function initialDocumentBlock(
  type: DocumentBlock["type"],
): DocumentBlock {
  const id = generateId();
  switch (type) {
    case "rich-text":
      return {
        id,
        type,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      };
    case "markdown":
    case "mermaid":
    case "note":
      return {
        id,
        type,
        text:
          type === "mermaid" ? "flowchart LR\n  A[Start] --> B[Finish]" : "",
      };
    case "wifi":
      return {
        id,
        type,
        ssid: "",
        password: "",
        authentication: "WPA",
        hidden: false,
      };
    case "secret":
      return { id, type, label: "Secret", value: "" };
    case "credential":
      return {
        id,
        type,
        label: "Credential",
        username: "",
        password: "",
        url: "",
        notes: "",
      };
    case "email-account":
      return { id, type, address: "", username: "", password: "", tls: true };
    case "identity":
      return {
        id,
        type,
        documentType: "",
        holderName: "",
        idNumber: "",
        country: "",
        issueDate: "",
        expiryDate: "",
        attachmentIds: [],
      };
    case "email":
      return { id, type, address: "", label: "" };
    case "spreadsheet":
      return {
        id,
        type,
        workbook: {
          version: 1,
          styles: {},
          validations: {},
          sheets: [
            {
              id: generateId(),
              name: "Sheet 1",
              rows: 100,
              columns: 26,
              cells: {},
              merges: [],
              rowMetadata: {},
              columnMetadata: {},
            },
          ],
        },
      };
    default:
      throw new Error("Select the target before creating this block.");
  }
}
