import type { ReactNode } from "react";

export interface RloginEditorSectionFrameProps {
  id: string;
  title: string;
  description: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function RloginEditorSectionFrame({
  id,
  title,
  description,
  icon,
  children,
  className = "",
}: RloginEditorSectionFrameProps) {
  const headingId = `${id}-heading`;
  const descriptionId = `${id}-description`;
  const searchSectionId = id.endsWith("-section")
    ? id.slice(0, -"-section".length)
    : id;
  return (
    <section
      id={id}
      data-editor-search-section={searchSectionId}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      className={`space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className}`}
    >
      <header className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 text-primary" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3
            id={headingId}
            className="text-sm font-semibold text-[var(--color-text)]"
          >
            {title}
          </h3>
          <p
            id={descriptionId}
            className="mt-1 text-xs leading-5 text-[var(--color-textMuted)]"
          >
            {description}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}

export function RloginFieldError({
  id,
  error,
}: {
  id: string;
  error?: string;
}) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger">
      {error}
    </p>
  );
}
