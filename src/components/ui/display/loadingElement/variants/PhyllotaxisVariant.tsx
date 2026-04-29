/**
 * Phyllotaxis variant — 2D sunflower bloom inside a circular dish. Dots are
 * placed by rₙ = c·√(i+1), θₙ = i·GA. A brightness wave rolls outward from
 * the center; alternating dots take the primary or secondary color.
 *
 * Ported from `.orb-previews/X5-phyllotaxis.html`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_PHYLLOTAXIS } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';
import { GOLDEN_ANGLE } from '../runtime/fibonacciSphere';

const SPIN_KEYFRAMES_FLAG = '__sorngPhyllotaxisKeyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-phyllotaxis-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAMES_FLAG] = true;
}

interface Dot {
  el: HTMLSpanElement;
  f: number;
  i: number;
}

const PhyllotaxisVariant: React.FC<VariantRenderProps<'phyllotaxis'>> = ({
  size,
  color,
  config,
  paused,
  reducedMotion,
  className,
  style,
  ariaLabel,
}) => {
  const faceRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Dot[]>([]);
  const startRef = useRef<number>(performance.now());

  const baseDot = useMemo(() => Math.max(1, size / 110), [size]);

  ensureKeyframes();

  useEffect(() => {
    const face = faceRef.current;
    if (!face) return;
    face.innerHTML = '';
    const radius = (size / 2) * 0.92;
    const n = Math.max(1, Math.floor(config.dots));
    const c = (config.spacing * radius) / Math.sqrt(n);
    const items: Dot[] = [];
    const primary = color;
    const secondary = config.secondaryColor;
    for (let i = 0; i < n; i++) {
      const r = c * Math.sqrt(i + 1);
      if (r > radius) continue;
      const theta = i * GOLDEN_ANGLE;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.borderRadius = '50%';
      s.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      s.background = i % 2 ? primary : secondary;
      s.willChange = 'transform, opacity';
      face.appendChild(dot);
      items.push({ el: dot, f: r / radius, i });
    }
    dotsRef.current = items;
    return () => { face.innerHTML = ''; dotsRef.current = []; };
  }, [size, config.dots, config.spacing, color, config.secondaryColor]);

  useEffect(() => {
    if (!reducedMotion) return;
    renderFrame(dotsRef.current, 0, baseDot, config.trail, config.speed, color, config.secondaryColor);
  }, [reducedMotion, baseDot, config.trail, config.speed, color, config.secondaryColor, config.dots, config.spacing, size]);

  useEffect(() => {
    if (reducedMotion || paused) return;
    startRef.current = performance.now();
    const unsub = subscribeTicker((now) => {
      const t = (now - startRef.current) / 1000;
      renderFrame(dotsRef.current, t, baseDot, config.trail, config.speed, color, config.secondaryColor);
    });
    return unsub;
  }, [reducedMotion, paused, baseDot, config.trail, config.speed, color, config.secondaryColor, config.dots, config.spacing, size]);

  const dishStyle: CSSProperties = {
    width: size,
    height: size,
    color,
    borderRadius: '50%',
    background: `radial-gradient(circle, color-mix(in srgb, ${color} 8%, #06070d) 0%, #04050a 90%)`,
    boxShadow: `0 0 ${(size * 0.12).toFixed(2)}px color-mix(in srgb, ${color} 40%, transparent), inset 0 0 0 1px color-mix(in srgb, ${color} 50%, transparent)`,
    position: 'relative',
    overflow: 'hidden',
    display: 'inline-block',
    ...style,
  };
  const faceStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'absolute',
    inset: 0,
    animation: reducedMotion ? undefined : 'sorng-phyllotaxis-spin 40s linear infinite',
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={dishStyle}>
      <div ref={faceRef} style={faceStyle} />
    </div>
  );
};

function renderFrame(
  items: Dot[],
  t: number,
  baseDot: number,
  trail: number,
  speed: number,
  primary: string,
  secondary: string,
): void {
  const cursor = (t * speed * 0.07) % 1;
  const w = Math.max(0.001, trail);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let d = Math.abs(it.f - cursor);
    if (d > 0.5) d = 1 - d;
    const k = Math.max(0, 1 - d / w);
    const peak = k * k;
    const scale = (0.7 + 0.8 * it.f) * (1 + 1.6 * peak);
    const dPx = baseDot * scale;
    const s = it.el.style;
    s.width = `${dPx.toFixed(2)}px`;
    s.height = `${dPx.toFixed(2)}px`;
    s.marginLeft = `${(-dPx / 2).toFixed(2)}px`;
    s.marginTop = `${(-dPx / 2).toFixed(2)}px`;
    s.opacity = (0.05 + 0.95 * peak).toFixed(3);
    const tone = it.i % 2 ? primary : secondary;
    const glow = 0.3 + 5 * peak;
    s.boxShadow = `0 0 ${(3 * glow).toFixed(2)}px ${tone}, 0 0 ${(8 * glow).toFixed(2)}px color-mix(in srgb, ${tone} 60%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'phyllotaxis'> = {
  type: 'phyllotaxis',
  label: 'Phyllotaxis bloom',
  description: 'Sunflower face — golden-angle 2D bloom with a wave rolling outward.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  boundsBleed: 0.05,
  defaultConfig: DEFAULT_PHYLLOTAXIS,
  presets: [
    { id: 'classic', label: 'Classic', config: {} },
    { id: 'tight', label: 'Tight bloom', config: { dots: 1400, spacing: 0.6, trail: 0.18 } },
    { id: 'wide', label: 'Wide bloom', config: { dots: 500, spacing: 1.4, trail: 0.5 } },
  ],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 200, max: 2000, step: 50 },
      { key: 'spacing', label: 'Spacing', kind: 'number', min: 0.3, max: 2, step: 0.05 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.05, max: 0.8, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 3, step: 0.1 },
      { key: 'secondaryColor', label: 'Secondary color', kind: 'color' },
    ],
  },
  component: PhyllotaxisVariant,
};

export default PhyllotaxisVariant;
