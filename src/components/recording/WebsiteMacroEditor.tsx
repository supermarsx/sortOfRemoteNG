import { useId } from "react";
import { ChevronDown, ChevronUp, Copy, Plus, Save, Trash2 } from "lucide-react";
import type {
  WebInteractionMacro,
  WebInteractionStep,
} from "../../types/recording/webAutomation";

export function WebsiteMacroEditor({
  macro,
  onChange,
  onSave,
  onDelete,
  onDuplicate,
  disabled = false,
  saved = true,
}: {
  macro: WebInteractionMacro;
  onChange: (macro: WebInteractionMacro) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  disabled?: boolean;
  saved?: boolean;
}) {
  const id = useId();
  const steps = (value: WebInteractionStep[]) =>
    onChange({ ...macro, steps: value });
  const update = (index: number, value: WebInteractionStep) =>
    steps(macro.steps.map((item, at) => (at === index ? value : item)));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...macro.steps],
      to = index + direction;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    steps(next);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="sr-only">Website interaction macro editor</legend>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Website interactions use bounded structural selectors captured by the
        recorder, not element IDs, names or arbitrary CSS. Fill values are
        requested only during replay and are never saved here.
        Login/password/OTP fields remain excluded. Review the current page and
        layout before replay from an explicitly enabled HTTP(S) session.
      </p>
      <label htmlFor={`${id}-name`} className="block space-y-1 text-xs">
        Name
        <input
          id={`${id}-name`}
          value={macro.name}
          maxLength={100}
          onChange={(event) => onChange({ ...macro, name: event.target.value })}
          className="sor-form-input w-full"
        />
      </label>
      <label htmlFor={`${id}-description`} className="block space-y-1 text-xs">
        Description
        <textarea
          id={`${id}-description`}
          value={macro.description}
          maxLength={1000}
          rows={2}
          onChange={(event) =>
            onChange({ ...macro, description: event.target.value })
          }
          className="sor-form-input w-full"
        />
      </label>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Interactions ({macro.steps.length}/200)
        </h3>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={macro.steps.length >= 200}
          onClick={() =>
            steps([
              ...macro.steps,
              {
                kind: "click",
                selector: "html > body > button:nth-of-type(1)",
              },
            ])
          }
        >
          <Plus size={14} />
          Add interaction
        </button>
      </div>
      <ol className="space-y-3">
        {macro.steps.map((item, index) => (
          <li
            key={index}
            className="min-w-0 space-y-2 rounded border border-[var(--color-border)] p-3"
          >
            <div className="flex gap-1">
              <span className="mr-auto text-xs">Interaction {index + 1}</span>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Move interaction ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Move interaction ${index + 1} down`}
                disabled={index === macro.steps.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                className="sor-icon-btn text-error"
                aria-label={`Remove interaction ${index + 1}`}
                onClick={() =>
                  steps(macro.steps.filter((_, at) => at !== index))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            <label className="block text-xs">
              Action {index + 1}
              <select
                value={item.kind}
                className="sor-form-input ml-2 w-auto"
                style={{ width: "auto" }}
                onChange={(event) =>
                  update(
                    index,
                    event.target.value === "check"
                      ? {
                          kind: "check",
                          selector: item.selector,
                          checked: true,
                        }
                      : {
                          kind: event.target.value as "click" | "fill",
                          selector: item.selector,
                        },
                  )
                }
              >
                <option value="click">Click</option>
                <option value="check">Set checkbox</option>
                <option value="fill">Fill (prompt at replay)</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              Structural selector {index + 1}
              <input
                value={item.selector}
                maxLength={512}
                spellCheck={false}
                onChange={(event) =>
                  update(index, { ...item, selector: event.target.value })
                }
                className="sor-form-input w-full font-mono"
              />
            </label>
            {item.kind === "check" && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(event) =>
                    update(index, { ...item, checked: event.target.checked })
                  }
                />
                Checked
              </label>
            )}
            {item.kind === "fill" && (
              <p className="text-xs text-[var(--color-textSecondary)]">
                No input value is stored in this macro.
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={!macro.name.trim() || !macro.steps.length}
          onClick={onSave}
        >
          <Save size={14} />
          Save macro
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={onDuplicate}
        >
          <Copy size={14} />
          Duplicate as draft
        </button>
        {saved && (
          <button
            type="button"
            className="sor-btn sor-btn-danger ml-auto"
            onClick={onDelete}
          >
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>
    </fieldset>
  );
}
