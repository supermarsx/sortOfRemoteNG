import { describe, expect, it } from "vitest";
import type {
  DatabaseDocuments,
  DocumentReference,
} from "../../src/types/documents/document";
import {
  appendDocumentArchive,
  exportDocumentArchive,
  importDocumentArchive,
  type DocumentArchive,
} from "../../src/utils/documents/documentArchive";
import { createDocumentAttachment } from "../../src/utils/documents/documentAttachments";
import { encryptWithPassword } from "../../src/utils/crypto/webCryptoAes";
import { fixture } from "./fixtures";

const password = "synthetic-archive-password";
const sourceDatabase = "db-a";
const destinationDatabase = "db-destination";
const archive = (data = fixture()): DocumentArchive => ({
  format: "sorng-documents",
  version: 1,
  databaseId: sourceDatabase,
  data,
});
const encryptFixture = (value: unknown) =>
  encryptWithPassword(JSON.stringify(value), password, { iterations: 10000 });

async function linkedFixture(): Promise<DatabaseDocuments> {
  const data = fixture();
  const attachment = await createDocumentAttachment(
    new TextEncoder().encode("PRIVATE_ATTACHMENT_FIXTURE"),
    "fixture.txt",
    "text/plain",
  );
  attachment.id = "attachment";
  data.attachments.push(attachment);
  const refs: DocumentReference[] = [
    { databaseId: sourceDatabase, kind: "document", id: "doc" },
    { databaseId: sourceDatabase, kind: "person", id: "person" },
    { databaseId: sourceDatabase, kind: "ticket", id: "ticket" },
    {
      databaseId: sourceDatabase,
      kind: "cell",
      id: "doc",
      blockId: "sheet",
      sheetId: "main",
      address: "B3",
    },
    { databaseId: sourceDatabase, kind: "connection", id: "host" },
    { databaseId: "foreign", kind: "connection", id: "host" },
    { databaseId: "foreign", kind: "document", id: "doc" },
    { databaseId: sourceDatabase, kind: "document", id: "not-in-archive" },
  ];
  data.people.push({
    id: "person",
    name: "Synthetic person",
    email: "",
    phone: "",
    organization: "",
    notes: "",
    references: structuredClone(refs),
  });
  data.tickets.push({
    id: "ticket",
    title: "Synthetic ticket",
    status: "open",
    priority: "normal",
    description: "",
    references: structuredClone(refs),
  });
  data.documents[0].blocks.push(
    ...refs.map((reference, index) => ({
      id: `reference-${index}`,
      type: "reference" as const,
      label: "Linked fixture",
      reference: structuredClone(reference),
    })),
    {
      id: "attachment-block",
      type: "attachment",
      attachmentId: attachment.id,
      caption: "",
    },
    {
      id: "identity-block",
      type: "identity",
      documentType: "passport",
      holderName: "Synthetic only",
      idNumber: "FIXTURE_ID",
      country: "GB",
      issueDate: "",
      expiryDate: "",
      attachmentIds: [attachment.id],
    },
  );
  const rich = data.documents[0].blocks.find(
    (block) => block.type === "rich-text",
  )!;
  rich.content.content = [
    {
      type: "paragraph",
      content: [{ type: "reference", reference: structuredClone(refs[1]) }],
    },
  ];
  const sheet = data.documents[0].blocks.find(
    (block) => block.type === "spreadsheet",
  )!;
  sheet.workbook.sheets[0].cells.C1 = {
    value: "Linked cell",
    reference: structuredClone(refs[3]),
  };
  return data;
}

describe("encrypted document archives", () => {
  it("roundtrips secrets, attachment bytes, workbook formulas and references with real authenticated encryption", async () => {
    const data = await linkedFixture();
    const original = structuredClone(data);
    const payload = await exportDocumentArchive(data, sourceDatabase, password);
    const envelope = JSON.parse(payload);
    expect(envelope).toMatchObject({ version: 2, algorithm: "AES-256-GCM" });
    expect(payload).not.toContain("PRIVATE_FIXTURE");
    expect(payload).not.toContain("PRIVATE_ATTACHMENT_FIXTURE");
    expect(payload).not.toContain(data.attachments[0].dataBase64);
    expect(await importDocumentArchive(payload, password)).toEqual(
      archive(data),
    );
    expect(data).toEqual(original);
  });

  it("rejects the wrong password and ciphertext tampering without returning document content", async () => {
    const payload = await exportDocumentArchive(
      fixture(),
      sourceDatabase,
      password,
    );
    await expect(
      importDocumentArchive(payload, "not-the-password"),
    ).rejects.toThrow();
    const envelope = JSON.parse(payload);
    const bytes = Uint8Array.from(atob(envelope.ciphertext), (char) =>
      char.charCodeAt(0),
    );
    bytes[0] ^= 1;
    envelope.ciphertext = btoa(String.fromCharCode(...bytes));
    await expect(
      importDocumentArchive(JSON.stringify(envelope), password),
    ).rejects.toThrow();
  });

  it.each(["", "short"])(
    "refuses weak export password %j",
    async (weakPassword) => {
      await expect(
        exportDocumentArchive(fixture(), sourceDatabase, weakPassword),
      ).rejects.toThrow(/at least 12/);
    },
  );

  it.each(["", "../foreign"])(
    "refuses invalid source database identifier %j before export",
    async (databaseId) => {
      await expect(
        exportDocumentArchive(fixture(), databaseId, password),
      ).rejects.toThrow();
    },
  );

  it("refuses a plaintext document archive", async () => {
    await expect(
      importDocumentArchive(JSON.stringify(archive()), password),
    ).rejects.toThrow(/encrypted/);
  });

  it.each([
    { ...archive(), format: "unrelated" },
    { ...archive(), version: 2 },
    { ...archive(), databaseId: "../foreign" },
    { ...archive(), unrecognized: "PRIVATE_FIXTURE" },
    { format: "sorng-documents", version: 1, databaseId: sourceDatabase },
  ])(
    "rejects unsupported or incomplete decrypted archive metadata %#",
    async (value) => {
      await expect(
        importDocumentArchive(await encryptFixture(value), password),
      ).rejects.toThrow(/supported document archive/);
    },
  );

  it("verifies attachment hashes on both export and import even when envelope authentication is valid", async () => {
    const data = await linkedFixture();
    data.attachments[0].sha256 = "0".repeat(64);
    await expect(
      exportDocumentArchive(data, sourceDatabase, password),
    ).rejects.toThrow(/inconsistent/);
    await expect(
      importDocumentArchive(await encryptFixture(archive(data)), password),
    ).rejects.toThrow(/inconsistent/);
  });
});

describe("append-only document archive import", () => {
  it("remaps imported records and all owned links while preserving connection ownership and foreign or missing targets", async () => {
    const current = await linkedFixture();
    current.revision = 7;
    const source = archive(await linkedFixture());
    const originalCurrent = structuredClone(current);
    const originalArchive = structuredClone(source);
    const result = appendDocumentArchive(
      current,
      source,
      destinationDatabase,
      "chosen-folder",
    );

    expect(result.revision).toBe(7);
    expect(result.documents).toHaveLength(2);
    expect(result.people).toHaveLength(2);
    expect(result.tickets).toHaveLength(2);
    expect(result.attachments).toHaveLength(2);
    expect(result.documents[0]).toEqual(current.documents[0]);
    expect(result.people[0]).toEqual(current.people[0]);
    expect(result.tickets[0]).toEqual(current.tickets[0]);
    expect(result.attachments[0]).toEqual(current.attachments[0]);
    const imported = result.documents[1];
    expect(imported.id).not.toBe("doc");
    expect(imported.parentFolderId).toBe("chosen-folder");
    expect(result.people[1].id).not.toBe("person");
    expect(result.tickets[1].id).not.toBe("ticket");
    expect(result.attachments[1].id).not.toBe("attachment");
    const expectedRefs: DocumentReference[] = [
      { databaseId: destinationDatabase, kind: "document", id: imported.id },
      {
        databaseId: destinationDatabase,
        kind: "person",
        id: result.people[1].id,
      },
      {
        databaseId: destinationDatabase,
        kind: "ticket",
        id: result.tickets[1].id,
      },
      {
        databaseId: destinationDatabase,
        kind: "cell",
        id: imported.id,
        blockId: "sheet",
        sheetId: "main",
        address: "B3",
      },
      ...source.data.people[0].references.slice(4),
    ];
    expect(result.people[1].references).toEqual(expectedRefs);
    expect(result.tickets[1].references).toEqual(expectedRefs);
    expect(
      imported.blocks
        .filter((block) => block.type === "reference")
        .map((block) => block.reference),
    ).toEqual(expectedRefs);
    expect(
      imported.blocks.find((block) => block.type === "rich-text")!.content
        .content?.[0].content?.[0].reference,
    ).toEqual(expectedRefs[1]);
    const sheet = imported.blocks.find(
      (block) => block.type === "spreadsheet",
    )!;
    expect(sheet.workbook.sheets[0].cells.C1.reference).toEqual(
      expectedRefs[3],
    );
    expect(sheet.workbook.sheets[0].cells.A1.reference).toEqual(
      expectedRefs[4],
    );
    expect(sheet.workbook.sheets[0].cells.B3.formula).toBe("=SUM(B1:B2)");
    expect(
      imported.blocks.find((block) => block.type === "attachment")!
        .attachmentId,
    ).toBe(result.attachments[1].id);
    expect(
      imported.blocks.find((block) => block.type === "identity")!.attachmentIds,
    ).toEqual([result.attachments[1].id]);
    expect(result.attachments[1]).toEqual({
      ...source.data.attachments[0],
      id: result.attachments[1].id,
    });
    expect(current).toEqual(originalCurrent);
    expect(source).toEqual(originalArchive);
  });

  it("repeated imports append independent IDs instead of overwriting earlier imports", () => {
    const source = archive();
    const first = appendDocumentArchive(
      fixture(),
      source,
      destinationDatabase,
      null,
    );
    const second = appendDocumentArchive(
      first,
      source,
      destinationDatabase,
      null,
    );
    expect(second.documents).toHaveLength(3);
    expect(new Set(second.documents.map((doc) => doc.id)).size).toBe(3);
    expect(second.documents.slice(0, 2)).toEqual(first.documents);
  });

  it("rejects invalid imported data without modifying the destination", () => {
    const current = fixture();
    const before = structuredClone(current);
    const source = archive();
    source.data.documents.push(structuredClone(source.data.documents[0]));
    expect(() =>
      appendDocumentArchive(current, source, destinationDatabase, null),
    ).toThrow(/duplicate/);
    expect(current).toEqual(before);
  });
});
