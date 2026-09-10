import type { DatabaseDocuments } from "../../src/types/documents/document";
export const fixture = (): DatabaseDocuments => ({
  version: 1,
  revision: 0,
  attachments: [],
  people: [],
  tickets: [],
  documents: [
    {
      id: "doc",
      name: "Inventory",
      icon: "file-text",
      parentFolderId: null,
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      blocks: [
        {
          id: "secret",
          type: "credential",
          label: "Router",
          username: "admin",
          password: "PRIVATE_FIXTURE",
          url: "https://router.example",
          notes: "private notes",
        },
        {
          id: "text",
          type: "rich-text",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Fixture", marks: [{ type: "bold" }] },
                ],
              },
            ],
          },
        },
        {
          id: "sheet",
          type: "spreadsheet",
          workbook: {
            version: 1,
            styles: {
              heading: {
                bold: true,
                color: "#ffffff",
                background: "#000000",
                numberFormat: "0.00",
              },
            },
            validations: {
              yesno: { type: "list", values: ["Yes", "No"], allowBlank: true },
            },
            sheets: [
              {
                id: "main",
                name: "Inventory",
                rows: 100,
                columns: 26,
                cells: {
                  A1: {
                    value: "Linked host",
                    styleId: "heading",
                    reference: {
                      databaseId: "db-a",
                      kind: "connection",
                      id: "host",
                    },
                  },
                  B1: { value: 2 },
                  B2: { value: 3 },
                  B3: { value: null, formula: "=SUM(B1:B2)" },
                },
                merges: [
                  { startRow: 4, startColumn: 0, endRow: 4, endColumn: 2 },
                ],
                rowMetadata: { "0": { size: 32 } },
                columnMetadata: { "0": { size: 240 } },
                freeze: { rows: 1, columns: 0 },
              },
            ],
          },
        },
      ],
    },
  ],
});
