import { useState } from "react";

const CipherSelector: React.FC<{
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  options: string[];
}> = ({ label, value, onChange, options }) => {
  const [custom, setCustom] = useState("");
  const add = (name: string) => {
    if (
      /^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/.test(name) &&
      !value.includes(name)
    ) {
      onChange([...value, name]);
      setCustom("");
    }
  };
  const move = (index: number, direction: number) => {
    const next = [...value];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  };
  return (
    <div className="min-w-0 space-y-2" role="group" aria-label={label}>
      <p className="text-xs text-[var(--color-textSecondary)]">
        {value.length
          ? "Offered in this order. Use the arrows to change priority."
          : "Use the SSH library’s default list. An empty override does not inherit the global list."}
      </p>
      <ol className="space-y-1">
        {value.map((name, index) => (
          <li
            key={name}
            className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1"
          >
            <span className="min-w-0 flex-1 break-all font-mono text-xs">
              {index + 1}. {name}
            </span>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              aria-label={`Move ${name} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              aria-label={`Move ${name} down`}
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              aria-label={`Remove ${name}`}
              onClick={() => onChange(value.filter((item) => item !== name))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        {options
          .filter((name) => !value.includes(name))
          .map((name) => (
            <button
              key={name}
              type="button"
              className="sor-btn sor-btn-secondary break-all font-mono text-xs"
              onClick={() => add(name)}
              aria-label={`Add ${name}`}
            >
              {name}
            </button>
          ))}
      </div>
      <div className="flex gap-2">
        <input
          className="sor-form-input-sm min-w-0 flex-1"
          aria-label={`${label} algorithm name`}
          placeholder="Other algorithm name"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
        />
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={
            !/^[a-zA-Z0-9][a-zA-Z0-9@._+-]{0,127}$/.test(custom.trim()) ||
            value.includes(custom.trim())
          }
          onClick={() => add(custom.trim())}
        >
          Add
        </button>
      </div>
      <p className="text-xs text-[var(--color-textMuted)]">
        Availability depends on the installed SSH library and crypto provider.
        Names here are choices, not a guarantee of runtime support.
      </p>
    </div>
  );
};
export default CipherSelector;
