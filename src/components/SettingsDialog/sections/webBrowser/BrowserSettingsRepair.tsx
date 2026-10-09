import { useId, useLayoutEffect, useState } from "react";
import { Textarea } from "../../../ui/forms/Textarea";

const MAX_LENGTH = 2 * 1024 * 1024;
function textOf(value: unknown) {
  try {
    const text = JSON.stringify(value, null, 2);
    return typeof text === "string" && text.length <= MAX_LENGTH ? text : "";
  } catch {
    return "";
  }
}

/** Explicit local repair, never a diagnostic export or an automatic reset. */
export default function BrowserSettingsRepair<T>({
  value,
  label,
  validate,
  onApply,
  disabled = false,
}: {
  value: unknown;
  label: string;
  validate: (input: unknown) => T;
  onApply: (next: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => ({
    source: value,
    text: textOf(value),
    error: "",
  }));
  useLayoutEffect(
    () => setDraft({ source: value, text: textOf(value), error: "" }),
    [value],
  );
  const current = draft.source === value;
  return (
    <details className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[var(--color-text)]">
      <summary className="cursor-pointer text-sm font-medium">
        Repair saved settings
      </summary>
      <p className="text-xs text-[var(--color-textSecondary)]">
        This local JSON editor preserves your configuration until you explicitly
        apply a valid repair. Review all changes; removing permissions may
        change inherited access. Values are not included in diagnostics.
      </p>
      <label htmlFor={id} className="block text-sm">
        {label}
      </label>
      <Textarea
        id={id}
        value={current ? draft.text : ""}
        className="min-h-48 w-full font-mono text-xs"
        disabled={disabled || !current}
        maxLength={MAX_LENGTH}
        spellCheck={false}
        autoComplete="off"
        onChange={(text) => setDraft({ source: value, text, error: "" })}
      />
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={disabled || !current || !draft.text.trim()}
        onClick={() => {
          if (disabled || !current) return;
          let next: T;
          try {
            if (draft.text.length > MAX_LENGTH) throw new Error();
            const parsed: unknown = JSON.parse(draft.text);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              throw new Error();
            next = validate(parsed);
          } catch {
            setDraft((previous) => ({
              ...previous,
              error:
                "The repair is still invalid. Review the field guidance and supported values. No changes were applied.",
            }));
            return;
          }
          onApply(next);
        }}
      >
        Apply repaired settings
      </button>
      {draft.error && (
        <p role="alert" className="sor-alert-error text-sm">
          {draft.error}
        </p>
      )}
    </details>
  );
}
