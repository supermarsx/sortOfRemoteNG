import { describe, expect, it } from "vitest";
import {
  normalizeServiceDeskTags,
  serviceDeskTagSuggestions,
  ticketMatchesFilters,
} from "../../src/utils/documents/serviceDesk";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../../src/utils/documents/validation";
import {
  appendDocumentArchive,
  exportDocumentArchive,
  importDocumentArchive,
} from "../../src/utils/documents/documentArchive";
import type { DocumentTicket } from "../../src/types/documents/document";

const ticket: DocumentTicket = {
  id: "ticket",
  title: "Replace switch",
  description: "Rack twelve",
  status: "open",
  priority: "high",
  references: [],
};
describe("database-local service desk tags", () => {
  it("normalizes missing tags, whitespace and duplicate casing without changing input", () => {
    expect(normalizeServiceDeskTags(undefined)).toEqual([]);
    expect(
      normalizeServiceDeskTags([" Network ", "network", "", "Floor 2"]),
    ).toEqual(["Network", "Floor 2"]);
    const data = { ...emptyDatabaseDocuments(), tickets: [ticket] };
    expect(normalizeDatabaseDocuments(data).tickets[0].tags).toEqual([]);
    expect(ticket.tags).toBeUndefined();
  });
  it.each([
    null,
    "tag",
    [null],
    ["bad\nline"],
    ["bad\0tag"],
    ["x".repeat(65)],
    ["é".repeat(33)],
    Array(33).fill("tag"),
  ])("rejects malformed or oversized tags: %j", (tags) => {
    expect(() => normalizeServiceDeskTags(tags)).toThrow();
    expect(() =>
      normalizeDatabaseDocuments({
        ...emptyDatabaseDocuments(),
        tickets: [{ ...ticket, tags }],
      }),
    ).toThrow();
  });
  it("combines exact status, priority, tag and description search without hiding records globally", () => {
    const tagged = { ...ticket, tags: ["Network", "Floor 2"] };
    expect(
      ticketMatchesFilters(tagged, {
        text: "TWELVE",
        status: "open",
        priority: "high",
        tag: "network",
      }),
    ).toBe(true);
    for (const patch of [
      { status: "closed" as const },
      { priority: "low" as const },
      { tag: "Net" },
      { text: "absent" },
    ])
      expect(
        ticketMatchesFilters(tagged, {
          text: "",
          status: "",
          priority: "",
          tag: "",
          ...patch,
        }),
      ).toBe(false);
    expect(
      serviceDeskTagSuggestions([tagged, { tags: ["network", "Urgent"] }]),
    ).toEqual(["Floor 2", "Network", "Urgent"]);
  });
  it("preserves normalized person/ticket tags through encrypted archive and cross-database append", async () => {
    const data = normalizeDatabaseDocuments({
      ...emptyDatabaseDocuments(),
      tickets: [{ ...ticket, tags: [" Network ", "network"] }],
      people: [
        {
          id: "person",
          name: "Help desk",
          email: "",
          phone: "",
          organization: "",
          notes: "",
          references: [],
          tags: ["Support"],
        },
      ],
    });
    const payload = await exportDocumentArchive(
      data,
      "db-a",
      "synthetic-long-password",
    );
    expect(payload).not.toContain("Network");
    const imported = await importDocumentArchive(
      payload,
      "synthetic-long-password",
    );
    expect(imported.data).toEqual(data);
    const merged = appendDocumentArchive(
      emptyDatabaseDocuments(),
      imported,
      "db-b",
      null,
    );
    expect(merged.tickets[0].tags).toEqual(["Network"]);
    expect(merged.people[0].tags).toEqual(["Support"]);
    expect(merged.tickets[0].id).not.toBe(ticket.id);
  });
});
