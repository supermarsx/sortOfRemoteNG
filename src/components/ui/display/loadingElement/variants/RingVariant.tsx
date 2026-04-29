/**
 * Ring variant — pure CSS spinner. Mirrors the legacy ConnectingSpinner ring:
 * a transparent circle with one colored bottom border, rotated by a CSS
 * keyframe animation. No rAF, no canvas.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_RING } from '../defaults';

const KEYFRAMES_INJECTED_FLAG = '__sorngRingKeyframesInjected';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_INJECTED_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-ring-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  w[KEYFRAMES_INJECTED_FLAG] = true;
}

const RingVariant: React.FC<VariantRenderProps<'ring'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  ensureKeyframes();

  const animation = reducedMotion
    ? undefined
    : `sorng-ring-spin ${config.speedSeconds}s linear infinite`;

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderBottomColor: color,
    borderWidth: config.thicknessPx,
    animation,
    animationPlayState: paused ? 'paused' : 'running',
    boxSizing: 'border-box',
    display: 'inline-block',
    ...style,
  };

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={className}
      style={rootStyle}
    />
  );
};

export const descriptor: VariantDescriptor<'ring'> = {
  type: 'ring',
  label: 'Ring',
  description: 'Classic spinning ring — minimal, fast, accessible.',
  minRecommendedSize: 12,
  supportsCanvas: false,
  hasRaf: false,
  boundsBleed: 0,
  recommendedRenderMode: 'dom',
  defaultConfig: DEFAULT_RING,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'thicknessPx', label: 'Thickness', kind: 'integer', min: 1, max: 6 },
      { key: 'speedSeconds', label: 'Spin period', kind: 'seconds', min: 0.3, max: 3, step: 0.1 },
    ],
  },
  component: RingVariant,
};

export default RingVariant;
