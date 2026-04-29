/**
 * CometTrails — pure-CSS variant ported from .orb-previews/B-orbiting-motes.html.
 *
 * Tick-marked rim + N orbital rings, each carrying a "mote" head with two
 * trailing dots (::before, ::after) for a comet streak. Optional split-tone:
 * the second strand uses `secondaryColor` instead of the primary.
 */

import { type CSSProperties, type FC } from 'react';

import { DEFAULT_COMET_TRAILS } from '../defaults';
import type { VariantDescriptor, VariantRenderProps } from '../types';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const RING_PERIODS = [1.6, 2.4, 3.6, 5.0]; // base seconds, scaled by trailSpeed

const CometTrailsVariant: FC<VariantRenderProps<'cometTrails'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const { motes, trailSpeed, coreSpeed, splitTone, secondaryColor } = config;
  const ringCount = Math.max(1, Math.min(4, Math.round(motes)));

  const motePx = size * 0.13;
  const moteHalf = size * 0.065;
  const playState = paused ? 'paused' : 'running';
  const animMode = reducedMotion ? 'none' : undefined;

  const rootStyle: CSSVars = {
    position: 'relative',
    width: size,
    height: size,
    color,
    display: 'inline-block',
    ...(style ?? {}),
  };

  const rimMask =
    'radial-gradient(circle, transparent calc(50% - 1px), black calc(50% - 1px), black 50%, transparent 50%)';

  // Per-ring rotation animation. Each ring has a unique full-spin direction
  // matching the source HTML (r1 forward, r2 reverse, r3 forward, r4 reverse).
  const ringAnimNames = ['ct-r1', 'ct-r2', 'ct-r3', 'ct-r4'];

  return (
    <span
      className={className}
      role="status"
      aria-label={ariaLabel ?? 'Loading'}
      style={rootStyle}
    >
      <style>{`
        @keyframes ct-r1 { to   { transform: rotate(360deg); } }
        @keyframes ct-r2 { from { transform: rotate(140deg); } to { transform: rotate(-220deg); } }
        @keyframes ct-r3 { from { transform: rotate(260deg); } to { transform: rotate(620deg); } }
        @keyframes ct-r4 { from { transform: rotate(60deg);  } to { transform: rotate(-300deg); } }
        @keyframes ct-corebeat {
          0%, 100% { transform: scale(1);   filter: brightness(1.1); }
          50%      { transform: scale(0.78); filter: brightness(0.7); }
        }
      `}</style>

      {/* tick-marked outer rim */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'conic-gradient(from 0deg, currentColor 0 2deg, transparent 2deg 12deg) center / 100% 100%',
          WebkitMask: rimMask,
          mask: rimMask,
          opacity: 0.35,
        }}
      />

      {/* dotted core */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '36%',
          borderRadius: '50%',
          background: 'currentColor',
          boxShadow: `0 0 ${size * 0.18}px currentColor, 0 0 ${size * 0.4}px currentColor, inset 0 0 ${size * 0.05}px #fff`,
          animation: animMode ?? `ct-corebeat ${coreSpeed}s steps(2, end) infinite`,
          animationPlayState: playState,
        }}
      />

      {/* orbital rings, each carrying one mote */}
      {Array.from({ length: ringCount }, (_, i) => {
        const period = (RING_PERIODS[i] ?? RING_PERIODS[0]) / Math.max(0.1, trailSpeed);
        const animName = ringAnimNames[i] ?? 'ct-r1';
        const moteColor = splitTone && i === 1 ? secondaryColor : color;

        // Each ring orientation differs: r1 mote sits at top center,
        // r2 sits at bottom (split-tone slot in source), r3 sits at left middle,
        // r4 (added) sits at right middle.
        const slot: CSSProperties = (() => {
          if (i === 1) return { top: 'auto', bottom: 0, left: '50%', marginLeft: -moteHalf };
          if (i === 2) return { top: '50%', left: 0, marginTop: -moteHalf, marginLeft: 0 };
          if (i === 3) return { top: '50%', right: 0, marginTop: -moteHalf, marginLeft: 0, left: 'auto' };
          return { top: 0, left: '50%', marginLeft: -moteHalf };
        })();

        // For r2 the trailing dots flip direction (translate in -Y).
        const trailDirSign = i === 1 ? -1 : 1;

        return (
          <span
            key={`ring-${i}`}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              animation: animMode ?? `${animName} ${period}s linear infinite`,
              animationPlayState: playState,
            }}
          >
            <span
              style={{
                position: 'absolute',
                width: motePx,
                height: motePx,
                borderRadius: '50%',
                background: moteColor,
                color: moteColor,
                boxShadow: `0 0 ${size * 0.22}px ${moteColor}`,
                ...slot,
              }}
            >
              {/* leading trail dot (::before) */}
              <span
                style={{
                  position: 'absolute',
                  width: '60%',
                  height: '60%',
                  left: '20%',
                  top: 0,
                  borderRadius: '50%',
                  background: moteColor,
                  opacity: 0.55,
                  transform: `translateY(${180 * trailDirSign}%)`,
                  boxShadow: `0 0 8px ${moteColor}`,
                }}
              />
              {/* deeper trail dot (::after) */}
              <span
                style={{
                  position: 'absolute',
                  width: '35%',
                  height: '35%',
                  left: '32.5%',
                  top: 0,
                  borderRadius: '50%',
                  background: moteColor,
                  opacity: 0.25,
                  transform: `translateY(${440 * trailDirSign}%)`,
                }}
              />
            </span>
          </span>
        );
      })}
    </span>
  );
};

export default CometTrailsVariant;

export const descriptor: VariantDescriptor<'cometTrails'> = {
  type: 'cometTrails',
  label: 'Comet trails',
  description:
    'Comet-dot rings orbit a stuttering core inside a tick-marked rim. Optional split-tone for synthwave.',
  minRecommendedSize: 24,
  supportsCanvas: false,
  hasRaf: false,
  boundsBleed: 0.08,
  defaultConfig: DEFAULT_COMET_TRAILS,
  presets: [
    { id: 'default',   label: 'Default',   config: DEFAULT_COMET_TRAILS },
    { id: 'mono',      label: 'Mono',      config: { ...DEFAULT_COMET_TRAILS, splitTone: false } },
    { id: 'synthwave', label: 'Synthwave', config: { motes: 3, trailSpeed: 1.8, coreSpeed: 1.2, splitTone: true, secondaryColor: '#ff2bd6' } },
    { id: 'dense',     label: 'Dense',     config: { motes: 4, trailSpeed: 2.0, coreSpeed: 1.0, splitTone: true, secondaryColor: '#00f0ff' } },
  ],
  paramSchema: {
    fields: [
      { key: 'motes',          label: 'Orbital rings', kind: 'integer', min: 1, max: 4 },
      { key: 'trailSpeed',     label: 'Trail speed',   kind: 'number',  min: 0.5, max: 3, step: 0.1 },
      { key: 'coreSpeed',      label: 'Core beat',     kind: 'seconds', min: 0.5, max: 3, step: 0.1 },
      { key: 'splitTone',      label: 'Split-tone',    kind: 'boolean', help: 'Use the secondary color on the second ring.' },
      { key: 'secondaryColor', label: 'Secondary',     kind: 'color' },
    ],
  },
  component: CometTrailsVariant,
};
