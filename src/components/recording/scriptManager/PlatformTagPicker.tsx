import { useState } from "react";
import { OS_TAG_LABELS, type OSTag } from "./shared";
import { ScriptMetadataIcon } from "./ScriptMetadataIcon";

/** Metadata only: choosing a tag never transforms or runs the script/macro. */
export default function PlatformTagPicker({
  value,
  onToggle,
}: {
  value: readonly string[];
  onToggle: (tag: OSTag) => void;
}) {
  const [query, setQuery] = useState("");
  const tags = (Object.entries(OS_TAG_LABELS) as [OSTag, string][]).filter(
    ([tag, label]) =>
      `${tag} ${label}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Search platform tags"
        placeholder="Search platforms, e.g. Ubuntu or CentOS"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="sor-form-input"
      />
      <div
        className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
        role="group"
        aria-label="Platform tags"
      >
        {tags.map(([tag, label]) => (
          <button
            key={tag}
            type="button"
            aria-pressed={value.includes(tag)}
            onClick={() => onToggle(tag)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${value.includes(tag) ? "border-accent/50 bg-primary/20 text-primary" : "border-[var(--color-border)] bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]"}`}
          >
            <ScriptMetadataIcon platform={tag} size={14} />
            {label}
          </button>
        ))}
        {!tags.length && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            No matching platforms.
          </p>
        )}
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        {value.length} selected. User-assigned metadata, not a compatibility or
        execution guarantee.
      </p>
    </div>
  );
}
