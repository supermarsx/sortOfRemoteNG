import { describe, expect, it } from "vitest";
import {
  applyBulkEntryPatch,
  MAX_BULK_ENTRIES,
  type BulkEntryPatch,
  type BulkTags,
} from "../../src/utils/documents/documentBulkEdit";
import { fixture } from "./fixtures";

const keep = { mode: "keep" } as const;
const library = () => {
  const data = fixture();
  data.documents.push({
    ...structuredClone(data.documents[0]),
    id: "other",
    name: "Other",
  });
  data.people = [
    {
      id: "first",
      name: "Person",
      email: "person@example.test",
      phone: "555",
      organization: "Original",
      notes: "PRIVATE NOTES",
      references: [],
    },
    {
      id: "second",
      name: "Other",
      email: "",
      phone: "",
      organization: "Other",
      notes: "",
      references: [],
      tags: ["Retain", "Remove"],
    },
  ];
  data.tickets = [
    {
      id: "first",
      title: "Ticket",
      status: "open",
      priority: "high",
      description: "PRIVATE DETAILS",
      references: [],
    },
    {
      id: "second",
      title: "Other",
      status: "closed",
      priority: "low",
      description: "",
      references: [],
      tags: ["Retain", "Remove"],
    },
  ];
  return data;
};
describe("atomic entry metadata bulk edits", () => {
  it.each([
    { section: "documents", folder: keep, icon: keep },
    { section: "people", organization: keep, tags: keep },
    { section: "tickets", status: keep, priority: keep, tags: keep },
  ] satisfies BulkEntryPatch[])(
    "keeps every $section value and optional absence unchanged",
    (patch) => {
      const data = library();
      const original = structuredClone(data);
      const ids = data[patch.section].map((entry) => entry.id);
      const result = applyBulkEntryPatch(data, ids, patch, []);
      expect(result.changed).toBe(0);
      expect(result.data).toEqual(original);
      expect(data).toEqual(original);
      expect(
        Object.prototype.hasOwnProperty.call(result.data.people[0], "tags"),
      ).toBe(false);
    },
  );
  it("moves selected documents without touching content, names, references or other records", () => {
    const data = library(),
      original = structuredClone(data);
    const result = applyBulkEntryPatch(
      data,
      ["doc"],
      {
        section: "documents",
        folder: { mode: "set", value: "folder" },
        icon: { mode: "set", value: "folder" },
      },
      ["folder"],
      "2026-09-13T00:00:00.000Z",
    );
    expect(result.changed).toBe(1);
    expect(result.data.documents[0]).toEqual({
      ...original.documents[0],
      parentFolderId: "folder",
      icon: "folder",
      updatedAt: "2026-09-13T00:00:00.000Z",
    });
    expect(result.data.documents[1]).toEqual(original.documents[1]);
    expect(data).toEqual(original);
    expect(
      applyBulkEntryPatch(
        result.data,
        ["doc"],
        {
          section: "documents",
          folder: { mode: "set", value: null },
          icon: keep,
        },
        [],
      ).data.documents[0].parentFolderId,
    ).toBeNull();
  });
  it("sets/clears organizations but never names/contact details/notes", () => {
    const data = library();
    for (const value of ["New organization", ""]) {
      const result = applyBulkEntryPatch(
        data,
        ["first", "second"],
        { section: "people", organization: { mode: "set", value }, tags: keep },
        [],
      );
      expect(result.changed).toBe(2);
      expect(result.data.people[0]).toEqual({
        ...data.people[0],
        organization: value,
      });
      expect(result.data.tickets).toEqual(data.tickets);
    }
  });
  it.each([
    [{ mode: "add", values: ["retain", "New"] }, ["Retain", "Remove", "New"]],
    [{ mode: "remove", values: ["REMOVE"] }, ["Retain"]],
    [{ mode: "replace", values: ["New"] }, ["New"]],
    [{ mode: "clear" }, []],
  ] satisfies [BulkTags, string[]][])(
    "applies explicit tag mode %j with case-insensitive matching",
    (tags, expected) => {
      const data = library();
      const result = applyBulkEntryPatch(
        data,
        ["second"],
        {
          section: "tickets",
          status: { mode: "set", value: "resolved" },
          priority: keep,
          tags,
        },
        [],
      );
      expect(result.data.tickets[1]).toEqual({
        ...data.tickets[1],
        status: "resolved",
        tags: expected,
      });
      expect(result.data.tickets[0]).toEqual(data.tickets[0]);
    },
  );
  it("refuses the entire batch on one tag overflow, without truncating or editing input", () => {
    const data = library();
    data.people[1].tags = Array.from({ length: 32 }, (_, i) => `tag-${i}`);
    const original = structuredClone(data);
    expect(() =>
      applyBulkEntryPatch(
        data,
        ["first", "second"],
        {
          section: "people",
          organization: { mode: "set", value: "New" },
          tags: { mode: "add", values: ["extra"] },
        },
        [],
      ),
    ).toThrow(/32 tags/);
    expect(data).toEqual(original);
    expect(
      applyBulkEntryPatch(
        data,
        ["second"],
        {
          section: "people",
          organization: keep,
          tags: { mode: "add", values: ["TAG-0"] },
        },
        [],
      ).changed,
    ).toBe(0);
  });
  it("rejects empty, duplicate, removed, excessive selections and stale destinations", () => {
    const data = library();
    const patch: BulkEntryPatch = {
      section: "documents",
      folder: keep,
      icon: keep,
    };
    for (const ids of [
      [],
      ["doc", "doc"],
      ["gone"],
      Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) => `id-${i}`),
    ])
      expect(() => applyBulkEntryPatch(data, ids, patch, [])).toThrow();
    expect(() =>
      applyBulkEntryPatch(
        data,
        ["doc"],
        { ...patch, folder: { mode: "set", value: "foreign" } },
        [],
      ),
    ).toThrow(/folder/);
    expect(() =>
      applyBulkEntryPatch(
        data,
        ["doc"],
        { ...patch, icon: { mode: "set", value: "not-a-runtime-icon" } },
        [],
      ),
    ).toThrow(/icon/);
  });
  it("allows exactly 500 selected entries without inventing fields or changing unselected rows", () => {
    const data = library();
    data.people = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, index) => ({
      ...data.people[0],
      id: `person-${index}`,
    }));
    const ids = data.people
      .slice(0, MAX_BULK_ENTRIES)
      .map((person) => person.id);
    const result = applyBulkEntryPatch(
      data,
      ids,
      {
        section: "people",
        organization: { mode: "set", value: "Updated" },
        tags: keep,
      },
      [],
    );
    expect(result.changed).toBe(MAX_BULK_ENTRIES);
    expect(result.data.people[MAX_BULK_ENTRIES]).toEqual(
      data.people[MAX_BULK_ENTRIES],
    );
    expect(result.data.people[0]).not.toHaveProperty("tags");
    expect(data.people[0].organization).toBe("Original");
  });
});
