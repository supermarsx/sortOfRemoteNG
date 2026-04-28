/**
 * Rippling spiral variant — a Milleus-style dot spiral wrapped on a sphere
 * whose radial distance is modulated by a sine wave traveling along the
 * spiral index. Brightness peaks sharply on crests via a cubed cosine
 * envelope. The whole sphere sits inside a rotateZ(28deg) tilted scene.
 */

import React, { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_RIPPLING_SPIRAL } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;
const KEYFRAMES_FLAG = '__sorngRippleSpiralKfInjected';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-ripspiral-spin{from{transform:rotateY(0)}to{transform:rotateY(360deg)}}';
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

interface Item { el: HTMLSpanElement; f: number; ux: number; uy: number; uz: number; }

const RipplingSpiralVariant: React.FC<VariantRenderProps<'ripplingSpiral'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();

  const sphereRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    const n = Math.max(2, Math.floor(config.dots));
    const mul = Math.max(1, Math.floor(config.density));
    const dotPx = size / 110;
    sphere.replaceChildren();
    const items: Item[] = [];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const phi = f * Math.PI;
      const theta = f * TAU * mul;
      const ux = Math.sin(phi) * Math.cos(theta);
      const uy = Math.sin(phi) * Math.sin(theta);
      const uz = Math.cos(phi);
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.borderRadius = '50%';
      s.background = color;
      s.transformStyle = 'preserve-3d';
      s.willChange = 'transform, opacity, width, height';
      s.width = `${dotPx}px`;
      s.height = `${dotPx}px`;
      s.marginLeft = `${-dotPx / 2}px`;
      s.marginTop = `${-dotPx / 2}px`;
      s.opacity = '0.08';
      sphere.appendChild(dot);
      items.push({ el: dot, f, ux, uy, uz });
    }
    itemsRef.current = items;
    return () => { sphere.replaceChildren(); itemsRef.current = []; };
  }, [size, color, config.dots, config.density]);

  useEffect(() => {
    if (reducedMotion) {
      paint(itemsRef.current, 0, size, config.amp, config.k, config.speed);
      return;
    }
    const t0 = performance.now();
    const unsub = subscribeTicker((now) => {
      if (paused) return;
      const t = (now - t0) / 1000;
      paint(itemsRef.current, t, size, config.amp, config.k, config.speed);
    });
    return unsub;
  }, [paused, reducedMotion, size, config.amp, config.k, config.speed]);

  const sceneStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: Math.max(600, size * 3.3),
    transform: 'rotateZ(28deg)',
    color,
    display: 'inline-block',
    ...style,
  };
  const sphereStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    transformStyle: 'preserve-3d',
    animation: reducedMotion ? undefined : `sorng-ripspiral-spin ${config.spinSeconds}s linear infinite`,
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={sceneStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function paint(items: Item[], t: number, size: number, amp: number, k: number, speed: number): void {
  const radius = size / 2;
  const dotPx = size / 110;
  for (const it of items) {
    const wave = Math.sin(k * TAU * it.f - speed * t);
    const r = radius * (1 + amp * wave);
    const x = it.ux * r;
    const y = it.uy * r;
    const z = it.uz * r;
    const crest = Math.pow(0.5 + 0.5 * wave, 3);
    const opacity = 0.06 + 0.94 * crest;
    const scale = 1 + 1.6 * crest;
    const glow = 0.4 + 5 * crest;
    const w = dotPx * scale;
    const s = it.el.style;
    s.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px)`;
    s.opacity = opacity.toFixed(3);
    s.width = `${w}px`;
    s.height = `${w}px`;
    s.marginLeft = `${-w / 2}px`;
    s.marginTop = `${-w / 2}px`;
    const c = s.background || 'currentColor';
    s.boxShadow =
      `0 0 ${(dotPx * glow).toFixed(2)}px ${c},` +
      `0 0 ${(dotPx * glow * 2.6).toFixed(2)}px color-mix(in srgb, ${c} 70%, transparent),` +
      `0 0 ${(dotPx * glow * 5).toFixed(2)}px color-mix(in srgb, ${c} 35%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'ripplingSpiral'> = {
  type: 'ripplingSpiral',
  label: 'Rippling spiral',
  description: 'Dot spiral whose radial distance pulses with a sine wave — bands inflate and deflate.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_RIPPLING_SPIRAL,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 100, max: 700 },
      { key: 'density', label: 'Density', kind: 'integer', min: 3, max: 60 },
      { key: 'amp', label: 'Amplitude', kind: 'percent', min: 0, max: 0.6, step: 0.01 },
      { key: 'k', label: 'Wave count', kind: 'integer', min: 1, max: 10 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, step: 0.1 },
      { key: 'spinSeconds', label: 'Spin period', kind: 'seconds', min: 3, max: 30, step: 1 },
    ],
  },
  component: RipplingSpiralVariant,
};

export default RipplingSpiralVariant;
