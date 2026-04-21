import React from "react";

/** Collapsible section with a title label. */
export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="mt-6">
    <h4 className="mb-2 text-sm font-medium text-text-secondary">{title}</h4>
    {children}
  </div>
);

/** Small stat card used in detail grids. */
export const InfoCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
}> = ({ label, value, sub }) => (
  <div className="rounded-lg border border-theme-border bg-surface px-4 py-3">
    <div className="text-xs text-text-secondary">{label}</div>
    <div className="mt-0.5 text-sm font-medium text-[var(--color-text)]">{value}</div>
    {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
  </div>
);
