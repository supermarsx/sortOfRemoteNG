import React from "react";
import { Checkbox } from "./forms";

/**
 * OverrideToggle — Shared row component for connection-level overrides.
 *
 * Shows a checkbox that enables/disables a per-connection override.
 * When enabled, renders children (form controls); when disabled,
 * shows the current global/default value in muted italic text.
 *
 *   <OverrideToggle label="Port" isOverridden={!!conn.portOverride}
 *     globalValue="22" onToggle={(on) => setOverride("port", on)}>
 *     <NumberInput ... />
 *   </OverrideToggle>
 */
export const OverrideToggle: React.FC<{
  label: string;
  isOverridden: boolean;
  globalValue: string;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}> = ({ label, isOverridden, globalValue, onToggle, children }) => (
  <div className="flex items-start gap-3">
    <label className="flex items-center gap-2 min-w-[140px]">
      <Checkbox
        checked={isOverridden}
        onChange={(v: boolean) => onToggle(v)}
        variant="form"
      />
      <span className="text-sm text-[var(--color-textSecondary)]">{label}</span>
    </label>
    <div className="flex-1">
      {isOverridden ? (
        children
      ) : (
        <span className="text-sm text-[var(--color-textMuted)] italic">
          Global: {globalValue}
        </span>
      )}
    </div>
  </div>
);

export default OverrideToggle;
