/**
 * Pulsing bands variant — latitude rings (denser at the equator) with a set
 * of cosine-shaped band cursors sweeping pole to pole. Each dot picks the
 * brightest band cursor so multiple bands can overlap cleanly.
 */

import React, { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_PULSING_BANDS } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;
const KEYFRAMES_FLAG = '__sorngBandsKfInjected';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-bands-spin{from{transform:rotateY(0)}to{transform:rotateY(360deg)}}';
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

interface Item { el: HTMLSpanElement; lat: number; }

const PulsingBandsVariant: React.FC<VariantRenderProps<'pulsingBands'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();

  const sphereRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    const radius = size / 2;
    const rings = Math.max(2, Math.floor(config.rings));
    const perEq = Math.max(3, Math.floor(config.perRing));
    const dotPx = size / 100;
    sphere.replaceChildren();
    const items: Item[] = [];
    for (let r = 0; r < rings; r++) {
      const phi = ((r + 0.5) / rings) * Math.PI;
      const ringR = Math.sin(phi);
      const count = Math.max(3, Math.round(perEq * ringR));
      for (let j = 0; j < count; j++) {
        const theta = (j / count) * TAU + r * 0.4;
        const x = radius * ringR * Math.cos(theta);
        const z = radius * ringR * Math.sin(theta);
        const y = radius * Math.cos(phi);
        const dot = document.createElement('span');
        const s = dot.style;
        s.position = 'absolute';
        s.top = '50%';
        s.left = '50%';
        s.borderRadius = '50%';
        s.background = color;
        s.transformStyle = 'preserve-3d';
        s.willChange = 'opacity, width, height';
        s.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px)`;
        s.width = `${dotPx}px`;
        s.height = `${dotPx}px`;
        s.marginLeft = `${-dotPx / 2}px`;
        s.marginTop = `${-dotPx / 2}px`;
        s.opacity = '0.06';
        sphere.appendChild(dot);
        items.push({ el: dot, lat: phi / Math.PI });
      }
    }
    itemsRef.current = items;
    return () => { sphere.replaceChildren(); itemsRef.current = []; };
  }, [size, color, config.rings, config.perRing]);

  useEffect(() => {
    if (reducedMotion) {
      paint(itemsRef.current, 0, size, config.bands, config.width, config.speed);
      return;
    }
    const t0 = performance.now();
    const unsub = subscribeTicker((now) => {
      if (paused) return;
      const t = (now - t0) / 1000;
      paint(itemsRef.current, t, size, config.bands, config.width, config.speed);
    });
    return unsub;
  }, [paused, reducedMotion, size, config.bands, config.width, config.speed]);

  const sceneStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: Math.max(600, size * 3.3),
    transform: 'rotateX(15deg)',
    color,
    display: 'inline-block',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : `sorng-bands-spin 14s linear infinite`,
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={sceneStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function paint(items: Item[], t: number, size: number, bands: number, width: number, speed: number): void {
  const dotPx = size / 100;
  const w = Math.max(0.001, width);
  const b = Math.max(1, Math.floor(bands));
  for (const it of items) {
    let best = 0;
    for (let a = 0; a < b; a++) {
      const cursor = ((t * speed * 0.1) + a / b) % 1;
      let d = Math.abs(it.lat - cursor); if (d > 0.5) d = 1 - d;
      const k = Math.max(0, 1 - d / w);
      const g = k * k;
      if (g > best) best = g;
    }
    const peak = best * best;
    const opacity = 0.06 + 0.94 * peak;
    const scale = 1 + 1.8 * peak;
    const glow = 0.4 + 5 * peak;
    const ww = dotPx * scale;
    const s = it.el.style;
    s.opacity = opacity.toFixed(3);
    s.width = `${ww}px`;
    s.height = `${ww}px`;
    s.marginLeft = `${-ww / 2}px`;
    s.marginTop = `${-ww / 2}px`;
    const c = s.background || 'currentColor';
    s.boxShadow =
      `0 0 ${(dotPx * glow).toFixed(2)}px ${c},` +
      `0 0 ${(dotPx * glow * 2.6).toFixed(2)}px color-mix(in srgb, ${c} 70%, transparent),` +
      `0 0 ${(dotPx * glow * 5).toFixed(2)}px color-mix(in srgb, ${c} 35%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'pulsingBands'> = {
  type: 'pulsingBands',
  label: 'Pulsing bands',
  description: 'Latitude rings with cosine bands sweeping pole to pole — Saturn rings on a sphere.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_PULSING_BANDS,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'rings', label: 'Rings', kind: 'integer', min: 10, max: 60 },
      { key: 'perRing', label: 'Per ring', kind: 'integer', min: 6, max: 60 },
      { key: 'bands', label: 'Bands', kind: 'integer', min: 1, max: 8 },
      { key: 'width', label: 'Width', kind: 'percent', min: 0.03, max: 0.4, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, step: 0.1 },
    ],
  },
  component: PulsingBandsVariant,
};

export default PulsingBandsVariant;
