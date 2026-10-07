import React from "react";
import { Select } from "../../ui/forms";
import { DOCUMENT_TYPE_OPTIONS } from "../../../utils/documents/documentTypePolicy";
import type {
  TreeDocumentTypeFilter,
  TreeEntryFilter,
} from "./documentTreeModel";

export function DocumentTreeFilters({
  mode,
  documentType,
  fullText,
  connectionFilters,
  onMode,
  onType,
}: {
  mode: TreeEntryFilter;
  documentType: TreeDocumentTypeFilter;
  fullText: boolean;
  connectionFilters: boolean;
  onMode: (mode: TreeEntryFilter) => void;
  onType: (type: TreeDocumentTypeFilter) => void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-b border-[var(--color-border)] px-2 py-2">
      <div role="group" aria-label="Tree entries" className="flex gap-1">
        {(
          [
            ["all", "All"],
            ["connections", "Connections"],
            ["documents", "Documents"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="sor-btn sor-accent-choice min-w-0 flex-1 px-2 py-1 text-xs"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode !== "connections" && (
        <>
          <Select
            label="Document type"
            value={documentType}
            onChange={(value) => onType(value as TreeDocumentTypeFilter)}
            variant="form-sm"
            className="w-full"
            searchable
            searchPlaceholder="Find document type…"
            options={[
              { value: "all", label: "All document types" },
              { value: "blank", label: "Blank documents" },
              ...DOCUMENT_TYPE_OPTIONS.filter(
                (option) =>
                  option.type !== "person" && option.type !== "ticket",
              ).map((option) => ({ value: option.type, label: option.label })),
            ]}
          />
          <p className="text-[10px] leading-4 text-[var(--color-textMuted)]">
            {fullText
              ? "Document search includes ordinary content; private fields are excluded."
              : "Document search matches names only."}
            {connectionFilters &&
              " Protocol, tag and favorite filters apply to connections only."}
          </p>
        </>
      )}
    </div>
  );
}
