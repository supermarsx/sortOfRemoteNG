import React, { useId, useState } from "react";
import { Check, ChevronDown, FileText, Search } from "lucide-react";
import {
  getIconLibrarySnapshot,
  getRuntimeIconEntry,
  useIconLibraryRevision,
} from "../../utils/icons/iconLibraryRuntime";

/** Compact document-focused selection from the existing passive vector catalog. */
export function DocumentIconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  useIconLibraryRevision();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const current = getRuntimeIconEntry(value);
  const Icon = current?.icon ?? FileText;
  const search = query.trim().toLowerCase();
  const entries = getIconLibrarySnapshot().entries.filter((entry) =>
    search
      ? [entry.label, entry.key, ...entry.keywords].some((text) =>
          text.toLowerCase().includes(search),
        )
      : entry.category === "files" || entry.category === "folders",
  );
  const visible = entries.slice(0, 60);
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        aria-label={`Document icon: ${current?.label ?? "Text file"}`}
        aria-expanded={open}
        aria-controls={id}
        title="Choose document icon"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Icon size={18} aria-hidden="true" />
        <span>Choose icon</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
        >
          <label
            className="mb-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]"
            htmlFor={`${id}-search`}
          >
            <Search size={14} aria-hidden="true" /> Search document icons
          </label>
          <input
            id={`${id}-search`}
            className="sor-form-input w-full"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the icon library…"
          />
          <div
            className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1"
            role="group"
            aria-label="Document icons"
          >
            {visible.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="sor-icon-btn sor-accent-choice relative h-10 w-10"
                aria-label={entry.label}
                aria-pressed={entry.key === value}
                title={entry.label}
                disabled={disabled}
                onClick={() => {
                  onChange(entry.key);
                  setOpen(false);
                }}
              >
                <entry.icon size={20} aria-hidden="true" />
                {entry.key === value && (
                  <Check
                    size={10}
                    className="absolute right-0 top-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>
          <p
            className="mt-2 text-xs text-[var(--color-textSecondary)]"
            role="status"
          >
            {entries.length === 0
              ? "No matching icons."
              : entries.length > visible.length
                ? `Showing ${visible.length} of ${entries.length} icons. Refine your search for more.`
                : search
                  ? `${entries.length} matching icons.`
                  : "File and folder icons. Search to browse all categories."}
          </p>
        </div>
      )}
    </div>
  );
}
