import React from 'react';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface ConnectingSpinnerProps {
  /** Primary message, e.g. "Connecting to RDP server..." */
  message?: string;
  /** Detail line (hostname etc.) */
  detail?: string;
  /** Extra status line */
  statusMessage?: string;
  /** Border color class for the spinner ring (default "border-blue-400") */
  color?: string;
  /** Additional className on the outer wrapper */
  className?: string;
}

/**
 * Centered connecting / loading spinner with optional status text.
 * Used as an overlay or placeholder in client views during connection setup.
 */
export const ConnectingSpinner: React.FC<ConnectingSpinnerProps> = ({
  message = 'Connecting...',
  detail,
  statusMessage,
  color = 'border-blue-400',
  className,
}) => (
  <div className={cx('text-center', className)}>
    <div
      className={cx(
        'animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4',
        color,
      )}
    />
    <p className="text-[var(--color-textSecondary)]">{message}</p>
    {detail && <p className="text-[var(--color-textMuted)] text-sm mt-2">{detail}</p>}
    {statusMessage && <p className="text-[var(--color-textMuted)] text-xs mt-1">{statusMessage}</p>}
  </div>
);
