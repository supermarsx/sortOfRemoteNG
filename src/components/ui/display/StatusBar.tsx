import React from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface StatusBarProps {
  /** Left-side content (session info, protocol, stats) */
  left: React.ReactNode;
  /** Right-side content (icons, labels) */
  right?: React.ReactNode;
  /** Additional className */
  className?: string;
}

/**
 * Horizontal status bar pinned to the bottom of client/viewer panels.
 * Displays session metadata on the left and indicator icons on the right.
 */
export const StatusBar: React.FC<StatusBarProps> = ({
  left,
  right,
  className,
}) => (
  <div
    className={cx(
      'bg-[var(--color-surface)] border-t border-[var(--color-border)] px-4 py-2 flex items-center justify-between text-xs text-[var(--color-textSecondary)]',
      className,
    )}
  >
    <div className="flex items-center space-x-4">{left}</div>
    {right && <div className="flex items-center space-x-2">{right}</div>}
  </div>
);
