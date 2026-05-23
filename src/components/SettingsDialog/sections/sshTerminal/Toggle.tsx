import React from "react";
import { Checkbox } from "../../../ui/forms";

/**
 * SSH-section toggle row. Matches the look used elsewhere in the
 * settings dialog (EnableBackup, EnableSyncToggle, DifferentialSection
 * etc.): label + description on the left, large checkbox on the right,
 * full-row `justify-between` so a column of toggles aligns cleanly.
 */
const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer">
    <div className="min-w-0">
      <span className="text-[var(--color-text)]">{label}</span>
      {description && (
        <p className="text-xs text-[var(--color-textSecondary)] mt-0.5">
          {description}
        </p>
      )}
    </div>
    <Checkbox
      checked={checked}
      onChange={(v: boolean) => onChange(v)}
      className="sor-checkbox-lg flex-shrink-0"
    />
  </label>
);

export default Toggle;
