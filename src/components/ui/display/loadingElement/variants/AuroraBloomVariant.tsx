/**
 * Aurora bloom — pure CSS. Glassy sphere with four soft color blobs drifting
 * on irregular base periods (11s/14s/17s/13s), an outer halo that breathes
 * (auraSpeed), and a slow chromatic hue-rotate (hueRotateDeg).
 *
 * Faithful port of .orb-previews/F-aurora-bloom.html.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_AURORA_BLOOM } from '../defaults';

const KEYFRAMES_FLAG = '__sorngAuroraKeyframesInjected';
const KEYFRAMES = `
@keyframes sorng-aurora-aura {
  0%, 100% { transform: scale(1);    opacity: 0.5; }
  50%      { transform: scale(1.12); opacity: 0.75; }
}
@keyframes sorng-aurora-breathe {
  0%, 100% { filter: hue-rotate(0deg)   brightness(1); }
  50%      { filter: hue-rotate(var(--sorng-aurora-hue, 20deg)) brightness(1.08); }
}
@keyframes sorng-aurora-d1 {
  0%   { transform: translate(-10%,  -5%) scale(1.0); }
  20%  { transform: translate( 18%,  10%) scale(1.2); }
  45%  { transform: translate( -8%,  22%) scale(0.9); }
  65%  { transform: translate( 20%, -14%) scale(1.1); }
  85%  { transform: translate( -4%,   4%) scale(1.05); }
  100% { transform: translate(-10%,  -5%) scale(1.0); }
}
@keyframes sorng-aurora-d2 {
  0%   { transform: translate( 18%,  12%) scale(1.1); }
  25%  { transform: translate(-22%,  -4%) scale(0.95); }
  55%  { transform: translate(  6%, -18%) scale(1.25); }
  80%  { transform: translate(-12%,  20%) scale(0.9); }
  100% { transform: translate( 18%,  12%) scale(1.1); }
}
@keyframes sorng-aurora-d3 {
  0%   { transform: translate(  4%, -22%) scale(1.0); }
  30%  { transform: translate( 22%,   8%) scale(1.15); }
  60%  { transform: translate(-18%,  18%) scale(0.85); }
  85%  { transform: translate( -2%, -10%) scale(1.1); }
  100% { transform: translate(  4%, -22%) scale(1.0); }
}
@keyframes sorng-aurora-d4 {
  0%   { transform: translate(-22%,  20%) scale(0.95); }
  35%  { transform: translate( 14%,  18%) scale(1.2); }
  70%  { transform: translate( 22%, -14%) scale(0.9); }
  100% { transform: translate(-22%,  20%) scale(0.95); }
}
`;

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

const BASE_PERIODS = [11, 14, 17, 13];

const AuroraBloomVariant: React.FC<VariantRenderProps<'auroraBloom'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();
  const playState = paused ? 'paused' : 'running';
  const blobSpeed = Math.max(0.01, config.blobSpeed);
  const auraSeconds = Math.max(0.1, config.auraSpeed);
  const blobColors = [color, config.secondaryColor, config.tertiaryColor, config.quaternaryColor];

  const rootStyle: CSSProperties = {
    width: size, height: size, position: 'relative',
    borderRadius: '50%', isolation: 'isolate',
    ['--sorng-aurora-hue' as string]: `${config.hueRotateDeg}deg`,
    ...style,
  };

  const auraStyle: CSSProperties = {
    content: '""',
    position: 'absolute',
    inset: '-22%',
    borderRadius: '50%',
    background: `radial-gradient(circle at 50% 50%, ${color} 0%, transparent 55%)`,
    filter: `blur(${(size * 0.18).toFixed(2)}px)`,
    opacity: 0.55,
    animation: reducedMotion ? undefined : `sorng-aurora-aura ${auraSeconds}s ease-in-out infinite`,
    animationPlayState: playState,
    zIndex: 0,
    pointerEvents: 'none',
  };

  const sphereStyle: CSSProperties = {
    position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden',
    background:
      `radial-gradient(circle at 30% 25%,` +
      ` color-mix(in srgb, ${color} 65%, white) 0%,` +
      ` color-mix(in srgb, ${color} 40%, #06070d) 35%,` +
      ` #04050a 85%)`,
    boxShadow:
      `0 0 ${(size * 0.15).toFixed(2)}px color-mix(in srgb, ${color} 55%, transparent),` +
      ` inset 0 0 ${(size * 0.25).toFixed(2)}px rgba(0,0,0,.55),` +
      ` inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)`,
    zIndex: 1,
    animation: reducedMotion ? undefined : 'sorng-aurora-breathe 6s ease-in-out infinite',
    animationPlayState: playState,
  };

  const glossStyle: CSSProperties = {
    position: 'absolute', inset: 0, borderRadius: '50%',
    background:
      'radial-gradient(ellipse 55% 35% at 35% 25%, rgba(255,255,255,0.55) 0%, transparent 60%),' +
      ' radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 100%)',
    pointerEvents: 'none', zIndex: 3,
  };

  const blobBase: CSSProperties = {
    position: 'absolute', width: '80%', height: '80%', top: '10%', left: '10%',
    borderRadius: '50%',
    filter: `blur(${(size * 0.16).toFixed(2)}px)`,
    mixBlendMode: 'screen',
    opacity: 0.85,
    animationPlayState: playState,
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={rootStyle}>
      <div style={auraStyle} />
      <div style={sphereStyle}>
        {BASE_PERIODS.map((period, idx) => (
          <div
            key={idx}
            style={{
              ...blobBase,
              background: `radial-gradient(circle, ${blobColors[idx]} 0%, transparent 60%)`,
              animation: reducedMotion
                ? undefined
                : `sorng-aurora-d${idx + 1} ${(period / blobSpeed).toFixed(2)}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
      <div style={glossStyle} />
    </div>
  );
};

export const descriptor: VariantDescriptor<'auroraBloom'> = {
  type: 'auroraBloom',
  label: 'Aurora bloom',
  description: 'Glassy sphere with four soft color blobs drifting on irregular periods.',
  minRecommendedSize: 32,
  supportsCanvas: false,
  hasRaf: false,
  defaultConfig: DEFAULT_AURORA_BLOOM,
  presets: [
    { id: 'classic', label: 'Classic', config: {} },
    { id: 'cool', label: 'Cool dawn', config: { secondaryColor: '#7aa2ff', tertiaryColor: '#62e6c4', quaternaryColor: '#b48cff' } },
    { id: 'warm', label: 'Warm dusk', config: { secondaryColor: '#ff5555', tertiaryColor: '#ffcc00', quaternaryColor: '#ff7ad9' } },
  ],
  paramSchema: {
    fields: [
      { key: 'blobSpeed', label: 'Blob speed', kind: 'number', min: 0.2, max: 3, step: 0.05 },
      { key: 'auraSpeed', label: 'Aura period', kind: 'seconds', min: 3, max: 12, step: 0.5 },
      { key: 'hueRotateDeg', label: 'Hue breathe', kind: 'number', min: 0, max: 60, step: 1 },
      { key: 'secondaryColor', label: 'Color 2', kind: 'color' },
      { key: 'tertiaryColor', label: 'Color 3', kind: 'color' },
      { key: 'quaternaryColor', label: 'Color 4', kind: 'color' },
    ],
  },
  component: AuroraBloomVariant,
};

export default AuroraBloomVariant;
