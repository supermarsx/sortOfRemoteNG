import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures";
import {
  normalizeDatabaseDocuments,
  validateDocumentFormula,
  DOCUMENT_LIMITS,
} from "../../src/utils/documents/validation";
import { documentMetadata } from "../../src/utils/documents/documentService";
import { rebindDatabaseDocuments } from "../../src/utils/documents/documentRefs";
import {
  createDocumentAttachment,
  verifyDocumentAttachments,
} from "../../src/utils/documents/documentAttachments";
describe("protected document data model", () => {
  it("roundtrips typed blocks, workbook formats and links without exposing bodies in metadata", () => {
    expect(normalizeDatabaseDocuments(fixture())).toEqual(fixture());
    expect(JSON.stringify(documentMetadata(fixture()))).not.toContain(
      "PRIVATE_FIXTURE",
    );
    expect(documentMetadata(fixture())[0].name).toBe("Inventory");
  });
  it("rebinds only copied owner refs and preserves foreign references", () => {
    const data = fixture();
    data.people.push({
      id: "person",
      name: "Fixture",
      email: "",
      phone: "",
      organization: "",
      notes: "",
      references: [{ databaseId: "foreign", kind: "document", id: "other" }],
    });
    const copied = rebindDatabaseDocuments(data, "db-a", "db-b");
    const sheet = copied.documents[0].blocks.find(
      (block) => block.type === "spreadsheet",
    )!;
    expect(sheet.workbook.sheets[0].cells.A1.reference?.databaseId).toBe(
      "db-b",
    );
    expect(copied.people[0].references[0].databaseId).toBe("foreign");
    expect(JSON.stringify(data)).toContain('"databaseId":"db-a"');
  });
  it.each([
    '=WEBSERVICE("https://example.com")',
    "=IMPORTXML(A1)",
    "=[book.xlsx]Sheet1!A1",
    "=cmd|run!A1",
    '=HYPERLINK("file:///secret")',
  ])("refuses external formula %s", (formula) =>
    expect(() => validateDocumentFormula(formula)).toThrow(),
  );
  it("refuses executable richtext attributes and javascript links", () => {
    const data = fixture();
    const block = data.documents[0].blocks.find(
      (block) => block.type === "rich-text",
    )!;
    Object.assign(block.content, { onload: "private-script" });
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/Invalid/);
    delete (block.content as unknown as Record<string, unknown>).onload;
    block.content.content = [
      {
        type: "text",
        text: "x",
        marks: [{ type: "link", href: "javascript:alert(1)" }],
      },
    ];
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/link/);
  });
  it("refuses duplicate IDs, malformed identities and oversized blocks without payload diagnostics", () => {
    const data = fixture();
    data.documents[0].blocks.push(data.documents[0].blocks[0]);
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/duplicate/);
    data.documents[0].blocks = [
      {
        id: "id",
        type: "identity",
        documentType: "passport",
        holderName: "Private",
        idNumber: "PRIVATE_ID",
        country: "GB",
        issueDate: "2026-02-31",
        expiryDate: "",
        attachmentIds: [],
      },
    ];
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/identity date/);
    data.documents[0].blocks = [
      { id: "big", type: "note", text: "x".repeat(128 * 1024 + 1) },
    ];
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/oversized/);
  });
  it("normalizes email accounts but never contacts their configured servers", () => {
    const data = fixture();
    data.documents[0].blocks = [
      {
        id: "email",
        type: "email-account",
        address: "user@example.com",
        username: "user",
        password: "PRIVATE",
        imapHost: "mail.example.com",
        imapPort: 993,
        tls: true,
      },
    ];
    expect(normalizeDatabaseDocuments(data)).toEqual(data);
    Object.assign(data.documents[0].blocks[0], {
      imapHost: "https://user:pass@example.com",
    });
    expect(() => normalizeDatabaseDocuments(data)).toThrow(/hostname/);
  });
  it("validates attachment size, signature and actual digest entirely locally", async () => {
    const data = fixture();
    const file = await createDocumentAttachment(
      new TextEncoder().encode("%PDF-1.7\nfixture"),
      "fixture.pdf",
      "application/pdf",
    );
    data.attachments = [file];
    data.documents[0].blocks.push({
      id: "pdf",
      type: "attachment",
      attachmentId: file.id,
      caption: "",
    });
    await verifyDocumentAttachments(normalizeDatabaseDocuments(data));
    data.attachments[0].sha256 = "0".repeat(64);
    await expect(verifyDocumentAttachments(data)).rejects.toThrow(
      /inconsistent/,
    );
    await expect(
      createDocumentAttachment(
        new Uint8Array(DOCUMENT_LIMITS.attachmentBytes + 1),
        "big.pdf",
        "application/pdf",
      ),
    ).rejects.toThrow(/oversized/);
    await expect(
      createDocumentAttachment(
        new TextEncoder().encode("<svg onload='x'/>"),
        "fake.png",
        "image/png",
      ),
    ).rejects.toThrow();
  });
});
