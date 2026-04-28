/**
 * Plasma noise variant — fibonacci-distributed dots whose brightness comes
 * from a 3-layer pseudo-noise field. Two color channels (primary `color`
 * vs `secondaryColor`) split at the ~0.55 normalized boundary so the orb
 * looks alive without explicit cursors.
 */

import React, { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { VariantDescriptor, VariantRenderProps } from '../types';
import { DEFAULT_PLASMA } from '../defaults';
import { fibonacciSphere, type SpherePoint } from '../runtime/fibonacciSphere';
import { subscribeTicker } from '../runtime/rafCoordinator';

const KEYFRAMES_FLAG = '__sorngPlasmaKfInjected';

function ensureKeyframes(): void {
  if (typeof document === 'undefined') return;
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[KEYFRAMES_FLAG]) return;
  const style = document.createElement('style');
  style.textContent = '@keyframes sorng-plasma-spin{from{transform:rotateY(0)}to{transform:rotateY(360deg)}}';
  document.head.appendChild(style);
  w[KEYFRAMES_FLAG] = true;
}

interface Item { el: HTMLSpanElement; p: SpherePoint; }

function plasmaNoise(x: number, y: number, z: number, t: number): number {
  return (
    Math.sin(x * 1.7 + t * 1.3) * Math.sin(y * 1.9 - t * 0.8) * Math.sin(z * 2.1 + t * 0.6)
    + 0.5 * Math.sin((x + y) * 2.3 + t * 1.7) * Math.sin((y - z) * 2.7 - t * 1.1)
    + 0.25 * Math.sin(x * 5 + y * 3 + z * 4 + t * 2)
  );
}

const PlasmaNoiseVariant: React.FC<VariantRenderProps<'plasmaNoise'>> = ({
  size, color, config, paused, reducedMotion, className, style, ariaLabel,
}) => {
  ensureKeyframes();

  const sphereRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<Item[]>([]);

  useEffect(() => {
    const sphere = sphereRef.current;
    if (!sphere) return;
    const radius = size / 2;
    const n = Math.max(2, Math.floor(config.dots));
    const pts = fibonacciSphere(n);
    const dotPx = size / 120;
    sphere.replaceChildren();
    const items: Item[] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!p) continue;
      const x = p.x * radius;
      const y = p.y * radius;
      const z = p.z * radius;
      const dot = document.createElement('span');
      const s = dot.style;
      s.position = 'absolute';
      s.top = '50%';
      s.left = '50%';
      s.borderRadius = '50%';
      s.background = color;
      s.transformStyle = 'preserve-3d';
      s.willChange = 'opacity, width, height, background';
      s.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,${z.toFixed(2)}px)`;
      s.width = `${dotPx}px`;
      s.height = `${dotPx}px`;
      s.marginLeft = `${-dotPx / 2}px`;
      s.marginTop = `${-dotPx / 2}px`;
      s.opacity = '0.05';
      sphere.appendChild(dot);
      items.push({ el: dot, p });
    }
    itemsRef.current = items;
    return () => { sphere.replaceChildren(); itemsRef.current = []; };
  }, [size, color, config.dots]);

  useEffect(() => {
    if (reducedMotion) {
      paint(itemsRef.current, 0, size, config.scale, config.flow, color, config.secondaryColor);
      return;
    }
    const t0 = performance.now();
    const unsub = subscribeTicker((now) => {
      if (paused) return;
      const t = (now - t0) / 1000;
      paint(itemsRef.current, t, size, config.scale, config.flow, color, config.secondaryColor);
    });
    return unsub;
  }, [paused, reducedMotion, size, color, config.scale, config.flow, config.secondaryColor]);

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
    animation: reducedMotion ? undefined : `sorng-plasma-spin 30s linear infinite`,
    animationPlayState: paused ? 'paused' : 'running',
  };

  return (
    <div role="status" aria-label={ariaLabel} className={className} style={sceneStyle}>
      <div ref={sphereRef} style={sphereStyle} />
    </div>
  );
};

function paint(
  items: Item[],
  t: number,
  size: number,
  scale: number,
  flow: number,
  primary: string,
  secondary: string,
): void {
  const dotPx = size / 120;
  const tt = t * flow;
  for (const it of items) {
    const v = plasmaNoise(it.p.x * scale, it.p.y * scale, it.p.z * scale, tt);
    const norm = Math.max(0, Math.min(1, (v + 1.5) / 3));
    const peak = norm * norm * norm;
    const opacity = 0.05 + 0.95 * peak;
    const dotScale = 0.7 + 2 * peak;
    const glow = 0.3 + 5 * peak;
    const w = dotPx * dotScale;
    const c = norm > 0.55 ? primary : secondary;
    const s = it.el.style;
    s.background = c;
    s.opacity = opacity.toFixed(3);
    s.width = `${w}px`;
    s.height = `${w}px`;
    s.marginLeft = `${-w / 2}px`;
    s.marginTop = `${-w / 2}px`;
    s.boxShadow =
      `0 0 ${(2 * glow).toFixed(2)}px ${c},` +
      `0 0 ${(6 * glow).toFixed(2)}px color-mix(in srgb, ${c} 65%, transparent),` +
      `0 0 ${(12 * glow).toFixed(2)}px color-mix(in srgb, ${c} 30%, transparent)`;
  }
}

export const descriptor: VariantDescriptor<'plasmaNoise'> = {
  type: 'plasmaNoise',
  label: 'Plasma noise',
  description: 'Fibonacci-distributed dots driven by a flowing 3D pseudo-noise field.',
  minRecommendedSize: 40,
  supportsCanvas: true,
  hasRaf: true,
  defaultConfig: DEFAULT_PLASMA,
  presets: [{ id: 'classic', label: 'Classic', config: {} }],
  paramSchema: {
    fields: [
      { key: 'dots', label: 'Dots', kind: 'integer', min: 200, max: 1500 },
      { key: 'scale', label: 'Scale', kind: 'number', min: 0.1, max: 4, step: 0.1 },
      { key: 'flow', label: 'Flow', kind: 'number', min: 0.1, max: 4, step: 0.1 },
      { key: 'secondaryColor', label: 'Secondary color', kind: 'color' },
    ],
  },
  component: PlasmaNoiseVariant,
};

export default PlasmaNoiseVariant;
