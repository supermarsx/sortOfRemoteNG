// Shared UI atoms for the Portainer panel and its tabs (t64-e4).
import React from "react";
import type { PortainerManager } from "../../../hooks/integration/usePortainer";

export const field =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-text)]";
export const btn =
  "app-bar-button inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50";
export const card =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3";

export const Labeled: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-xs text-[var(--color-textSecondary)]">
    <span>{label}</span>
    {children}
  </label>
);

export const Toolbar: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <div className="flex flex-wrap items-center gap-2">{children}</div>;

export interface PortainerTabProps {
  mgr: PortainerManager;
}

/** Swallow op errors — `mgr.run` already surfaces them via `mgr.error`. */
export async function quiet(op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
  } catch {
    /* surfaced via mgr.error */
  }
}
