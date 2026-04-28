/**
 * Vortex variant — a tilted disc of particles spiralling inward toward a
 * bright singularity at the center. Each particle lives on its own phase;
 * brightness peaks as it falls into the eye then respawns at the rim.
 *
 * Ported from `.orb-previews/X3-vortex.html`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_VORTEX } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;

interface Particle {
  el: HTMLSpanElement;
  phase: number;
  theta0: number;
}

const VortexVariant: React.FC<VariantRenderProps<'vortex'>> = ({
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
  const particlesRef = useRef<Particle[]>([]);
  const startRef = useRef<number>(performance.now());

  const baseDot = useMemo(() => Math.max(1, size / 120), [size]);
  const radius = size / 2;

  // Build dot DOM whenever size or particle count changes.
  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.innerHTML = '';
    const items: Particle[] = [];
    const n = Math.max(1, Math.floor(config.particles));
    for (let i = 0; i < n; i++) {
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.borderRadius = '50%';
      s.background = 'currentColor';
      s.transformStyle = 'preserve-3d';
      s.willChange = 'transform, opacity';
      s.opacity = '0.6';
      sphere.appendChild(dot);
      items.push({
        el: dot,
        phase: Math.random(),
        theta0: Math.random() * TAU,
      });
    }
    particlesRef.current = items;
    return () => { sphere.innerHTML = ''; particlesRef.current = []; };
  }, [size, config.particles]);

  // Static render for reduced-motion: render a single still frame.
  useEffect(() => {
    if (!reducedMotion) return;
    renderFrame(particlesRef.current, 0, radius, baseDot, config.swirl, config.fall);
  }, [reducedMotion, radius, baseDot, config.swirl, config.fall, config.particles, size]);

  // Animation subscription.
  useEffect(() => {
    if (reducedMotion || paused) return;
    startRef.current = performance.now();
    const unsub = subscribeTicker((now) => {
      const t = (now - startRef.current) / 1000;
      renderFrame(particlesRef.current, t, radius, baseDot, config.swirl, config.fall);
    });
    return unsub;
  }, [reducedMotion, paused, radius, baseDot, config.swirl, config.fall, config.particles, size]);

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: `${size * 3}px`,
    transform: 'rotateX(60deg)',
    color,
    display: 'inline-block',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={rootStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function renderFrame(
  items: Particle[],
  t: number,
  radius: number,
  baseDot: number,
  swirl: number,
  fall: number,
): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const u = (it.phase + t * fall * 0.05) % 1;
    const r = radius * (1 - Math.pow(u, 1.4));
    const theta = it.theta0 + u * swirl * TAU;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    const yJitter = Math.sin(theta * 3 + t) * radius * 0.04 * (1 - u);
    const peak = Math.max(0.04, Math.pow(1 - u, 3));
    const scale = 0.6 + 2.2 * peak;
    const d = baseDot * scale;
    const s = it.el.style;
    s.width = `${d.toFixed(2)}px`;
    s.height = `${d.toFixed(2)}px`;
    s.marginLeft = `${(-d / 2).toFixed(2)}px`;
    s.marginTop = `${(-d / 2).toFixed(2)}px`;
    s.transform = `translate3d(${x.toFixed(2)}px, ${yJitter.toFixed(2)}px, ${z.toFixed(2)}px)`;
    s.opacity = (0.04 + 0.96 * peak).toFixed(3);
    const glow = 0.3 + 5 * peak;
    s.boxShadow = `0 0 ${(3 * glow).toFixed(2)}px currentColor, 0 0 ${(8 * glow).toFixed(2)}px color-mix(in srgb, currentColor 60%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'vortex'> = {
  type: 'vortex',
  label: 'Vortex',
  description: 'Tilted disc of particles spiralling inward into a bright singularity.',
  minRecommendedSize: 40,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_VORTEX,
  presets: [
    { id: 'classic', label: 'Classic', config: {} },
    { id: 'whirlpool', label: 'Whirlpool', config: { particles: 800, swirl: 2.2, fall: 1.4 } },
    { id: 'lazy-drift', label: 'Lazy drift', config: { particles: 300, swirl: 0.6, fall: 0.5 } },
  ],
  paramSchema: {
    fields: [
      { key: 'particles', label: 'Particles', kind: 'integer', min: 100, max: 1200 },
      { key: 'swirl', label: 'Swirl', kind: 'number', min: 0.1, max: 3, step: 0.1 },
      { key: 'fall', label: 'Fall', kind: 'number', min: 0.1, max: 3, step: 0.1 },
    ],
  },
  component: VortexVariant,
};

export default VortexVariant;
