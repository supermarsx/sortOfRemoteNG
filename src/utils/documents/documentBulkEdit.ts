import type {
  DatabaseDocuments,
  DocumentTicket,
} from "../../types/documents/document";
import { getRuntimeIconEntry } from "../icons/iconLibraryRuntime";
import { normalizeDatabaseDocuments } from "./validation";
import { normalizeServiceDeskTags } from "./serviceDesk";

export type BulkEntrySection = "documents" | "people" | "tickets";
export const MAX_BULK_ENTRIES = 500;
export type BulkField<T> = { mode: "keep" } | { mode: "set"; value: T };
export type BulkTags =
  | { mode: "keep" }
  | { mode: "clear" }
  | { mode: "add" | "remove" | "replace"; values: string[] };
export type BulkEntryPatch =
  | {
      section: "documents";
      folder: BulkField<string | null>;
      icon: BulkField<string>;
    }
  | { section: "people"; organization: BulkField<string>; tags: BulkTags }
  | {
      section: "tickets";
      status: BulkField<DocumentTicket["status"]>;
      priority: BulkField<DocumentTicket["priority"]>;
      tags: BulkTags;
    };

function tags(previous: string[] | undefined, patch: BulkTags): string[] {
  const current = normalizeServiceDeskTags(previous);
  if (patch.mode === "keep") return current;
  if (patch.mode === "clear") return [];
  const values = normalizeServiceDeskTags(patch.values);
  if (!values.length)
    throw new Error("Choose at least one tag, or select Clear all tags.");
  if (patch.mode === "replace") return values;
  if (patch.mode === "add")
    return normalizeServiceDeskTags([
      ...current,
      ...values.filter(
        (tag) =>
          !current.some(
            (existing) => existing.toLowerCase() === tag.toLowerCase(),
          ),
      ),
    ]);
  if (patch.mode === "remove") {
    const removed = new Set(values.map((tag) => tag.toLowerCase()));
    return current.filter((tag) => !removed.has(tag.toLowerCase()));
  }
  throw new Error("Choose a supported tag operation.");
}
const field = <T>(current: T, patch: BulkField<T>): T => {
  if (patch.mode === "keep") return current;
  if (patch.mode === "set") return patch.value;
  throw new Error("Choose whether to keep or change each field.");
};

/** Atomic draft-only metadata edit. No IDs, content, references, or collections
 * are added/deleted. The owning workspace still validates policy and saves by CAS. */
export function applyBulkEntryPatch(
  data: DatabaseDocuments,
  ids: readonly string[],
  patch: BulkEntryPatch,
  folderIds: readonly string[],
  now = new Date().toISOString(),
): { data: DatabaseDocuments; changed: number } {
  if (
    !ids.length ||
    ids.length > MAX_BULK_ENTRIES ||
    new Set(ids).size !== ids.length
  )
    throw new Error(`Select between 1 and ${MAX_BULK_ENTRIES} unique entries.`);
  if (!["documents", "people", "tickets"].includes(patch.section))
    throw new Error("Choose a supported entry type.");
  const selected = new Set(ids);
  const records = data[patch.section];
  if (
    ids.some((id) => records.filter((record) => record.id === id).length !== 1)
  )
    throw new Error(
      "A selected entry changed or was removed. Select the entries again.",
    );
  if (patch.section === "documents") {
    if (
      patch.folder.mode === "set" &&
      patch.folder.value !== null &&
      !folderIds.includes(patch.folder.value)
    )
      throw new Error(
        "The destination folder is no longer available in this database.",
      );
    if (patch.icon.mode === "set" && !getRuntimeIconEntry(patch.icon.value))
      throw new Error("Choose an icon from the app's icon library.");
  }
  let changed = 0;
  const change = <T extends { id: string }>(
    record: T,
    edit: (value: T) => T,
  ): T => {
    if (!selected.has(record.id)) return record;
    const next = edit(record);
    if (JSON.stringify(next) === JSON.stringify(record)) return record;
    changed++;
    return next;
  };
  const next = { ...data };
  if (patch.section === "documents")
    next.documents = data.documents.map((record) => {
      const updated = change(record, (item) => ({
        ...item,
        parentFolderId: field(item.parentFolderId, patch.folder),
        icon: field(item.icon, patch.icon),
      }));
      return updated === record ? record : { ...updated, updatedAt: now };
    });
  else if (patch.section === "people")
    next.people = data.people.map((record) =>
      change(record, (item) => ({
        ...item,
        organization: field(item.organization, patch.organization),
        ...(patch.tags.mode === "keep"
          ? {}
          : { tags: tags(item.tags, patch.tags) }),
      })),
    );
  else
    next.tickets = data.tickets.map((record) =>
      change(record, (item) => ({
        ...item,
        status: field(item.status, patch.status),
        priority: field(item.priority, patch.priority),
        ...(patch.tags.mode === "keep"
          ? {}
          : { tags: tags(item.tags, patch.tags) }),
      })),
    );
  // Validate the entire result before returning any replacement. A tag overflow
  // on one row refuses the whole operation, never a partially changed batch.
  normalizeDatabaseDocuments(next);
  return { data: next, changed };
}
