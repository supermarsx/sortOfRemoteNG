// Shared UI bits for the Nginx Proxy Manager panel tabs (t65-e4).

import React from "react";

export const npmField =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
export const npmBtn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
export const npmCard =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

export const Labeled: React.FC<{
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, children }) => (
  <label className="flex flex-col gap-1 text-xs" htmlFor={htmlFor}>
    <span className="text-[var(--color-textSecondary)]">{label}</span>
    {children}
  </label>
);

export const EnabledBadge: React.FC<{
  enabled: boolean | null | undefined;
  onLabel: string;
  offLabel: string;
}> = ({ enabled, onLabel, offLabel }) => (
  <span
    data-testid="npm-enabled-badge"
    data-enabled={enabled ? "true" : "false"}
    className={
      "rounded px-1.5 py-0.5 text-[10px] font-medium " +
      (enabled
        ? "bg-green-500/15 text-green-500"
        : "bg-[var(--color-border)] text-[var(--color-textSecondary)]")
    }
  >
    {enabled ? onLabel : offLabel}
  </span>
);

export const EmptyRow: React.FC<{ text: string }> = ({ text }) => (
  <p className="py-4 text-center text-xs text-[var(--color-textSecondary)]">
    {text}
  </p>
);

/** `true`/`1` → enabled (NPM returns 0/1 ints in some list endpoints). */
export function isEnabled(value: unknown): boolean {
  return value === true || value === 1;
}
