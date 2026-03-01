import React from "react";
import {
  Plus,
  Trash2,
  Save,
  Copy,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Clock,
} from "lucide-react";
import { TerminalMacro, MacroStep } from "../../types/macroTypes";
import { Checkbox, NumberInput } from '../ui/forms';

interface MacroEditorProps {
  macro: TerminalMacro;
  onChange: (m: TerminalMacro) => void;
  onSave: (m: TerminalMacro) => void;
  onDelete: (id: string) => void;
  onDuplicate: (m: TerminalMacro) => void;
}

export const MacroEditor: React.FC<MacroEditorProps> = ({
  macro,
  onChange,
  onSave,
  onDelete,
  onDuplicate,
}) => {
  const updateField = <K extends keyof TerminalMacro>(
    key: K,
    value: TerminalMacro[K],
  ) => {
    onChange({ ...macro, [key]: value });
  };

  const updateStep = (idx: number, patch: Partial<MacroStep>) => {
    const steps = [...macro.steps];
    steps[idx] = { ...steps[idx], ...patch };
    onChange({ ...macro, steps });
  };

  const addStep = () => {
    onChange({
      ...macro,
      steps: [...macro.steps, { command: "", delayMs: 200, sendNewline: true }],
    });
  };

  const removeStep = (idx: number) => {
    const steps = macro.steps.filter((_, i) => i !== idx);
    onChange({
      ...macro,
      steps:
        steps.length > 0
          ? steps
          : [{ command: "", delayMs: 200, sendNewline: true }],
    });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= macro.steps.length) return;
    const steps = [...macro.steps];
    [steps[idx], steps[target]] = [steps[target], steps[idx]];
    onChange({ ...macro, steps });
  };

  return (
    <div className="space-y-4">
      {/* Name + Category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[var(--color-textSecondary)] mb-1">
            Name
          </label>
          <input
            value={macro.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-[var(--color-textSecondary)] mb-1">
            Category
          </label>
          <input
            value={macro.category || ""}
            onChange={(e) =>
              updateField("category", e.target.value || undefined)
            }
            placeholder="General"
            className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-textSecondary)] mb-1">
          Description
        </label>
        <input
          value={macro.description || ""}
          onChange={(e) =>
            updateField("description", e.target.value || undefined)
          }
          placeholder="Optional description..."
          className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:border-blue-500 outline-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-textSecondary)] mb-1">
          Tags (comma-separated)
        </label>
        <input
          value={macro.tags?.join(", ") || ""}
          onChange={(e) =>
            updateField(
              "tags",
              e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
          placeholder="e.g. deploy, linux, restart"
          className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:border-blue-500 outline-none"
        />
      </div>

      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] uppercase tracking-widest text-[var(--color-textSecondary)]">
            Steps ({macro.steps.length})
          </label>
          <button
            onClick={addStep}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            <Plus size={12} /> Add Step
          </button>
        </div>
        <div className="space-y-2">
          {macro.steps.map((step, i) => (
            <div
              key={i}
              className="flex items-start gap-2 p-2 bg-[var(--color-surface)]/60 border border-[var(--color-border)]/50 rounded"
            >
              <div className="flex flex-col items-center gap-0.5 pt-1">
                <button
                  onClick={() => moveStep(i, -1)}
                  className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]"
                  disabled={i === 0}
                >
                  <ChevronUp size={12} />
                </button>
                <GripVertical size={12} className="text-[var(--color-textMuted)]" />
                <button
                  onClick={() => moveStep(i, 1)}
                  className="text-[var(--color-textMuted)] hover:text-[var(--color-textSecondary)]"
                  disabled={i === macro.steps.length - 1}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  value={step.command}
                  onChange={(e) => updateStep(i, { command: e.target.value })}
                  placeholder="Command..."
                  className="w-full px-2 py-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)] font-mono placeholder-[var(--color-textMuted)] focus:border-blue-500 outline-none"
                />
                <div className="flex items-center gap-3 text-xs text-[var(--color-textSecondary)]">
                  <label className="flex items-center gap-1.5">
                    <Clock size={10} />
                    <NumberInput value={step.delayMs} onChange={(v: number) => updateStep(i, {
                          delayMs: v,
                        })} className="w-16 px-1.5 py-0.5 bg-[var(--color-background)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] outline-none" min={0} />
                    ms
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={step.sendNewline} onChange={(v: boolean) => updateStep(i, { sendNewline: v })} className="rounded border-[var(--color-border)]" />
                    Send Enter
                  </label>
                </div>
              </div>
              <button
                onClick={() => removeStep(i)}
                className="p-1 text-[var(--color-textMuted)] hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
        <button
          onClick={() => onSave(macro)}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] text-sm rounded-lg"
        >
          <Save size={14} /> Save
        </button>
        <button
          onClick={() => onDuplicate(macro)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-border)] hover:bg-[var(--color-border)] text-[var(--color-text)] text-sm rounded-lg"
        >
          <Copy size={14} /> Duplicate
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onDelete(macro.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-sm rounded-lg"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
};
