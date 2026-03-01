import { useState } from "react";

const CipherSelector: React.FC<{
  label: string;
  value: string[];
  onChange: (values: string[]) => void;
  options: string[];
}> = ({ value, onChange, options }) => {
  const [showAll, setShowAll] = useState(false);

  const toggleOption = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  const visible = showAll ? options : options.slice(0, 4);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {visible.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggleOption(option)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${
              value.includes(option)
                ? "bg-blue-600 text-[var(--color-text)]"
                : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-secondary)]"
            }`}
          >
            {option.split("@")[0]}
          </button>
        ))}
        {options.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="px-2 py-0.5 text-xs bg-[var(--color-border)] text-[var(--color-textSecondary)] rounded hover:bg-[var(--color-border)]"
          >
            {showAll ? "Less..." : `+${options.length - 4} more...`}
          </button>
        )}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-[var(--color-textMuted)]">
          Selected: {value.length} (in order of preference)
        </div>
      )}
    </div>
  );
};

export default CipherSelector;
