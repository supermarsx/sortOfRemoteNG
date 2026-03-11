import React from "react";
import { Checkbox } from "../../../ui/forms";

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex items-start gap-3 cursor-pointer group">
    <div className="relative flex-shrink-0 mt-0.5">
      <Checkbox checked={checked} onChange={(v: boolean) => onChange(v)} className="sr-only peer" />
      <div className="w-10 h-5 bg-[var(--color-border)] rounded-full peer-checked:bg-primary transition-colors" />
      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
    </div>
    <div className="flex-1">
      <span className="text-sm text-[var(--color-text)] group-hover:text-primary transition-colors">
        {label}
      </span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
  </label>
);

export default Toggle;
