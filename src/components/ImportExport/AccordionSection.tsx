import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface AccordionSectionProps {
  id: string;
  title: string;
  description?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dataTestId?: string;
}

/**
 * Shared accordion shell used by `ExportTab` and `CloneTab` so both
 * halves of the Import/Export tool share the same look + a11y
 * surface (aria-controls, expand/collapse via button, keyboard
 * focus path).
 */
export const AccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  title,
  description,
  icon: Icon,
  badge,
  open,
  onToggle,
  children,
  dataTestId,
}) => (
  <section
    aria-labelledby={`${id}-heading`}
    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceElevated)]"
    data-testid={dataTestId}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`${id}-panel`}
      className="flex w-full items-center gap-3 px-4 py-3 text-left"
    >
      <span className="text-[var(--color-textSecondary)] shrink-0">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <Icon size={16} className="text-primary shrink-0" />
      <span className="flex-1 min-w-0">
        <span
          id={`${id}-heading`}
          className="block text-sm font-medium text-[var(--color-text)]"
        >
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-[var(--color-textSecondary)]">
            {description}
          </span>
        )}
      </span>
      {badge && <span className="shrink-0 text-xs">{badge}</span>}
    </button>
    {open && (
      <div
        id={`${id}-panel`}
        className="border-t border-[var(--color-border)] px-4 py-3 space-y-3"
      >
        {children}
      </div>
    )}
  </section>
);
