import React from "react";
import type { Connection } from "../../../types/connection/connection";
import { getHttpApplicationIconSuggestion } from "../../../utils/icons/httpApplicationIconSuggestions";
import { normalizeConnectionIconKey } from "../../../utils/icons/connectionIconCatalog";

export interface ApplicationIconSuggestionProps {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/** Shared by Application and Organize; only the explicit button changes icon. */
export default function ApplicationIconSuggestion({
  formData,
  setFormData,
}: ApplicationIconSuggestionProps) {
  const suggestion = getHttpApplicationIconSuggestion(formData);
  if (!suggestion) return null;
  const Icon = suggestion.icon.icon;
  const selected =
    normalizeConnectionIconKey(formData.icon) === suggestion.icon.key;
  const apply = () =>
    setFormData((current) => {
      const latest = getHttpApplicationIconSuggestion(current);
      // A queued click from a previous application must not modify the new one.
      if (
        !latest ||
        latest.applicationId !== suggestion.applicationId ||
        latest.icon.key !== suggestion.icon.key ||
        normalizeConnectionIconKey(current.icon) === suggestion.icon.key
      )
        return current;
      return { ...current, icon: suggestion.icon.key };
    });

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-testid="application-icon-suggestion"
      data-editor-search-field="icon httpApplication"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--color-text)]"
        title={suggestion.icon.description}
      >
        <Icon size={24} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--color-text)]">
          Suggested for {suggestion.applicationLabel}: {suggestion.icon.label}
        </p>
        <p className="text-xs text-[var(--color-textMuted)]">
          {selected
            ? "This icon is already selected."
            : "Optional — your current icon stays unchanged until you apply this suggestion."}
        </p>
      </div>
      <button
        type="button"
        className="sor-btn sor-btn-secondary text-xs"
        disabled={selected}
        onClick={apply}
      >
        {selected ? "Suggested icon selected" : "Use suggested icon"}
      </button>
    </div>
  );
}
