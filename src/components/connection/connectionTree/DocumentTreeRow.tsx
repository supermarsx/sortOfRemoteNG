import React from "react";
import { FileText } from "lucide-react";
import {
  getRuntimeIconEntry,
  useIconLibraryRevision,
} from "../../../utils/icons/iconLibraryRuntime";
import type { ConnectionDocumentTreeRow } from "./documentTreeModel";

/** A document leaf has no connection actions, connection ID attributes or drag payload. */
export function DocumentTreeRow({
  row,
  selected,
  onSelect,
  onOpen,
}: {
  row: Extract<ConnectionDocumentTreeRow, { kind: "document" }>;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  useIconLibraryRevision();
  const Icon = getRuntimeIconEntry(row.document.icon)?.icon ?? FileText;
  const rejectDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "none";
  };
  return (
    <div
      role="treeitem"
      aria-label={`${row.document.name}, document`}
      aria-level={row.level + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-document-id={row.document.id}
      data-tauri-disable-drag="true"
      data-tooltip={`${row.document.name} · Double-click or press Enter to open document`}
      className={`flex h-8 min-w-0 cursor-pointer items-center gap-2 px-2 text-sm hover:bg-[var(--color-border)]/50 ${selected ? "bg-primary/20 text-primary" : "text-[var(--color-textSecondary)]"}`}
      style={{ paddingLeft: row.level * 16 + 8 }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
        event.currentTarget.focus({ preventScroll: true });
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onFocus={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
        event.currentTarget.focus({ preventScroll: true });
      }}
      draggable={false}
      onDragStart={rejectDrop}
      onDragOver={rejectDrop}
      onDrop={rejectDrop}
    >
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{row.document.name}</span>
      <span className="shrink-0 text-[10px] text-[var(--color-textMuted)]">
        Document
      </span>
    </div>
  );
}
