import type { ReactNode } from "react";

interface PowerShellEditorSectionProps {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}

/** Flat editor card. It intentionally has no disclosure/accordion behavior. */
export function PowerShellEditorSection({
  id,
  title,
  description,
  icon,
  status,
  children,
}: PowerShellEditorSectionProps) {
  const headingId = `powershell-${id}-heading`;
  return (
    <section
      data-powershell-section={id}
      aria-labelledby={headingId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-primary" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <h3
              id={headingId}
              className="text-sm font-semibold text-[var(--color-text)]"
            >
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--color-textMuted)]">
              {description}
            </p>
          </div>
        </div>
        {status}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function CapabilityBadge({
  status,
}: {
  status: "supported" | "partial" | "unsupported";
}) {
  const label =
    status === "supported"
      ? "Supported"
      : status === "partial"
        ? "Limited"
        : "Unavailable";
  const colors =
    status === "supported"
      ? "border-success/40 text-success"
      : status === "partial"
        ? "border-warning/40 text-warning"
        : "border-error/40 text-error";
  return (
    <span
      className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium ${colors}`}
    >
      {label}
    </span>
  );
}

export function CapabilityNotice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning" | "error";
  children: ReactNode;
}) {
  const colors =
    tone === "error"
      ? "border-error/30 bg-error/5 text-error"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5 text-warning"
        : "border-[var(--color-border)] bg-[var(--color-surfaceElevated)] text-[var(--color-textMuted)]";
  return (
    <p className={`rounded border px-3 py-2 text-xs ${colors}`}>{children}</p>
  );
}
