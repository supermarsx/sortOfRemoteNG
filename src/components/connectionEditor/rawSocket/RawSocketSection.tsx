import type { LucideIcon } from "lucide-react";
import type { PropsWithChildren } from "react";

interface RawSocketSectionProps extends PropsWithChildren {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export function RawSocketSection({
  id,
  title,
  description,
  icon: Icon,
  children,
}: RawSocketSectionProps) {
  const headingId = `raw-socket-${id}-heading`;
  return (
    <section
      id={`raw-socket-section-${id}`}
      aria-labelledby={headingId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4"
    >
      <div className="flex items-start gap-3">
        <Icon
          size={17}
          aria-hidden="true"
          className="mt-0.5 flex-shrink-0 text-primary"
        />
        <div>
          <h3
            id={headingId}
            className="text-sm font-semibold text-[var(--color-text)]"
          >
            {title}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-textMuted)]">
            {description}
          </p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function RawSocketField({
  id,
  label,
  description,
  children,
}: PropsWithChildren<{ id: string; label: string; description?: string }>) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-[var(--color-textSecondary)]"
      >
        {label}
      </label>
      {children}
      {description && (
        <p
          id={descriptionId}
          className="text-xs leading-relaxed text-[var(--color-textMuted)]"
        >
          {description}
        </p>
      )}
    </div>
  );
}

export const rawSocketInputClass = "sor-form-input text-sm w-full";
export const rawSocketSelectClass = "sor-form-select text-sm w-full";
