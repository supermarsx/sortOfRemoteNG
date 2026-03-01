import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * CollapsibleSection — Shared expandable section wrapper.
 *
 * Supports two modes:
 * - **uncontrolled** (default): manages its own `open` state via `defaultOpen`
 * - **controlled**: pass `open` + `onToggle` for external state management
 *
 *   <CollapsibleSection title="Advanced" icon={<Settings className="w-4 h-4" />}>
 *     ...
 *   </CollapsibleSection>
 */
export const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  /** Uncontrolled initial state */
  defaultOpen?: boolean;
  /** Controlled mode: current open state */
  open?: boolean;
  /** Controlled mode: toggle handler */
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}> = ({
  title,
  icon,
  badge,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children,
  className,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const toggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  };

  return (
    <div
      className={`border border-[var(--color-border)] rounded-md overflow-hidden ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-surfaceHover)]/30 hover:bg-[var(--color-border)] transition-colors text-sm font-medium text-[var(--color-textSecondary)]"
      >
        <span className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
          {icon}
          {title}
        </span>
        {badge}
      </button>
      {isOpen && (
        <div className="p-3 space-y-3 border-t border-[var(--color-border)]">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleSection;
