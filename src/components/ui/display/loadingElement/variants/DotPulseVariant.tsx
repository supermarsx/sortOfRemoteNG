/**
 * DotPulse — pure-CSS variant ported from .orb-previews/A-pulsing-core.html.
 *
 * Halftone dot disc rotating + dotted shockwave rings + bright pulsing core.
 */

import { type CSSProperties, type FC } from 'react';

import { DEFAULT_DOT_PULSE } from '../defaults';
import type { VariantDescriptor, VariantRenderProps } from '../types';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const DotPulseVariant: FC<VariantRenderProps<'dotPulse'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const { coreSpeed, ringSpeed, rings } = config;
  const ringCount = Math.max(1, Math.min(4, Math.round(rings)));

  const dotPitch = size * 0.11;
  const coreSize = size * 0.18;
  const coreHalf = size * 0.09;

  const playState = paused ? 'paused' : 'running';
  const animMode = reducedMotion ? 'none' : undefined;

  const rootStyle: CSSVars = {
    position: 'relative',
    width: size,
    height: size,
    color,
    display: 'inline-block',
    '--dp-core-speed': `${coreSpeed}s`,
    '--dp-ring-speed': `${ringSpeed}s`,
    '--dp-play': playState,
    ...(style ?? {}),
  };

  const beforeBg = `radial-gradient(circle, currentColor 1px, transparent 1.4px) 0 0 / ${dotPitch}px ${dotPitch}px`;
  const beforeMask = 'radial-gradient(circle at 50% 50%, black 35%, transparent 72%)';

  const ringDelays = [0, ringSpeed / 3, (2 * ringSpeed) / 3, ringSpeed * 0.9];

  return (
    <span
      className={className}
      role="status"
      aria-label={ariaLabel ?? 'Loading'}
      style={rootStyle}
    >
      <style>{`
        @keyframes dp-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); filter: brightness(1); }
          50%      { transform: translate(-50%, -50%) scale(1.25); filter: brightness(1.3); }
        }
        @keyframes dp-shock {
          0%   { transform: scale(0.35); opacity: 0.9; border-style: dotted; }
          80%  { opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes dp-rot     { to { transform: rotate(360deg); } }
        @keyframes dp-rot-rev { to { transform: rotate(-360deg); } }
      `}</style>

      {/* halftone disc (::before equivalent) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: beforeBg,
          WebkitMask: beforeMask,
          mask: beforeMask,
          opacity: 0.55,
          animation: animMode ?? 'dp-rot 14s linear infinite',
          animationPlayState: playState,
        }}
      />
      {/* outer dashed ring (::after equivalent) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '4%',
          borderRadius: '50%',
          border: '1px dashed currentColor',
          opacity: 0.35,
          animation: animMode ?? 'dp-rot-rev 9s linear infinite',
          animationPlayState: playState,
        }}
      />

      {/* shockwave rings */}
      {Array.from({ length: ringCount }, (_, i) => (
        <span
          key={`ring-${i}`}
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '1px solid currentColor',
            opacity: 0,
            animation: animMode ?? `dp-shock ${ringSpeed}s linear infinite`,
            animationDelay: `${ringDelays[i] ?? 0}s`,
            animationPlayState: playState,
          }}
        />
      ))}

      {/* bright pulsing core */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: coreSize,
          height: coreSize,
          marginLeft: -coreHalf,
          marginTop: -coreHalf,
          borderRadius: '50%',
          background: 'currentColor',
          boxShadow: `0 0 ${size * 0.18}px currentColor, 0 0 ${size * 0.45}px currentColor`,
          // override the translate-based pulse keyframe — but we used translate inside
          // keyframes so we need to NOT set transform here.
          animation: animMode ?? `dp-pulse ${coreSpeed}s ease-in-out infinite`,
          animationPlayState: playState,
          // Keep core centered: keyframes use translate(-50%, -50%) scale(...).
          transform: 'translate(-50%, -50%)',
        }}
      />
    </span>
  );
};

export default DotPulseVariant;

export const descriptor: VariantDescriptor<'dotPulse'> = {
  type: 'dotPulse',
  label: 'Dot pulse',
  description:
    'Halftone dot disc rotating behind a hot core, with concentric dotted shockwaves rippling outward.',
  minRecommendedSize: 24,
  supportsCanvas: false,
  hasRaf: false,
  boundsBleed: 0.05,
  defaultConfig: DEFAULT_DOT_PULSE,
  presets: [
    { id: 'default',  label: 'Default',  config: DEFAULT_DOT_PULSE },
    { id: 'fast',     label: 'Fast',     config: { coreSpeed: 1.0, ringSpeed: 1.4, rings: 3 } },
    { id: 'serene',   label: 'Serene',   config: { coreSpeed: 2.4, ringSpeed: 4.0, rings: 2 } },
    { id: 'broadcast',label: 'Broadcast',config: { coreSpeed: 1.6, ringSpeed: 2.4, rings: 4 } },
  ],
  paramSchema: {
    fields: [
      { key: 'coreSpeed', label: 'Core pulse',     kind: 'seconds', min: 0.5, max: 3,   step: 0.1, help: 'Pulse animation duration in seconds.' },
      { key: 'ringSpeed', label: 'Shockwave',      kind: 'seconds', min: 0.8, max: 6,   step: 0.1, help: 'Shockwave period in seconds.' },
      { key: 'rings',     label: 'Concentric rings', kind: 'integer', min: 1, max: 4 },
    ],
  },
  component: DotPulseVariant,
};
