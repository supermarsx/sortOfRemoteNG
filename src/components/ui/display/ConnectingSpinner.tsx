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
  /**
   * Spinner color. Note: color now reflects the user's theme/accent by default
   * via <LoadingElement>. Tailwind class names (e.g. "border-primary") are
   * ignored — only raw CSS color strings (#hex, rgb(...), hsl(...), var(...))
   * are forwarded as a per-call override.
   */
  color?: string;
  /** Additional className on the outer wrapper */
  className?: string;
}

/** Looks like a CSS color value (vs a tailwind class)? */
function isCssColor(value: string | undefined): value is string {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('var');
}

/**
 * Centered connecting / loading spinner with optional status text.
 * Used as an overlay or placeholder in client views during connection setup.
 *
 * NOTE: `color` now reflects the user's theme/accent by default. The legacy
 * tailwind-class form (e.g. "border-primary") is accepted for API
 * compatibility but is ignored at runtime; pass a CSS color string to
 * override per-call.
 */
export const ConnectingSpinner: React.FC<ConnectingSpinnerProps> = ({
  message = 'Connecting...',
  detail,
  statusMessage,
  color = 'border-primary',
  className,
}) => {
  const colorOverride = isCssColor(color) ? color : undefined;
  return (
    <div className={cx('text-center', className)}>
      <LoadingElement.Overlay
        message={message}
        detail={detail}
        statusMessage={statusMessage}
        {...(colorOverride ? { color: colorOverride } : {})}
      />
    </div>
  );
};
