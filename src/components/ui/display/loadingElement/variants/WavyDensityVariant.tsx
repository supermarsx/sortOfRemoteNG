/**
 * WavyDensity — variant ported from .orb-previews/E-wavy-density.html.
 *
 * Particles spawn at random points on a sphere (or chaos-blended toward a
 * deterministic spiral). Each dot gets a random lifetime, sweep phase, and
 * scale. The total live count drifts along a sine wave so the orb breathes
 * (sparse → dense → sparse).
 *
 * The shared rAF ticker (`subscribeTicker`) drives spawn/cull rate; we
 * mutate the DOM directly rather than re-render through React state.
 */

import { type CSSProperties, type FC, useEffect, useRef } from 'react';

import { DEFAULT_WAVY_DENSITY } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';
import type { VariantDescriptor, VariantRenderProps } from '../types';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const SPIRAL_MULTIPLIER = 23;
const SPIRAL_DENOM = 250;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function randomSpherePoint(): { phi: number; theta: number } {
  const u = Math.random();
  const v = Math.random();
  return { phi: Math.acos(2 * u - 1), theta: 2 * Math.PI * v };
}

function spiralPoint(i: number, n: number, multiplier: number) {
  return {
    phi: (i / n) * Math.PI,
    theta: (i / n) * Math.PI * 2 * multiplier,
  };
}

function pointFor(i: number, chaos: number) {
  const s = spiralPoint(i, SPIRAL_DENOM, SPIRAL_MULTIPLIER);
  if (chaos <= 0) return s;
  const r = randomSpherePoint();
  return {
    phi: s.phi * (1 - chaos) + r.phi * chaos,
    theta: s.theta * (1 - chaos) + r.theta * chaos,
  };
}

const KEYFRAMES = `
@keyframes wd-spin  { 0% { transform: rotateY(0); } 100% { transform: rotateY(360deg); } }
@keyframes wd-sweep {
  0%   { filter: brightness(0.18); transform: var(--t) scale(0.6); }
  6%   { filter: brightness(3.6);  transform: var(--t) scale(2.4); }
  14%  { filter: brightness(1);    transform: var(--t) scale(1);   }
  100% { filter: brightness(0.18); transform: var(--t) scale(0.6); }
}
@keyframes wd-life {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { opacity: 0; }
}
`;

const WavyDensityVariant: FC<VariantRenderProps<'wavyDensity'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const sphereRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef<Set<HTMLSpanElement>>(new Set());
  const idxRef = useRef(0);
  const startRef = useRef<number>(0);

  const { baseDots, swingDots, chaos, spinSeconds } = config;
  const radius = size / 2;
  const dotBase = size / 70;

  // Spawn / cull tick — uses shared rAF.
  useEffect(() => {
    if (reducedMotion || paused) return;
    const sphere = sphereRef.current;
    if (!sphere) return;

    startRef.current = performance.now();
    const localChaos = Math.max(0, Math.min(1, chaos));

    const spawn = () => {
      idxRef.current = (idxRef.current + 1) % 1000;
      const { phi, theta } = pointFor(idxRef.current, localChaos);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      const dot = document.createElement('span');
      const t = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
      const scale = rand(0.6, 1.6);
      const dur = rand(1.0, 2.4);
      const life = rand(1.6, 4.2);

      dot.style.setProperty('--t', t);
      dot.style.setProperty('--scale', scale.toFixed(2));
      dot.style.setProperty('--dur', `${dur.toFixed(2)}s`);
      dot.style.setProperty('--life', `${life.toFixed(2)}s`);
      dot.style.animationDelay = `${(-Math.random() * 2.4).toFixed(2)}s, 0s`;

      const onEnd = (e: AnimationEvent) => {
        if (e.animationName === 'wd-life') {
          aliveRef.current.delete(dot);
          dot.removeEventListener('animationend', onEnd);
          dot.remove();
        }
      };
      dot.addEventListener('animationend', onEnd);

      sphere.appendChild(dot);
      aliveRef.current.add(dot);
    };

    const kill = () => {
      const alive = aliveRef.current;
      if (alive.size === 0) return;
      const pick = Math.floor(Math.random() * alive.size);
      let i = 0;
      for (const d of alive) {
        if (i === pick) {
          d.style.transition = 'opacity .35s ease-out';
          d.style.opacity = '0';
          window.setTimeout(() => {
            alive.delete(d);
            d.remove();
          }, 380);
          return;
        }
        i++;
      }
    };

    const unsubscribe = subscribeTicker((now) => {
      const elapsed = (now - startRef.current) / 1000;
      const target = Math.max(
        0,
        baseDots + Math.sin(elapsed * ((Math.PI * 2) / 12)) * swingDots,
      );
      const diff = target - aliveRef.current.size;
      const rate = Math.min(8, Math.max(1, Math.ceil(Math.abs(diff) / 12)));
      if (diff > 0) for (let k = 0; k < rate; k++) spawn();
      else if (diff < 0) for (let k = 0; k < rate; k++) kill();
      if (Math.random() < 0.18) {
        kill();
        spawn();
      }
    });

    return () => {
      unsubscribe();
      // Tear down all live dots so we don't leak DOM.
      for (const d of aliveRef.current) d.remove();
      aliveRef.current.clear();
    };
  }, [baseDots, swingDots, chaos, radius, paused, reducedMotion]);

  // Static fallback for reducedMotion: render a one-shot deterministic spiral set.
  useEffect(() => {
    if (!reducedMotion) return;
    const sphere = sphereRef.current;
    if (!sphere) return;
    const localChaos = Math.max(0, Math.min(1, chaos));
    const n = Math.max(20, Math.floor(baseDots / 2));
    for (let i = 0; i < n; i++) {
      const { phi, theta } = pointFor(i, localChaos);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      const dot = document.createElement('span');
      dot.style.setProperty('--t', `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`);
      dot.style.setProperty('--scale', '1');
      dot.style.animation = 'none';
      dot.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
      dot.style.opacity = '1';
      sphere.appendChild(dot);
    }
    return () => {
      while (sphere.firstChild) sphere.removeChild(sphere.firstChild);
    };
  }, [reducedMotion, baseDots, chaos, radius]);

  const sceneStyle: CSSVars = {
    width: size,
    height: size,
    perspective: '1000px',
    transform: 'rotateZ(28deg)',
    color,
    display: 'inline-block',
    ...(style ?? {}),
  };

  const sphereStyle: CSSVars = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? 'none' : `wd-spin ${spinSeconds}s linear infinite`,
    animationPlayState: paused ? 'paused' : 'running',
    '--s': `${size}px`,
    '--d': `${dotBase}px`,
  };

  return (
    <div className={className} role="status" aria-label={ariaLabel ?? 'Loading'} style={sceneStyle}>
      <style>{`${KEYFRAMES}
        .wd-sphere > span {
          --d: ${dotBase}px;
          position: absolute;
          top: calc(50% - var(--d) / 2);
          left: calc(50% - var(--d) / 2);
          width: calc(var(--d) * var(--scale, 1));
          height: calc(var(--d) * var(--scale, 1));
          margin: calc(var(--d) * (1 - var(--scale, 1)) / 2) 0 0 calc(var(--d) * (1 - var(--scale, 1)) / 2);
          border-radius: 50%;
          background: currentColor;
          box-shadow:
            0 0 calc(var(--d) * 2.2) currentColor,
            0 0 calc(var(--d) * 5.5) color-mix(in srgb, currentColor 80%, transparent),
            0 0 calc(var(--d) * 9)   color-mix(in srgb, currentColor 40%, transparent);
          transform-style: preserve-3d;
          transform: var(--t);
          animation:
            wd-sweep var(--dur, 1.6s) linear infinite,
            wd-life  var(--life, 3s)  ease-in-out 1 forwards;
        }
      `}</style>
      <div ref={sphereRef} className="wd-sphere" style={sphereStyle} />
    </div>
  );
};

export default WavyDensityVariant;

export const descriptor: VariantDescriptor<'wavyDensity'> = {
  type: 'wavyDensity',
  label: 'Wavy density',
  description:
    'Particles spawn at random points on a sphere with random lifetimes and sweep phases. Total count breathes on a sine wave.',
  minRecommendedSize: 40,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_WAVY_DENSITY,
  presets: [
    { id: 'default', label: 'Default', config: DEFAULT_WAVY_DENSITY },
    { id: 'sparse',  label: 'Sparse',  config: { baseDots: 100, swingDots: 60,  chaos: 0.7, spinSeconds: 12 } },
    { id: 'dense',   label: 'Dense',   config: { baseDots: 380, swingDots: 160, chaos: 0.85, spinSeconds: 6 } },
    { id: 'spiral',  label: 'Spiral',  config: { baseDots: 220, swingDots: 60,  chaos: 0.15, spinSeconds: 10 } },
  ],
  paramSchema: {
    fields: [
      { key: 'baseDots',    label: 'Base dots',   kind: 'integer', min: 50, max: 500 },
      { key: 'swingDots',   label: 'Swing ±',     kind: 'integer', min: 0,  max: 200 },
      { key: 'chaos',       label: 'Chaos',       kind: 'percent', min: 0,  max: 1, step: 0.05, help: '0 = pure spiral, 1 = pure random.' },
      { key: 'spinSeconds', label: 'Spin period', kind: 'seconds', min: 3,  max: 30, step: 1 },
    ],
  },
  component: WavyDensityVariant,
};
