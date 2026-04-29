import React from 'react';
import { cx } from '../lib/cx';
import { LoadingElement } from './loadingElement';

export interface ConnectingSpinnerProps {
  /** Primary message, e.g. "Connecting to RDP server..." */
  message?: string;
  /** Detail line (hostname etc.) */
  detail?: string;
  /** Extra status line */
  statusMessage?: string;
  /** Additional className on the outer wrapper */
  className?: string;
}

/**
 * Centered connecting / loading spinner with optional status text.
 * Renders the user's configured Loading Element with the active theme accent.
 */
export const ConnectingSpinner: React.FC<ConnectingSpinnerProps> = ({
  message = 'Connecting...',
  detail,
  statusMessage,
  className,
}) => (
  <div className={cx('text-center', className)}>
    <LoadingElement.Overlay
      message={message}
      detail={detail}
      statusMessage={statusMessage}
    />
  </div>
);

export default ConnectingSpinner;
