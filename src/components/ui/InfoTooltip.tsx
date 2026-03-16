import React from 'react';
import { Info } from 'lucide-react';

/**
 * Reusable inline info icon that shows a tooltip on hover.
 *
 * Usage:
 *   <label>Field Name <InfoTooltip text="Description of what this does" /></label>
 *
 * Uses the app's existing `data-tooltip` system (handled by App.tsx's
 * MutationObserver). Supports translatable strings — pass the already-
 * translated string as `text`.
 */
export const InfoTooltip: React.FC<{
  /** Tooltip text to show on hover */
  text: string;
  /** Icon size in pixels (default 12) */
  size?: number;
  /** Additional className */
  className?: string;
}> = ({ text, size = 12, className }) => (
  <Info
    size={size}
    className={`inline-block text-[var(--color-textMuted)] cursor-help flex-shrink-0 ${className ?? ''}`}
    data-tooltip={text}
  />
);

export default InfoTooltip;
