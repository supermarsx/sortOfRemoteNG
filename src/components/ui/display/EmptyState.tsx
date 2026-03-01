import React from 'react';
import { type LucideIcon } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface EmptyStateProps {
  /** Lucide icon to display above the message */
  icon: LucideIcon;
  /** Icon size in pixels (default 32) */
  iconSize?: number;
  /** Primary message text */
  message: string;
  /** Optional hint/subtitle text below the message */
  hint?: string;
  /** Additional className on the wrapper */
  className?: string;
  children?: React.ReactNode;
}

/**
 * Centered empty state placeholder with icon, message, and optional hint.
 * Used in managers, panels, and viewers when a list has no items.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  iconSize = 32,
  message,
  hint,
  className,
  children,
}) => (
  <div className={cx('flex flex-col items-center justify-center py-12 text-[var(--color-textSecondary)]', className)}>
    <Icon size={iconSize} className="mb-3 opacity-50" />
    <p className="text-sm">{message}</p>
    {hint && <p className="text-xs mt-1 opacity-70">{hint}</p>}
    {children}
  </div>
);
