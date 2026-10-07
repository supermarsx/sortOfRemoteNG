import type {
  DatabaseDocument,
  DocumentAttachment,
} from "../../types/documents/document";

export interface DocumentEditSnapshot {
  document: DatabaseDocument;
  attachments: DocumentAttachment[];
}

/** Only this document and the attachment bytes needed to restore it. Never persisted. */
export function documentEditSnapshot(
  document: DatabaseDocument,
  attachments: DocumentAttachment[],
): DocumentEditSnapshot {
  const used = new Set<string>();
  for (const block of document.blocks) {
    if (block.type === "attachment") used.add(block.attachmentId);
    if (block.type === "identity")
      block.attachmentIds.forEach((id) => used.add(id));
  }
  return {
    document: { ...document, updatedAt: "" },
    attachments: attachments.filter((entry) => used.has(entry.id)),
  };
}

function describeChange(before: DatabaseDocument, after: DatabaseDocument) {
  if (before.name !== after.name)
    return { label: "Rename document", group: "name" };
  if (before.icon !== after.icon) return { label: "Change icon", group: "" };
  if (before.parentFolderId !== after.parentFolderId)
    return { label: "Move document", group: "" };
  if (before.blocks.length < after.blocks.length)
    return { label: "Insert content", group: "" };
  if (before.blocks.length > after.blocks.length)
    return { label: "Remove content", group: "" };
  if (
    before.blocks.some((block, index) => block.id !== after.blocks[index]?.id)
  )
    return { label: "Reorder content", group: "" };
  const changed = after.blocks.filter(
    (block, index) =>
      JSON.stringify(block) !== JSON.stringify(before.blocks[index]),
  );
  if (changed.length === 1) {
    const block = changed[0];
    const label =
      block.type === "spreadsheet"
        ? "Edit spreadsheet"
        : ["rich-text", "markdown", "note"].includes(block.type)
          ? "Edit text"
          : "Edit block";
    return { label, group: `${block.type}:${block.id}` };
  }
  return { label: "Edit document", group: "" };
}

/** Bounded snapshots: 50 transitions / 32 MiB estimated UTF-16 payload per editor. */
export function createDocumentEditHistory(
  maxBytes = 32 * 1024 * 1024,
  maxSteps = 50,
) {
  type Entry = { json: string; label: string; group: string; time: number };
  let entries: Entry[] = [];
  let cursor = -1;
  let notice = "";
  let sealGroup = false;
  const clear = () => {
    entries = [];
    cursor = -1;
    notice = "";
    sealGroup = false;
  };
  return {
    clear,
    observe(
      snapshot: DocumentEditSnapshot,
      localEdit: boolean,
      now = Date.now(),
    ) {
      const json = JSON.stringify(snapshot);
      if (json.length * 2 > maxBytes) {
        clear();
        notice =
          "This document is too large for editor undo history. Your current content is retained.";
        return;
      }
      if (entries[cursor]?.json === json) {
        if (!localEdit) sealGroup = true;
        return;
      }
      if (!localEdit || cursor < 0) {
        clear();
        entries = [{ json, label: "Opened document", group: "", time: now }];
        cursor = 0;
        return;
      }
      const previous = JSON.parse(entries[cursor].json) as DocumentEditSnapshot;
      const change = describeChange(previous.document, snapshot.document);
      const atEnd = cursor === entries.length - 1;
      entries = entries.slice(0, cursor + 1);
      const entry = { json, ...change, time: now };
      if (
        !sealGroup &&
        atEnd &&
        cursor > 0 &&
        change.group &&
        entries[cursor].group === change.group &&
        now - entries[cursor].time < 750
      ) {
        entries[cursor] = entry;
      } else {
        entries.push(entry);
        cursor++;
      }
      sealGroup = false;
      let bytes = entries.reduce((sum, item) => sum + item.json.length * 2, 0);
      while (
        entries.length > 1 &&
        (entries.length > maxSteps + 1 || bytes > maxBytes)
      ) {
        bytes -= entries.shift()!.json.length * 2;
        cursor--;
        notice = "Older undo steps were released to limit memory use.";
      }
    },
    get view() {
      return {
        undo: entries
          .slice(1, cursor + 1)
          .reverse()
          .map((item) => item.label),
        redo: entries.slice(cursor + 1).map((item) => item.label),
        notice,
      };
    },
    restore(
      direction: "undo" | "redo",
      steps: number,
      apply: (snapshot: DocumentEditSnapshot) => boolean,
    ) {
      if (!Number.isInteger(steps) || steps < 1) return false;
      const next = cursor + (direction === "undo" ? -steps : steps);
      if (cursor < 0 || next < 0 || next >= entries.length) return false;
      if (!apply(JSON.parse(entries[next].json) as DocumentEditSnapshot))
        return false;
      cursor = next;
      sealGroup = true;
      return true;
    },
  };
}
