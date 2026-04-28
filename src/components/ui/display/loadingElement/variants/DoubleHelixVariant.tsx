/**
 * Double helix variant — two interleaved spirals on a sphere, offset by π.
 * Strand 1 uses the resolved `color`, strand 2 uses a `secondaryColor`
 * that lives outside the canonical DoubleHelixConfig (defaulting to
 * '#ff2bd6'); we read it off the incoming config if present so call sites
 * may set it without a types.ts change.
 *
 * Brightness wavefronts travel in opposite directions on each strand,
 * with a sharp k² falloff and a 0.06 floor so dots never go fully dark.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_DOUBLE_HELIX } from '../defaults';
import { subscribeTicker } from '../runtime/rafCoordinator';

const TAU = Math.PI * 2;
const KEYFRAMES_FLAG = '__sorngHelixKfInjected';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-helix-spin{from{transform:rotateY(0)}to{transform:rotateY(360deg)}}';
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

interface Item { el: HTMLSpanElement; f: number; strand: 0 | 1; }

const DoubleHelixVariant: React.FC<VariantRenderProps<'doubleHelix'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();

  const sphereRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);

  const secondaryColor = useMemo<string>(() => {
    const maybe = (config as unknown as { secondaryColor?: unknown }).secondaryColor;
    return typeof maybe === 'string' && maybe.length > 0 ? maybe : '#ff2bd6';
  }, [config]);

  // (Re)build dots when size, turns, or perStrand change.
  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    const radius = size / 2;
    const n = Math.max(2, Math.floor(config.perStrand));
    const turns = Math.max(1, Math.floor(config.turns));
    const dotPx = size / 100;
    sphere.replaceChildren();
    const items: Item[] = [];
    for (let strand: 0 | 1 = 0; strand <= 1; strand = (strand + 1) as 0 | 1) {
      const c = strand === 0 ? color : secondaryColor;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const phi = f * Math.PI;
        const theta = f * TAU * turns + (strand ? Math.PI : 0);
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);
        const dot = document.createElement('span');
        const s = dot.style;
        s.position = 'absolute';
        s.top = '50%';
        s.left = '50%';
        s.borderRadius = '50%';
        s.background = c;
        s.transformStyle = 'preserve-3d';
        s.willChange = 'opacity, width, height';
        s.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px)`;
        s.width = `${dotPx}px`;
        s.height = `${dotPx}px`;
        s.marginLeft = `${-dotPx / 2}px`;
        s.marginTop = `${-dotPx / 2}px`;
        s.opacity = '0.06';
        sphere.appendChild(dot);
        items.push({ el: dot, f, strand });
      }
      if (strand === 1) break;
    }
    itemsRef.current = items;
    return () => { sphere.replaceChildren(); itemsRef.current = []; };
  }, [size, color, secondaryColor, config.turns, config.perStrand]);

  // Frame loop.
  useEffect(() => {
    if (reducedMotion) {
      // Static frame: paint t=0 once.
      paint(itemsRef.current, 0, config.trail, config.speed, size);
      return;
    }
    const t0 = performance.now();
    const unsub = subscribeTicker((now) => {
      if (paused) return;
      const t = (now - t0) / 1000;
      paint(itemsRef.current, t, config.trail, config.speed, size);
    });
    return unsub;
  }, [paused, reducedMotion, config.trail, config.speed, size]);

  const sceneStyle: CSSProperties = {
    width: size,
    height: size,
    perspective: Math.max(600, size * 3),
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
    animation: reducedMotion ? undefined : `sorng-helix-spin ${config.spinSeconds}s linear infinite`,
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={sceneStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function paint(items: Item[], t: number, trailW: number, speed: number, size: number): void {
  const dotPx = size / 100;
  const tw = Math.max(0.001, trailW);
  for (const it of items) {
    const dir = it.strand === 0 ? 1 : -1;
    const offset = it.strand === 0 ? 0 : 0.5;
    const cursor = ((dir * t * speed * 0.1 + offset) % 1 + 1) % 1;
    let d = Math.abs(it.f - cursor); if (d > 0.5) d = 1 - d;
    const k = Math.max(0, 1 - d / tw);
    const peak = k * k;
    const opacity = 0.06 + 0.94 * peak;
    const scale = 1 + 1.8 * peak;
    const glow = 0.4 + 5 * peak;
    const c = it.el.style.background || 'currentColor';
    const s = it.el.style;
    s.opacity = opacity.toFixed(3);
    const w = dotPx * scale;
    s.width = `${w}px`;
    s.height = `${w}px`;
    s.marginLeft = `${-w / 2}px`;
    s.marginTop = `${-w / 2}px`;
    s.boxShadow =
      `0 0 ${(dotPx * glow).toFixed(2)}px ${c},` +
      `0 0 ${(dotPx * glow * 2.6).toFixed(2)}px color-mix(in srgb, ${c} 70%, transparent),` +
      `0 0 ${(dotPx * glow * 5).toFixed(2)}px color-mix(in srgb, ${c} 35%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'doubleHelix'> = {
  type: 'doubleHelix',
  label: 'Double helix',
  description: 'Two interleaved spirals on a sphere — counter-traveling brightness wavefronts.',
  minRecommendedSize: 32,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_DOUBLE_HELIX,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'turns', label: 'Turns', kind: 'integer', min: 3, max: 40 },
      { key: 'perStrand', label: 'Per strand', kind: 'integer', min: 60, max: 500 },
      { key: 'trail', label: 'Trail', kind: 'percent', min: 0.03, max: 0.5, step: 0.01 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, step: 0.1 },
      { key: 'spinSeconds', label: 'Spin period', kind: 'seconds', min: 3, max: 40, step: 1 },
      { key: 'secondaryColor', label: 'Strand 2 color', kind: 'color' },
    ],
  },
  component: DoubleHelixVariant,
};

export default DoubleHelixVariant;
