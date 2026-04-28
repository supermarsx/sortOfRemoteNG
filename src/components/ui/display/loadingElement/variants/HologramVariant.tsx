/**
 * Hologram — pure-CSS variant ported from .orb-previews/C-conic-shimmer.html.
 *
 * Pixel-mesh sphere (radial-gradient dots clipped by a soft mask) + a CRT
 * scanline that sweeps top-to-bottom + a flickering center pixel.
 */

import { type CSSProperties, type FC } from 'react';

import { DEFAULT_HOLOGRAM } from '../defaults';
import type { VariantDescriptor, VariantRenderProps } from '../types';

const HologramVariant: FC<VariantRenderProps<'hologram'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const { dotPitchPx, scanSpeed, flickerSpeed } = config;
  const playState = paused ? 'paused' : 'running';
  const animMode = reducedMotion ? 'none' : undefined;

  const pitch = Math.max(2, dotPitchPx);
  const pixelSize = size * 0.06;
  const pixelHalf = size * 0.03;

  const baseBg =
    `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${color} 22%, #06070d) 0%, #06070d 80%)`;

  const meshMask =
    'radial-gradient(circle at 50% 50%, black 38%, rgba(0,0,0,.6) 60%, transparent 80%)';

  const rootStyle: CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    borderRadius: '50%',
    color,
    display: 'inline-block',
    overflow: 'hidden',
    background: baseBg,
    boxShadow: `0 0 ${size * 0.35}px color-mix(in srgb, ${color} 60%, transparent), inset 0 0 ${size * 0.25}px rgba(0,0,0,.85), inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`,
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
        @keyframes hg-rot  { to { transform: rotate(360deg); } }
        @keyframes hg-scan {
          0%   { transform: translateY(-110%); }
          100% { transform: translateY(110%); }
        }
        @keyframes hg-flicker {
          0%, 90%, 100% { opacity: 1; }
          93%           { opacity: 0.2; }
        }
      `}</style>

      {/* dot mesh layer (::before equivalent) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-10%',
          background: `radial-gradient(circle, currentColor 1px, transparent 1.6px) 0 0 / ${pitch}px ${pitch}px`,
          WebkitMask: meshMask,
          mask: meshMask,
          opacity: 0.9,
          mixBlendMode: 'screen',
          animation: animMode ?? 'hg-rot 8s linear infinite',
          animationPlayState: playState,
        }}
      />

      {/* horizontal scanline sweep (::after equivalent) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, transparent 42%, currentColor 49%, #fff 50%, currentColor 51%, transparent 58%, transparent 100%)`,
          filter: 'blur(0.5px)',
          opacity: 0.9,
          pointerEvents: 'none',
          animation: animMode ?? `hg-scan ${scanSpeed}s linear infinite`,
          animationPlayState: playState,
        }}
      />

      {/* flickering center pixel */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: pixelSize,
          height: pixelSize,
          marginLeft: -pixelHalf,
          marginTop: -pixelHalf,
          background: '#fff',
          boxShadow: `0 0 ${size * 0.12}px currentColor, 0 0 ${size * 0.3}px currentColor`,
          animation: animMode ?? `hg-flicker ${flickerSpeed}s steps(2, end) infinite`,
          animationPlayState: playState,
        }}
      />
    </span>
  );
};

export default HologramVariant;

export const descriptor: VariantDescriptor<'hologram'> = {
  type: 'hologram',
  label: 'Hologram',
  description:
    'Pixel-mesh sphere with a CRT scanline crossing top-to-bottom and a flickering center pixel.',
  minRecommendedSize: 32,
  supportsCanvas: false,
  hasRaf: false,
  defaultConfig: DEFAULT_HOLOGRAM,
  presets: [
    { id: 'default', label: 'Default', config: DEFAULT_HOLOGRAM },
    { id: 'tight',   label: 'Tight mesh', config: { dotPitchPx: 5,    scanSpeed: 1.4, flickerSpeed: 1.2 } },
    { id: 'broadcast', label: 'Broadcast', config: { dotPitchPx: 8,   scanSpeed: 2.4, flickerSpeed: 2.0 } },
    { id: 'malfunction', label: 'Malfunction', config: { dotPitchPx: 6, scanSpeed: 0.8, flickerSpeed: 0.6 } },
  ],
  paramSchema: {
    fields: [
      { key: 'dotPitchPx',   label: 'Dot pitch',     kind: 'number',  min: 4,   max: 14, step: 0.5, help: 'Pixel-mesh grid spacing in px.' },
      { key: 'scanSpeed',    label: 'Scan period',   kind: 'seconds', min: 0.5, max: 4,  step: 0.1 },
      { key: 'flickerSpeed', label: 'Flicker period',kind: 'seconds', min: 0.5, max: 4,  step: 0.1 },
    ],
  },
  component: HologramVariant,
};
