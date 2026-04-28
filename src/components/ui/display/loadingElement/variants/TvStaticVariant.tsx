/**
 * TV-static variant — Fibonacci sphere where every dot is independently
 * flickering on a fast random schedule, with a slow signal "band" sweeping
 * latitude that boosts brightness, like analog TV interference inside a
 * globe. Outer wrapper rotates Y over 18s.
 *
 * Ported from `.orb-previews/X4-tv-static.html`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_TV_STATIC } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';
import { goldenSphere } from '../runtime/fibonacciSphere';

const SPIN_KEYFRAMES_FLAG = '__sorngTvStaticKeyframes';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[SPIN_KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-tvstatic-spin { to { transform: rotateY(360deg); } }';
  document.head.appendChild(style);
  w[SPIN_KEYFRAMES_FLAG] = true;
}

interface Dot {
  el: HTMLSpanElement;
  lat: number;
}

const TvStaticVariant: React.FC<VariantRenderProps<'tvStatic'>> = ({
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
  const dotsRef = useRef<Dot[]>([]);
  const startRef = useRef<number>(performance.now());

  const baseDot = useMemo(() => Math.max(1, size / 130), [size]);
  const radius = size / 2;

  ensureKeyframes();

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.innerHTML = '';
    const n = Math.max(1, Math.floor(config.dots));
    const pts = goldenSphere(n);
    const items: Dot[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.width = `${baseDot.toFixed(2)}px`;
      s.height = `${baseDot.toFixed(2)}px`;
      s.marginLeft = `${(-baseDot / 2).toFixed(2)}px`;
      s.marginTop = `${(-baseDot / 2).toFixed(2)}px`;
      s.borderRadius = '50%';
      s.background = 'currentColor';
      s.transformStyle = 'preserve-3d';
      s.willChange = 'transform, opacity';
      s.transform = `translate3d(${(p.x * radius).toFixed(2)}px, ${(p.y * radius).toFixed(2)}px, ${(p.z * radius).toFixed(2)}px)`;
      sphere.appendChild(dot);
      items.push({ el: dot, lat: (p.y + 1) / 2 });
    }
    dotsRef.current = items;
    return () => { sphere.innerHTML = ''; dotsRef.current = []; };
  }, [size, config.dots, baseDot, radius]);

  // Static render for reduced motion.
  useEffect(() => {
    if (!reducedMotion) return;
    renderFrame(dotsRef.current, 0, baseDot, config.noise, config.band);
  }, [reducedMotion, baseDot, config.noise, config.band, config.dots, size]);

  useEffect(() => {
    if (reducedMotion || paused) return;
    startRef.current = performance.now();
    const unsub = subscribeTicker((now) => {
      const t = (now - startRef.current) / 1000;
      renderFrame(dotsRef.current, t, baseDot, config.noise, config.band);
    });
    return unsub;
  }, [reducedMotion, paused, baseDot, config.noise, config.band, config.dots, size]);

  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: `${size * 3}px`,
    color,
    display: 'inline-block',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : 'sorng-tvstatic-spin 18s linear infinite',
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={rootStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function renderFrame(items: Dot[], t: number, baseDot: number, noise: number, band: number): void {
  const cursor = (t * 0.1) % 1;
  const w = Math.max(0.001, band);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let d = Math.abs(it.lat - cursor);
    if (d > 0.5) d = 1 - d;
    const k = Math.max(0, 1 - d / w);
    const bandPeak = Math.max(0.04, k * k);
    const flicker = noise * Math.random();
    const base = 0.05 + 0.4 * flicker;
    const peak = Math.max(base, bandPeak);
    const scale = 0.7 + 1.8 * peak;
    const dPx = baseDot * scale;
    const s = it.el.style;
    s.width = `${dPx.toFixed(2)}px`;
    s.height = `${dPx.toFixed(2)}px`;
    s.marginLeft = `${(-dPx / 2).toFixed(2)}px`;
    s.marginTop = `${(-dPx / 2).toFixed(2)}px`;
    s.opacity = (0.04 + 0.96 * peak).toFixed(3);
    const glow = 0.3 + 4 * peak;
    s.boxShadow = `0 0 ${(2 * glow).toFixed(2)}px currentColor, 0 0 ${(5 * glow).toFixed(2)}px color-mix(in srgb, currentColor 50%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'tvStatic'> = {
  type: 'tvStatic',
  label: 'TV static',
  description: 'Globe of flickering dots with a slow signal band sweeping latitude.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_TV_STATIC,
  presets: [
    { id: 'classic', label: 'Classic', config: {} },
    { id: 'soft-snow', label: 'Soft snow', config: { dots: 600, noise: 0.3, band: 0.3 } },
    { id: 'sharp-band', label: 'Sharp band', config: { dots: 1500, noise: 0.2, band: 0.06 } },
  ],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 200, max: 2000, step: 100 },
      { key: 'noise', label: 'Noise', kind: 'percent', min: 0, max: 1, step: 0.05 },
      { key: 'band', label: 'Band width', kind: 'percent', min: 0.02, max: 0.5, step: 0.01 },
    ],
  },
  component: TvStaticVariant,
};

export default TvStaticVariant;
