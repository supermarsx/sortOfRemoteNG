import React from 'react';
import { AlertCircle, XCircle } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface ErrorBannerProps {
  /** Error message to display. If null/empty, nothing is rendered. */
  error: string | null | undefined;
  /** Callback when the dismiss button is clicked */
  onClear: () => void;
  /** Use the smaller variant for side panels */
  compact?: boolean;
  /** Additional className */
  className?: string;
}

/**
 * Dismissible error banner used inside modals and panels.
 * Renders nothing when `error` is falsy.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onClear,
  compact = false,
  className,
}) => {
  if (!error) return null;

  return (
    <div
      className={cx(
        'bg-error/30 border border-error rounded-lg text-error flex items-center justify-between',
        compact
          ? 'mx-3 mt-2 px-2.5 py-1.5 text-xs flex-shrink-0'
          : 'mx-5 mt-3 px-3 py-2 text-sm',
        className,
      )}
    >
      <div className={cx('flex items-center', compact ? 'space-x-1.5' : 'space-x-2')}>
        <AlertCircle size={compact ? 12 : 14} />
        <span className={compact ? 'truncate' : undefined}>{error}</span>
      </div>
      <button onClick={onClear} className={cx('hover:text-error', compact && 'flex-shrink-0')}>
        <XCircle size={compact ? 12 : 14} />
      </button>
    </div>
  );
};
