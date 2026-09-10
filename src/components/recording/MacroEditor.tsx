import { useId, useState } from "react";
import { Plus, Trash2, Save, Copy, ChevronDown, ChevronUp } from "lucide-react";
import type {
  TerminalMacro,
  MacroStep,
} from "../../types/recording/macroTypes";

interface MacroEditorProps {
  macro: TerminalMacro;
  onChange: (macro: TerminalMacro) => void;
  onSave: (macro: TerminalMacro) => void;
  onDelete: (id: string) => void;
  onDuplicate: (macro: TerminalMacro) => void;
  disabled?: boolean;
  saved?: boolean;
}

/** Ordered terminal input, not an interpreter script. Delay and Enter are preserved. */
export function MacroEditor({
  macro,
  onChange,
  onSave,
  onDelete,
  onDuplicate,
  disabled = false,
  saved = true,
}: MacroEditorProps) {
  const id = useId();
  const [tagDraft, setTagDraft] = useState({
    text: macro.tags?.join(", ") ?? "",
    parsed: JSON.stringify(macro.tags ?? []),
  });
  const field = <K extends keyof TerminalMacro>(
    key: K,
    value: TerminalMacro[K],
  ) => onChange({ ...macro, [key]: value });
  const step = (index: number, patch: Partial<MacroStep>) =>
    field(
      "steps",
      macro.steps.map((item, at) =>
        at === index ? { ...item, ...patch } : item,
      ),
    );
  const move = (index: number, direction: -1 | 1) => {
    const next = [...macro.steps],
      to = index + direction;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    field("steps", next);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="sr-only">Terminal macro editor</legend>
      <p className="text-xs text-[var(--color-textSecondary)]">
        Terminal input sequence. Review the target session and every command
        before replay. Saving does not execute commands.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-name`} className="space-y-1 text-xs">
          Name
          <input
            id={`${id}-name`}
            value={macro.name}
            maxLength={256}
            onChange={(event) => field("name", event.target.value)}
            className="sor-form-input w-full"
          />
        </label>
        <label htmlFor={`${id}-category`} className="space-y-1 text-xs">
          Category
          <input
            id={`${id}-category`}
            value={macro.category ?? ""}
            maxLength={256}
            onChange={(event) => field("category", event.target.value)}
            className="sor-form-input w-full"
          />
        </label>
      </div>
      <label htmlFor={`${id}-description`} className="block space-y-1 text-xs">
        Description
        <textarea
          id={`${id}-description`}
          value={macro.description ?? ""}
          maxLength={4096}
          onChange={(event) => field("description", event.target.value)}
          rows={2}
          className="sor-form-input w-full"
        />
      </label>
      <label htmlFor={`${id}-tags`} className="block space-y-1 text-xs">
        Tags (comma-separated)
        <input
          id={`${id}-tags`}
          value={
            tagDraft.parsed === JSON.stringify(macro.tags ?? [])
              ? tagDraft.text
              : (macro.tags?.join(", ") ?? "")
          }
          onChange={(event) => {
            const tags = event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
            setTagDraft({
              text: event.target.value,
              parsed: JSON.stringify(tags),
            });
            field("tags", tags);
          }}
          className="sor-form-input w-full"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Steps ({macro.steps.length})</h3>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={macro.steps.length >= 10000}
          onClick={() =>
            field("steps", [
              ...macro.steps,
              { command: "", delayMs: 200, sendNewline: true },
            ])
          }
        >
          <Plus size={14} />
          Add step
        </button>
      </div>
      <ol className="space-y-3">
        {macro.steps.map((item, index) => (
          <li
            key={index}
            className="min-w-0 rounded border border-[var(--color-border)] p-3"
          >
            <div className="mb-2 flex items-center gap-1">
              <span className="mr-auto text-xs">Step {index + 1}</span>
              <button
                type="button"
                aria-label={`Move step ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                className="sor-icon-btn"
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                aria-label={`Move step ${index + 1} down`}
                disabled={index === macro.steps.length - 1}
                onClick={() => move(index, 1)}
                className="sor-icon-btn"
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                aria-label={`Remove step ${index + 1}`}
                onClick={() =>
                  field(
                    "steps",
                    macro.steps.filter((_, at) => at !== index),
                  )
                }
                className="sor-icon-btn text-error"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <label className="block space-y-1 text-xs">
              Command {index + 1}
              <textarea
                value={item.command}
                maxLength={65536}
                rows={2}
                onChange={(event) =>
                  step(index, { command: event.target.value })
                }
                className="sor-form-input w-full font-mono"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2">
                Delay after step (ms)
                <input
                  type="number"
                  aria-label={`Step ${index + 1} delay`}
                  min={0}
                  max={3600000}
                  step={50}
                  value={item.delayMs}
                  onChange={(event) =>
                    step(index, {
                      delayMs: Math.max(
                        0,
                        Math.min(3600000, Number(event.target.value) || 0),
                      ),
                    })
                  }
                  className="sor-form-input w-24"
                  style={{ width: "6rem" }}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.sendNewline}
                  onChange={(event) =>
                    step(index, { sendNewline: event.target.checked })
                  }
                />
                Send Enter after step {index + 1}
              </label>
            </div>
          </li>
        ))}
      </ol>
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={!macro.name.trim()}
          onClick={() => onSave(macro)}
        >
          <Save size={14} />
          Save macro
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          onClick={() => onDuplicate(macro)}
        >
          <Copy size={14} />
          Duplicate as draft
        </button>
        {saved && (
          <button
            type="button"
            className="sor-btn sor-btn-danger ml-auto"
            onClick={() => onDelete(macro.id)}
          >
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>
    </fieldset>
  );
}
