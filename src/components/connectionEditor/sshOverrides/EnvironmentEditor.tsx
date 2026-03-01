import { useState } from "react";
import { Plus, X } from "lucide-react";

const EnvironmentEditor: React.FC<{
  value: Record<string, string>;
  onChange: (env: Record<string, string>) => void;
}> = ({ value, onChange }) => {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const addVariable = () => {
    if (newKey && newValue) {
      onChange({ ...value, [newKey]: newValue });
      setNewKey("");
      setNewValue("");
    }
  };

  const removeVariable = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  return (
    <div className="space-y-2">
      {Object.entries(value).map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-green-400">
            {key}
          </code>
          <span className="text-[var(--color-textMuted)]">=</span>
          <code className="px-2 py-1 text-xs bg-[var(--color-border)] rounded text-[var(--color-textSecondary)] flex-1 truncate">
            {val}
          </code>
          <button
            type="button"
            onClick={() => removeVariable(key)}
            className="p-1 text-red-400 hover:text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          className="sor-form-input-xs w-24"
        />
        <span className="text-[var(--color-textMuted)]">=</span>
        <input
          type="text"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="sor-form-input-xs flex-1"
        />
        <button
          type="button"
          onClick={addVariable}
          disabled={!newKey || !newValue}
          className="p-1 text-green-400 hover:text-green-300 disabled:text-[var(--color-textMuted)]"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default EnvironmentEditor;
