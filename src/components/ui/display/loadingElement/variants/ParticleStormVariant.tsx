/**
 * ParticleStorm — pure-CSS variant ported from .orb-previews/D-liquid-wisp.html.
 *
 * Two counter-drifting dot fields inside a glowing rim + a hot white core.
 */

import { type CSSProperties, type FC } from 'react';

import { DEFAULT_PARTICLE_STORM } from '../defaults';
import type { VariantDescriptor, VariantRenderProps } from '../types';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const ParticleStormVariant: FC<VariantRenderProps<'particleStorm'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const { fieldDensity, driftSpeed, pulseSpeed } = config;
  const playState = paused ? 'paused' : 'running';
  const animMode = reducedMotion ? 'none' : undefined;

  // Higher density → tighter pitch (more dots in the same disc).
  const density = Math.max(0.5, Math.min(2, fieldDensity));
  const pitchA = (size * 0.07) / density;
  const pitchB = (size * 0.13) / density;

  const driftEndA = `${size * 0.7}px ${size * -0.5}px`;
  const driftEndB = `${size * -0.9}px ${size * 0.6}px`;

  const coreSize = size * 0.14;
  const coreHalf = size * 0.07;

  const baseBg =
    `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${color} 14%, #06070d) 0%, #04050a 85%)`;

  const maskA = 'radial-gradient(circle at 50% 50%, black 50%, transparent 78%)';
  const maskB = 'radial-gradient(circle at 50% 50%, black 35%, transparent 75%)';

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    borderRadius: '50%',
    color,
    display: 'inline-block',
    overflow: 'hidden',
    background: baseBg,
    boxShadow: `0 0 ${size * 0.4}px color-mix(in srgb, ${color} 65%, transparent), inset 0 0 ${size * 0.18}px rgba(0,0,0,.9), inset 0 0 0 1px color-mix(in srgb, ${color} 55%, transparent)`,
    ...(style ?? {}),
  };

  return (
    <span
      className={className}
      role="status"
      aria-label={ariaLabel ?? 'Loading'}
      style={rootStyle}
    >
      <style>{`
        @keyframes ps-drift     { 0% { background-position: 0 0; } 100% { background-position: var(--ps-drift-end); } }
        @keyframes ps-drift-rev { 0% { background-position: 0 0; } 100% { background-position: var(--ps-drift-end-rev); } }
        @keyframes ps-pulse {
          0%, 100% { filter: brightness(1); }
          50%      { filter: brightness(1.5); }
        }
        @keyframes ps-corebeat {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50%      { transform: translate(-50%, -50%) scale(0.6); opacity: 0.7; }
        }
      `}</style>

      {/* dot field A (::before equivalent) — drifts + brightness pulse */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-20%',
          background: `radial-gradient(circle, currentColor 1px, transparent 1.6px) 0 0 / ${pitchA}px ${pitchA}px`,
          WebkitMask: maskA,
          mask: maskA,
          opacity: 0.55,
          mixBlendMode: 'screen',
          '--ps-drift-end': driftEndA,
          animation:
            animMode ?? `ps-drift ${driftSpeed}s linear infinite, ps-pulse ${pulseSpeed}s ease-in-out infinite`,
          animationPlayState: playState,
        } as CSSVars}
      />

      {/* dot field B (::after equivalent) — counter-drifts at different scale */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-20%',
          background: `radial-gradient(circle, currentColor 1.2px, transparent 1.8px) 0 0 / ${pitchB}px ${pitchB}px`,
          WebkitMask: maskB,
          mask: maskB,
          opacity: 0.8,
          mixBlendMode: 'screen',
          '--ps-drift-end-rev': driftEndB,
          animation: animMode ?? `ps-drift-rev ${driftSpeed * 1.5}s linear infinite`,
          animationPlayState: playState,
        } as CSSVars}
      />

      {/* hot white core */}
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
          background: '#fff',
          boxShadow: `0 0 ${size * 0.18}px currentColor, 0 0 ${size * 0.45}px currentColor`,
          transform: 'translate(-50%, -50%)',
          animation: animMode ?? `ps-corebeat ${pulseSpeed / 2}s steps(2, end) infinite`,
          animationPlayState: playState,
        }}
      />
    </span>
  );
};

export default ParticleStormVariant;

export const descriptor: VariantDescriptor<'particleStorm'> = {
  type: 'particleStorm',
  label: 'Particle storm',
  description:
    'Two counter-drifting dot fields inside a glowing rim, around a hot white pixel core.',
  minRecommendedSize: 24,
  supportsCanvas: false,
  hasRaf: false,
  boundsBleed: 0.05,
  defaultConfig: DEFAULT_PARTICLE_STORM,
  presets: [
    { id: 'default', label: 'Default', config: DEFAULT_PARTICLE_STORM },
    { id: 'sparse',  label: 'Sparse',  config: { fieldDensity: 0.7, driftSpeed: 8, pulseSpeed: 3 } },
    { id: 'dense',   label: 'Dense',   config: { fieldDensity: 1.6, driftSpeed: 5, pulseSpeed: 2 } },
    { id: 'lazy',    label: 'Lazy',    config: { fieldDensity: 1.0, driftSpeed: 11, pulseSpeed: 4 } },
  ],
  paramSchema: {
    fields: [
      { key: 'fieldDensity', label: 'Field density', kind: 'number',  min: 0.5, max: 2,  step: 0.1, help: 'Multiplier on dot grid density.' },
      { key: 'driftSpeed',   label: 'Drift speed',   kind: 'seconds', min: 3,   max: 12, step: 0.5 },
      { key: 'pulseSpeed',   label: 'Pulse period',  kind: 'seconds', min: 1,   max: 6,  step: 0.1 },
    ],
  },
  component: ParticleStormVariant,
};
