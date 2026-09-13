import type { DocumentTicket } from "../../types/documents/document";

export const SERVICE_DESK_TAG_LIMIT = 32;
export const SERVICE_DESK_TAG_BYTES = 64;

/** Tags are private database data, never global preferences or telemetry. */
export function normalizeServiceDeskTags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SERVICE_DESK_TAG_LIMIT)
    throw new Error("Use up to 32 tags, each up to 64 UTF-8 bytes.");
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      /\p{Cc}/u.test(entry) ||
      new TextEncoder().encode(entry).byteLength > SERVICE_DESK_TAG_BYTES
    )
      throw new Error(
        "Use up to 32 tags, each up to 64 UTF-8 bytes, without control characters.",
      );
    const tag = entry.trim();
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

export interface TicketFilters {
  text: string;
  status: DocumentTicket["status"] | "";
  priority: DocumentTicket["priority"] | "";
  tag: string;
}

export function ticketMatchesFilters(
  ticket: DocumentTicket,
  filters: TicketFilters,
): boolean {
  const tags = ticket.tags ?? [];
  return (
    (!filters.status || ticket.status === filters.status) &&
    (!filters.priority || ticket.priority === filters.priority) &&
    (!filters.tag ||
      tags.some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) &&
    `${ticket.title} ${ticket.description} ${ticket.status} ${ticket.priority} ${tags.join(" ")}`
      .toLowerCase()
      .includes(filters.text.trim().toLowerCase())
  );
}

export function serviceDeskTagSuggestions(
  records: readonly { tags?: string[] }[],
): string[] {
  const tags = new Map<string, string>();
  for (const record of records)
    for (const tag of record.tags ?? [])
      if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  return [...tags.values()].sort((a, b) => a.localeCompare(b));
}
