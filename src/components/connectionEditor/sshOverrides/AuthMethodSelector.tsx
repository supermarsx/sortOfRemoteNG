import { SSHAuthMethod, SSHAuthMethods } from "../../../types/settings";
import { Checkbox } from "../../ui/forms";

const AuthMethodSelector: React.FC<{
  value: SSHAuthMethod[];
  onChange: (methods: SSHAuthMethod[]) => void;
}> = ({ value, onChange }) => {
  const toggleMethod = (method: SSHAuthMethod) => {
    if (value.includes(method)) {
      onChange(value.filter((m) => m !== method));
    } else {
      onChange([...value, method]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const nv = [...value];
    [nv[index - 1], nv[index]] = [nv[index], nv[index - 1]];
    onChange(nv);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {SSHAuthMethods.map((method) => (
          <label
            key={method}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
              value.includes(method)
                ? "bg-green-600 text-[var(--color-text)]"
                : "bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] hover:bg-[var(--color-secondary)]"
            }`}
          >
            <Checkbox checked={value.includes(method)} onChange={() => toggleMethod(method)} className="sr-only" />
            {method}
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div className="text-xs text-[var(--color-textSecondary)]">
          Order:{" "}
          {value.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => moveUp(i)}
              className="mx-0.5 px-1 py-0.5 bg-[var(--color-border)] rounded hover:bg-[var(--color-border)]"
              title="Click to move up"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AuthMethodSelector;
